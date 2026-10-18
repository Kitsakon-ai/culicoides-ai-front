import { prisma } from "@/lib/prisma";

// ── Knowledge base layer ─────────────────────────────────────
// ดึง structured facts (species/จังหวัด/features/references) + ค้น documents ด้วย pgvector
// ทุกฟังก์ชัน resilient: ถ้ายังไม่ได้รัน migration หรือ DB ล่ม จะคืนค่าว่าง ไม่ throw
// (แชต/แผนที่จะ fallback ไปพฤติกรรมเดิมได้เอง)

export type SpeciesFacts = {
  speciesId: number | null;
  scientificName: string | null;
  genus: string | null;
  commonNameTh: string | null;
  summaryTh: string | null;
  vectorRole: string | null;
  provinces: string[];
  features: { nameEn: string | null; nameTh: string | null; description: string | null }[];
  references: { citation: string; doiOrUrl: string | null; year: number | null }[];
};

export type DocMatch = {
  content: string;
  source: string | null;
  year: number | null;
  similarity: number;
};

const EMPTY_FACTS: SpeciesFacts = {
  speciesId: null,
  scientificName: null,
  genus: null,
  commonNameTh: null,
  summaryTh: null,
  vectorRole: null,
  provinces: [],
  features: [],
  references: [],
};

// รับ species ได้ทั้งแบบ epithet ("guttifer") และ full name ("Culicoides guttifer")
export async function getSpeciesFacts(speciesName: string): Promise<SpeciesFacts> {
  const name = speciesName.trim();
  if (!name) return EMPTY_FACTS;

  try {
    const rows = await prisma.$queryRaw<
      {
        id: bigint;
        scientific_name: string;
        genus: string;
        common_name_th: string | null;
        summary_th: string | null;
        vector_role: string | null;
      }[]
    >`
      select id, scientific_name, genus, common_name_th, summary_th, vector_role
      from species
      where lower(scientific_name) = lower(${name})
         or lower(scientific_name) = lower(${"Culicoides " + name})
      limit 1
    `;

    if (rows.length === 0) return EMPTY_FACTS;

    const s = rows[0];
    const speciesId = Number(s.id);

    const [provRows, featRows, refRows] = await Promise.all([
      prisma.$queryRaw<{ province: string }[]>`
        select province from species_province where species_id = ${speciesId} order by province
      `,
      // ลักษณะปีก "ของชนิดนี้" — ชื่อลักษณะมาจากแคตตาล็อก wing_feature
      // ส่วนคำบรรยายมาจาก species_wing_feature จึงสะกดตรงกับที่ /api/annotate ใช้เสมอ
      prisma.$queryRaw<{ name_en: string | null; name_th: string | null; description: string | null }[]>`
        select wf.name_en, wf.name_th, swf.description
        from species_wing_feature swf
        join wing_feature wf on wf.id = swf.wing_feature_id
        where swf.species_id = ${speciesId}
        order by wf.sort, wf.id
      `,
      prisma.$queryRaw<{ citation: string; doi_or_url: string | null; year: number | null }[]>`
        select citation, doi_or_url, year from species_reference where species_id = ${speciesId} order by year desc nulls last
      `,
    ]);

    return {
      speciesId,
      scientificName: s.scientific_name,
      genus: s.genus,
      commonNameTh: s.common_name_th,
      summaryTh: s.summary_th,
      vectorRole: s.vector_role,
      provinces: provRows.map((r) => r.province),
      features: featRows.map((r) => ({ nameEn: r.name_en, nameTh: r.name_th, description: r.description })),
      references: refRows.map((r) => ({ citation: r.citation, doiOrUrl: r.doi_or_url, year: r.year })),
    };
  } catch (err) {
    console.error("getSpeciesFacts error:", err);
    return EMPTY_FACTS;
  }
}

