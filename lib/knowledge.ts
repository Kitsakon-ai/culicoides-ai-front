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
      prisma.$queryRaw<{ name_en: string | null; name_th: string | null; description: string | null }[]>`
        select name_en, name_th, description from morphology_feature where species_id = ${speciesId} order by id
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

export type WingFeature = { nameEn: string; nameTh: string; description: string | null };

// ชุดลักษณะปีกสำหรับ annotation — รายชนิดก่อน (morphology_feature) ถ้าไม่มีใช้ genus-level (wing_feature)
export async function getWingFeatures(species?: string | null): Promise<WingFeature[]> {
  try {
    const name = species?.trim();
    if (name) {
      const rows = await prisma.$queryRaw<{ name_en: string | null; name_th: string | null; description: string | null }[]>`
        select mf.name_en, mf.name_th, mf.description
        from species s
        join morphology_feature mf on mf.species_id = s.id
        where lower(s.scientific_name) = lower(${name})
           or lower(s.scientific_name) = lower(${"Culicoides " + name})
        order by mf.id
      `;
      if (rows.length > 0) {
        return rows.map((r) => ({ nameEn: r.name_en ?? "", nameTh: r.name_th ?? "", description: r.description }));
      }
    }
    const rows = await prisma.$queryRaw<{ name_en: string; name_th: string; description: string | null }[]>`
      select name_en, name_th, description from wing_feature order by sort, id
    `;
    return rows.map((r) => ({ nameEn: r.name_en, nameTh: r.name_th, description: r.description }));
  } catch (err) {
    console.error("getWingFeatures error:", err);
    return [];
  }
}

// ค้น documents ที่ใกล้เคียงเชิงความหมาย (cosine similarity ผ่าน pgvector) แบบ global
// sinceYear = กรอบ "งานวิจัยย้อนหลังไม่เกิน N ปี" (null = ไม่จำกัดปี; year null ให้ผ่านเสมอ)
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
      select d.content, d.source, d.year, 1 - (d.embedding <=> ${vec}::vector) as similarity
      from documents d
      join document_species ds on ds.document_id = d.id
      where d.embedding is not null and ds.species_id = ${speciesId}
        and (${since}::int is null or d.year is null or d.year >= ${since})
      order by d.embedding <=> ${vec}::vector
      limit ${limit}
    `;
  } catch (err) {
    console.error("searchDocumentsForSpecies error:", err);
    return [];
  }
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

  if (docs.length) {
    const dl = docs
      .map((d, i) => `(${i + 1}) ${d.content}${d.source ? ` [${d.source}${d.year ? `, ${d.year}` : ""}]` : ""}`)
      .join("\n");
    parts.push("[ข้อความจากงานวิจัย (ค้นด้วย semantic search)]\n" + dl);
  }

  return parts.join("\n\n");
}