// จังหวัดของชนิด (ใช้ที่ /api/provinces — เร็ว/แม่น/ไม่มโน)
export async function getProvincesForSpecies(speciesName: string): Promise<string[]> {
  const name = speciesName.trim();
  if (!name) return [];
  try {
    const rows = await prisma.$queryRaw<{ province: string }[]>`
      select sp.province
      from species s
      join species_province sp on sp.species_id = s.id
      where lower(s.scientific_name) = lower(${name})
         or lower(s.scientific_name) = lower(${"Culicoides " + name})
      order by sp.province
    `;
    return rows.map((r) => r.province);
  } catch (err) {
    console.error("getProvincesForSpecies error:", err);
    return [];
  }
}

// ชื่อวิทยาศาสตร์ทุกชนิดในฐานข้อมูล — ใช้หาว่าผู้ใช้พิมพ์ถึงชนิดไหนบ้างในคำถาม
// แคชไว้ทั้ง process เพราะรายชื่อชนิดแทบไม่เปลี่ยน และถูกเรียกทุกข้อความแชตที่ถามเรื่องจังหวัด
let speciesNamesCache: string[] | null = null;
export async function getSpeciesNames(): Promise<string[]> {
  if (speciesNamesCache) return speciesNamesCache;
  try {
    const rows = await prisma.$queryRaw<{ scientific_name: string }[]>`
      select scientific_name from species order by scientific_name
    `;
    speciesNamesCache = rows.map((r) => r.scientific_name);
    return speciesNamesCache;
  } catch (err) {
    console.error("getSpeciesNames error:", err);
    return [];
  }
}

// มี documents (ที่ embed แล้ว) ในฐานข้อมูลไหม — ใช้ตัดสินใจว่าจะยิง embedding query ไหม
export async function hasDocuments(): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<{ ok: number }[]>`
      select 1 as ok from documents where embedding is not null limit 1
    `;
    return rows.length > 0;
  } catch {
    return false;
  }
}

export type WingFeature = {
  nameEn: string;
  nameTh: string;
  description: string | null;
  /** true = คำบรรยายมาจาก species_wing_feature (ลักษณะของชนิดนี้ มีเอกสารอ้างอิง)
   *  false = คำนิยามระดับสกุล ใช้กับ Culicoides ทุกชนิด จึงใช้แยกชนิดไม่ได้ */
  specific: boolean;
  source: string | null;
};

// ชุดลักษณะปีกสำหรับ annotation
// รายชื่อลักษณะมาจากแคตตาล็อก wing_feature เสมอ (ระดับสกุล ครบ 7 จุด)
// ส่วนคำบรรยาย ถ้าชนิดนั้นมีของตัวเองใน species_wing_feature ให้ใช้ตัวนั้นแทน
//
// เดิมยิง 2 query แบบ fallback ทั้งก้อน ทำให้ถ้าชนิดนั้นมีคำบรรยายแค่ 2 จาก 7 จุด
// จะได้แค่ 2 จุด ลักษณะที่เหลือหายไปเลย — ตอนนี้ LEFT JOIN จึงได้ครบ 7 จุดเสมอ
// จุดไหนมีคำบรรยายรายชนิดก็ใช้ตัวนั้น ไม่มีก็ตกไปใช้ของระดับสกุล
export async function getWingFeatures(species?: string | null): Promise<WingFeature[]> {
  try {
    const name = species?.trim() ?? "";
    const rows = await prisma.$queryRaw<
      { name_en: string; name_th: string; description: string | null; specific: boolean; source: string | null }[]
    >`
      select wf.name_en,
             wf.name_th,
             coalesce(swf.description, wf.description) as description,
             (swf.description is not null) as specific,
             swf.source
      from wing_feature wf
      left join species_wing_feature swf
        on swf.wing_feature_id = wf.id
       and swf.species_id = (
             select s.id from species s
             where lower(s.scientific_name) = lower(${name})
                or lower(s.scientific_name) = lower(${"Culicoides " + name})
             limit 1
           )
      order by wf.sort, wf.id
    `;
    return rows.map((r) => ({
      nameEn: r.name_en,
      nameTh: r.name_th,
      description: r.description,
      specific: Boolean(r.specific),
      source: r.source,
    }));
  } catch (err) {
    console.error("getWingFeatures error:", err);
    return [];
  }
}

// ค้น documents ที่ใกล้เคียงเชิงความหมาย (cosine similarity ผ่าน pgvector) แบบ global
// sinceYear = กรอบ "งานวิจัยย้อนหลังไม่เกิน N ปี" (null = ไม่จำกัดปี; year null ให้ผ่านเสมอ)
//
// ใช้ดัชนี HNSW (ประมาณค่า) — ค้นทั้งคลังไม่มีตัวกรองชนิด และเอกสารเกือบทั้งหมดอยู่ในกรอบปีอยู่แล้ว
// วัดแล้ว: ถ้าคำนวณระยะครบทุกแถวของคลัง ~16,000 ย่อหน้า ใช้ 6–9 วินาทีตอนแคชเย็น
export async function searchDocuments(
  embedding: number[],
  opts?: { limit?: number; sinceYear?: number | null }
): Promise<DocMatch[]> {
  if (!embedding.length) return [];
  const limit = opts?.limit ?? 5;
  const since = opts?.sinceYear ?? null;
  const vec = `[${embedding.join(",")}]`;

  try {
    return await prisma.$queryRaw<DocMatch[]>`
      select content, source, year, 1 - (embedding <=> ${vec}::vector) as similarity
      from documents
      where embedding is not null
        and (${since}::int is null or year is null or year >= ${since})
      order by embedding <=> ${vec}::vector
      limit ${limit}
    `;
  } catch (err) {
    console.error("searchDocuments error:", err);
    return [];
  }
}

// ค้นเฉพาะงานวิจัยที่ "พูดถึงชนิดนี้จริง" (ผ่าน document_species) + กรอบ 5 ปีย้อนหลัง
// แม่นกว่า global เพราะกรองมาแล้วว่าเอกสารกล่าวถึงชนิดนั้น
//
// ค้นแบบแม่นตรง (exact) ผ่าน CTE แบบ materialized แทนดัชนี HNSW — ดัชนีประมาณค่าจะดึงผู้สมัคร
// ราว 40 แถวจากทั้งคลังก่อนแล้วค่อยกรองชนิด เมื่อคลังใหญ่ (~16,000 ย่อหน้า) จึงได้ผลไม่ครบ
// แถวที่ผูกกับชนิดหนึ่งมีไม่กี่ร้อยแถว คำนวณครบทุกแถวใช้ราว 0.25 วินาที
export async function searchDocumentsForSpecies(
  embedding: number[],
  speciesId: number,
  opts?: { limit?: number; sinceYear?: number | null }
): Promise<DocMatch[]> {
  if (!embedding.length) return [];
  const limit = opts?.limit ?? 5;
  const since = opts?.sinceYear ?? null;
  const vec = `[${embedding.join(",")}]`;

  try {
    return await prisma.$queryRaw<DocMatch[]>`
      with scored as materialized (
        select d.content, d.source, d.year, d.embedding <=> ${vec}::vector as dist
        from documents d
        join document_species ds on ds.document_id = d.id
        where d.embedding is not null and ds.species_id = ${speciesId}
          and (${since}::int is null or d.year is null or d.year >= ${since})
      )
      select content, source, year, 1 - dist as similarity
      from scored
      order by dist
      limit ${limit}
    `;
  } catch (err) {
    console.error("searchDocumentsForSpecies error:", err);
    return [];
  }
}

// รายการเอกสารอ้างอิงท้ายคำตอบ — ระบบสร้างเองจากย่อหน้าที่ค้นได้จริง เฉพาะ [S#] ที่คำตอบอ้างถึง
// ลิงก์จึงถูกฉบับเสมอ (เดิมให้แบบจำลองเขียนรายการเองแล้วผูก DOI ผิดฉบับ)
// รองรับ [S1] [S1][S2] [S1, S3] และช่วง [S1–S3]
export function buildReferenceList(answer: string, docs: DocMatch[], heading: string): string {
  if (!docs.length) return "";
  const cited = new Set<number>();
  for (const group of answer.matchAll(/\[([^\]\n]*?S\d+[^\]\n]*?)\]/g)) {
    for (const r of group[1].matchAll(/S(\d+)(?:\s*[–-]\s*S?(\d+))?/g)) {
      const a = Number(r[1]);
      const b = r[2] ? Number(r[2]) : a;
      for (let n = Math.min(a, b); n <= Math.max(a, b) && n - Math.min(a, b) < 10; n++) cited.add(n);
    }
  }
  // หลายย่อหน้ามักมาจากงานเรื่องเดียวกัน → รวมเป็นบรรทัดเดียว เช่น [S1, S3]
  const bySource = new Map<string, number[]>();
  for (const n of [...cited].filter((n) => n >= 1 && n <= docs.length).sort((x, y) => x - y)) {
    const d = docs[n - 1];
    const src = d.source ?? "(ไม่ทราบแหล่ง)";
    const key = `${src}${d.year && !src.includes(`(${d.year})`) ? ` (${d.year})` : ""}`;
    bySource.set(key, [...(bySource.get(key) ?? []), n]);
  }
  const items = [...bySource].map(([src, ns]) => `- **[${ns.map((n) => `S${n}`).join(", ")}]** ${src}`);
  return items.length ? `${heading}\n${items.join("\n")}` : "";
}

// ประกอบ facts + documents เป็น context block ยัดเข้า prompt
export function buildKnowledgeContext(facts: SpeciesFacts, docs: DocMatch[]): string {
  const parts: string[] = [];

  if (facts.scientificName) {
    const lines: string[] = [];
    lines.push(
      `ชนิด: ${facts.scientificName}${facts.genus ? ` (สกุล ${facts.genus})` : ""}${facts.commonNameTh ? ` — ${facts.commonNameTh}` : ""}`
    );
    if (facts.summaryTh) lines.push(`สรุป: ${facts.summaryTh}`);
    if (facts.vectorRole) lines.push(`บทบาทพาหะ: ${facts.vectorRole}`);
    if (facts.provinces.length) {
      lines.push(`จังหวัดที่มีรายงานพบ (จากฐานข้อมูล): ${facts.provinces.join(", ")}`);
    }
    if (facts.features.length) {
      lines.push("ลักษณะปีกเด่น:");
      for (const f of facts.features) {
        const nm = [f.nameEn, f.nameTh].filter(Boolean).join(" / ");
        lines.push(`- ${nm}${f.description ? `: ${f.description}` : ""}`);
      }
    }
    if (facts.references.length) {
      lines.push("เอกสารอ้างอิง:");
      for (const r of facts.references) {
        lines.push(`- ${r.citation}${r.year ? ` (${r.year})` : ""}${r.doiOrUrl ? ` ${r.doiOrUrl}` : ""}`);
      }
    }
    parts.push("[ข้อมูลจากฐานข้อมูล — ใช้เป็นแหล่งหลัก]\n" + lines.join("\n"));
  }

  // ย่อหน้างานวิจัยติดรหัส [S#] พร้อมบรรณานุกรมเต็ม (ผู้แต่ง ปี ชื่อเรื่อง วารสาร DOI ซึ่งเก็บอยู่ใน
  // documents.source) — โมเดลอ้างด้วยรหัสแทนการเดาชื่อไฟล์/ลิงก์ ซึ่งเคยทำให้ผูกลิงก์ผิดฉบับ
  if (docs.length) {
    const dl = docs
      .map((d, i) => `[S${i + 1}] ${d.source ?? "(ไม่ทราบแหล่ง)"}${d.source && d.year && !d.source.includes(`(${d.year})`) ? ` (${d.year})` : ""}\n"${d.content.replace(/\s+/g, " ").trim()}"`)
      .join("\n\n");
    parts.push("[ข้อความจากงานวิจัย (ค้นด้วย semantic search) — แต่ละย่อหน้ามีรหัสแหล่ง [S#] พร้อมข้อมูลบรรณานุกรม]\n" + dl);
  } else if (facts.scientificName) {
    parts.push("[ข้อความจากงานวิจัย] (ไม่มี — รอบนี้ระบบค้นไม่พบย่อหน้างานวิจัยที่เกี่ยวข้อง)");
  }

  return parts.join("\n\n");
}
