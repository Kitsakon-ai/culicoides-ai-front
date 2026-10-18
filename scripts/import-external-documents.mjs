// นำงานวิจัยภายนอก (Europe PMC, ย้อนหลัง 5 ปี) เข้าตาราง documents + แก้ข้อมูลคลังเดิม
// ข้อมูลมาจากการทดลอง benchmark/rag-sources (embedding คำนวณไว้แล้ว ไม่ต้องเรียก OpenAI ซ้ำ)
//
// รัน (จากโฟลเดอร์ culicoides-ai-front):
//   node --env-file=.env scripts/import-external-documents.mjs --dry       ดูแผนอย่างเดียว ไม่เขียน
//   node --env-file=.env scripts/import-external-documents.mjs             สำรอง → แก้ → นำเข้า → ผูกชนิด
//   node --env-file=.env scripts/import-external-documents.mjs --rollback  ย้อนทุกอย่างจากไฟล์สำรอง
//
// สิ่งที่ทำ
//   1. สำรอง documents, document_species, species_reference เป็น JSON (มี embedding ครบ)
//   2. ลบไฟล์ซ้ำของ Gopurenko et al. 2022 ("2022-Culicoides barcode JME" ซ้ำกับฉบับวารสาร)
//   3. เปลี่ยน documents.source ของ databaseAi จากชื่อไฟล์เป็นบรรณานุกรมเต็ม + DOI
//      (พรอมต์ใหม่แสดงแหล่งเป็นการ์ด [S#] — โมเดลอ้างได้ถูกฉบับ)
//   4. แก้ species_reference: แถวซ้ำของ Gopurenko, ปี/DOI ที่หายหรือผิด
//   5. เพิ่มย่อหน้างานวิจัยภายนอก แล้วผูกชนิดด้วยกติกาเดียวกับ scripts/link-documents.mjs

import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const MODE = process.argv[2] ?? "run";
const DATA = path.resolve("../benchmark/rag-sources/data");
const BACKUP = path.join(DATA, "db-backup");
const MANIFEST = path.join(BACKUP, "manifest.json");
const BATCH = 100;
const NUL = String.fromCharCode(0);
const clean = (s) => String(s).split(NUL).join("");
const big = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === "bigint" ? Number(v) : v)));

// ── บรรณานุกรมที่เก็บใน documents.source ──
const DUPLICATE_SOURCE = "2022-Culicoides barcode JME";
const CLOSED_DOI = {
  "2021-Culicoides PNTD 1": "10.1371/journal.pntd.0010014",
  "2022- First co evident tropicalmed-07-00379 3": "10.3390/tropicalmed7110379",
  "2022-DNA Barcoding of Culicoides Latreille": "10.1093/jme/tjac142",
  "2022-Molecular Identification Host Blood Meals Parasites Insects": "10.3390/insects13100912",
  "2024-blood meals culicoides para&vectors": "10.1186/s13071-024-06487-z",
  "2024-seasonal abundance culicoides insects": "10.3390/insects15090701",
  "2025-DNA barcoding of Culicoides biting midges Para vectors 1": "10.1186/s13071-025-06812-0",
  "2026- Wolbachia and Cardinium CurrentPara": "10.1016/j.crpvbd.2026.100387",
  "2026-Trypanosomatid detection in Culicoides biting midges": "10.1016/j.meegid.2026.105912",
};
const PREPRINT = /research square|biorxiv|medrxiv|ssrn|preprints\.org/i;
// เรื่องที่ซ้ำกันในคลังภายนอก (preprint กับฉบับวารสาร / ระเบียน PMC ที่ไม่มี DOI) — เก็บฉบับวารสารหรือฉบับเต็ม
const EXTERNAL_DROP = new Set(["E4", "E46", "E167", "E246"]);
const EXTERNAL_DOI = { E2: "10.3390/insects17060647" }; // E2 = ฉบับเต็มของ E4 แต่ระเบียน PMC ไม่มี DOI

function citation({ authors, year, title, journal, doi, url }) {
  const names = String(authors ?? "").replace(/\.$/, "").split(",").map((s) => s.trim()).filter(Boolean);
  const surname = (names[0] ?? "Anon").split(" ").slice(0, -1).join(" ") || names[0] || "Anon";
  const who = names.length > 1 ? `${surname} et al.` : surname;
  const t = String(title ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().replace(/\.$/, "");
  const j = String(journal ?? "").split(" : ")[0].trim();
  const link = doi ? `https://doi.org/${doi}` : url ?? "";
  const pre = PREPRINT.test(j) ? " [preprint ยังไม่ผ่านการประเมินโดยผู้ทรงคุณวุฒิ]" : "";
  return `${who} (${year}). ${t}. ${j}.${pre} ${link}`.trim();
}

function externalRows() {
  const papers = JSON.parse(fs.readFileSync(path.join(DATA, "external-papers.json"), "utf8")).papers;
  const byId = Object.fromEntries(papers.map((p) => [p.id, p]));
  const chunks = JSON.parse(fs.readFileSync(path.join(DATA, "external-chunks.json"), "utf8"));
  const buf = fs.readFileSync(path.join(DATA, "external-embeddings.f32"));
  const vecs = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  if (vecs.length !== chunks.length * 1536) throw new Error("จำนวน embedding ไม่ตรงกับจำนวนย่อหน้า");
  const srcOf = new Map();
  for (const p of papers) {
    const url = p.pmcid ? `https://europepmc.org/article/PMC/${p.pmcid}` : p.pmid ? `https://europepmc.org/article/MED/${p.pmid}` : `https://europepmc.org/search?query=${encodeURIComponent(p.epmc)}`;
    srcOf.set(p.id, citation({ authors: p.authors, year: p.year, title: p.title, journal: p.journal, doi: EXTERNAL_DOI[p.id] ?? p.doi, url }));
  }
  return chunks
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !EXTERNAL_DROP.has(c.paper))
    .map(({ c, i }) => ({
      content: clean(c.content),
      source: srcOf.get(c.paper),
      year: byId[c.paper].year,
      vec: `[${Array.from(vecs.subarray(i * 1536, (i + 1) * 1536)).join(",")}]`,
    }));
}

function closedRenames() {
  const meta = JSON.parse(fs.readFileSync(path.join(DATA, "closed-meta.json"), "utf8"));
  return Object.fromEntries(Object.entries(CLOSED_DOI).map(([file, doi]) => [file, citation({ ...meta[doi], doi })]));
}

// ── แก้ species_reference (ค้นด้วยข้อความขึ้นต้น เพราะ citation เดิมเขียนไม่ตรงกันทุกแถว) ──
const REF_FIXES = [
  {
    like: "Gopurenko et al. (2022). DNA Barcoding of Culicoides Latreille%",
    citation: "Gopurenko et al. (2022). DNA Barcoding of Culicoides Latreille (Diptera: Ceratopogonidae) From Thailand Reveals Taxonomic Inconsistencies and Novel Diversity Among Reported Sequences. Journal of Medical Entomology",
    doi: "https://doi.org/10.1093/jme/tjac142", year: 2022,
  },
  {
    like: "Sunantaraporn et al. Molecular identification and characterization of Wolbachia%",
    citation: "Sunantaraporn et al. (2026). Molecular identification and characterization of Wolbachia and Cardinium with co-occurrence of Leishmania spp. in Culicoides biting midges (Diptera: Ceratopogonidae) from leishmaniasis-affected areas of Thailand. Current Research in Parasitology & Vector-Borne Diseases",
    doi: "https://doi.org/10.1016/j.crpvbd.2026.100387", year: 2026,
  },
  {
    like: "Tepboonrueng et al. (2023). Trypanosomatid detection%",
    citation: "Tepboonrueng et al. (2026). Trypanosomatid detection in Culicoides biting midges (Diptera: Ceratopogonidae) from leishmaniasis-endemic Songkhla Province, Southern Thailand: Microscopy and nanopore metabarcoding reveal parasite diversity. Infection, Genetics and Evolution",
    doi: "https://doi.org/10.1016/j.meegid.2026.105912", year: 2026,
  },
];

async function backup() {
  fs.mkdirSync(BACKUP, { recursive: true });
  const docs = big(await prisma.$queryRawUnsafe(`select id, content, source, year, embedding::text as embedding from documents order by id`));
  const links = big(await prisma.$queryRawUnsafe(`select document_id, species_id from document_species`));
  const refs = big(await prisma.$queryRawUnsafe(`select * from species_reference order by id`));
  fs.writeFileSync(path.join(BACKUP, "documents.json"), JSON.stringify(docs));
  fs.writeFileSync(path.join(BACKUP, "document_species.json"), JSON.stringify(links));
  fs.writeFileSync(path.join(BACKUP, "species_reference.json"), JSON.stringify(refs, null, 1));
  console.log(`สำรองแล้ว: documents ${docs.length}, document_species ${links.length}, species_reference ${refs.length} → ${BACKUP}`);
  return { docs, links, refs };
}

async function run(dry) {
  if (fs.existsSync(MANIFEST)) throw new Error(`นำเข้าไปแล้ว (${MANIFEST}) — ถ้าจะทำใหม่ให้ --rollback ก่อน`);
  const ext = externalRows();
  const renames = closedRenames();
  const [{ n, mx }] = big(await prisma.$queryRawUnsafe(`select count(*) n, coalesce(max(id),0) mx from documents`));
  const dup = big(await prisma.$queryRawUnsafe(`select count(*) n from documents where source = $1`, DUPLICATE_SOURCE))[0].n;
  console.log(`documents ตอนนี้ ${n} แถว (id สูงสุด ${mx}) · ไฟล์ซ้ำที่จะลบ ${dup} แถว · ย่อหน้าภายนอกที่จะเพิ่ม ${ext.length}`);
  console.log("เปลี่ยนชื่อแหล่งของ databaseAi:");
  for (const [a, b] of Object.entries(renames)) console.log(`  ${a}\n    → ${b}`);
  console.log("ตัวอย่างแหล่งภายนอก:", [...new Set(ext.map((r) => r.source))].slice(0, 3));
  if (dry) return;

  const { refs } = await backup();
  const manifest = { date: new Date().toISOString(), maxIdBefore: mx, renames, refFixes: [], deletedDuplicate: [] };
  const save = () => fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));

  // 2. ลบไฟล์ซ้ำ (document_species ลบตามเองด้วย on delete cascade)
  manifest.deletedDuplicate = big(await prisma.$queryRawUnsafe(`delete from documents where source = $1 returning id`, DUPLICATE_SOURCE)).map((r) => r.id);
  save();
  console.log(`ลบไฟล์ซ้ำ ${manifest.deletedDuplicate.length} แถว`);

  // 3. ชื่อแหล่งของ databaseAi → บรรณานุกรม
  for (const [from, to] of Object.entries(renames)) {
    const k = await prisma.$executeRawUnsafe(`update documents set source = $1 where source = $2`, to, from);
    console.log(`  เปลี่ยนแหล่ง ${k} แถว: ${from}`);
  }

  // 4. species_reference
  for (const fx of REF_FIXES) {
    const rows = refs.filter((r) => r.citation.startsWith(fx.like.replace(/%$/, "")));
    const seen = new Set();
    for (const r of rows) {
      const key = String(r.species_id);
      if (seen.has(key)) {
        await prisma.$executeRawUnsafe(`delete from species_reference where id = $1`, r.id);
        manifest.refFixes.push({ id: r.id, action: "delete-duplicate" });
      } else {
        seen.add(key);
        await prisma.$executeRawUnsafe(`update species_reference set citation = $1, doi_or_url = $2, year = $3 where id = $4`, fx.citation, fx.doi, fx.year, r.id);
        manifest.refFixes.push({ id: r.id, action: "update" });
      }
    }
    console.log(`  แก้อ้างอิง ${rows.length} แถว (ซ้ำ ${rows.length - seen.size}): ${fx.like.slice(0, 60)}`);
  }
  save();

  // 5. เพิ่มย่อหน้าภายนอก
  for (let i = 0; i < ext.length; i += BATCH) {
    const slice = ext.slice(i, i + BATCH);
    const params = [];
    const values = slice.map((r, j) => {
      params.push(r.content, r.source, r.year, r.vec);
      return `($${j * 4 + 1}, $${j * 4 + 2}, $${j * 4 + 3}, $${j * 4 + 4}::vector)`;
    });
    await prisma.$executeRawUnsafe(`insert into documents (content, source, year, embedding) values ${values.join(",")}`, ...params);
    if ((i / BATCH) % 10 === 0 || i + BATCH >= ext.length) console.log(`  เพิ่มแล้ว ${Math.min(i + BATCH, ext.length)}/${ext.length}`);
  }
  const ids = big(await prisma.$queryRawUnsafe(`select id, content from documents where id > $1 order by id`, mx));
  manifest.inserted = { count: ids.length, minId: ids[0]?.id, maxId: ids.at(-1)?.id };
  save();
  if (ids.length !== ext.length) console.warn(`⚠️ เพิ่มได้ ${ids.length} แถว ไม่ตรงกับ ${ext.length}`);

  // ผูกชนิด — กติกาเดียวกับ scripts/link-documents.mjs (epithet แบบ whole-word)
  const species = big(await prisma.$queryRawUnsafe(`select id, scientific_name from species`));
  const matchers = species.map((s) => ({ id: s.id, re: new RegExp(`\\b${s.scientific_name.replace(/^Culicoides\s+/i, "").trim()}\\b`, "i") }));
  const links = [];
  for (const d of ids) for (const m of matchers) if (m.re.test(d.content)) links.push([d.id, m.id]);
  for (let i = 0; i < links.length; i += 500) {
    const slice = links.slice(i, i + 500);
    await prisma.$executeRawUnsafe(
      `insert into document_species (document_id, species_id) values ${slice.map((_, j) => `($${j * 2 + 1}, $${j * 2 + 2})`).join(",")} on conflict do nothing`,
      ...slice.flat()
    );
  }
  manifest.links = links.length;
  save();
  console.log(`ผูกชนิด ${links.length} ลิงก์`);

  const after = big(await prisma.$queryRawUnsafe(`select count(*) n, count(distinct source) s from documents`))[0];
  const per = big(await prisma.$queryRawUnsafe(`select s.scientific_name, count(*) n from document_species ds join species s on s.id = ds.species_id where s.scientific_name in ('Culicoides guttifer','Culicoides mahasarakhamense','Culicoides oxystoma','Culicoides peregrinus') group by 1 order by 1`));
  console.log(`เสร็จ: documents ${after.n} แถว จาก ${after.s} แหล่ง ·`, per.map((r) => `${r.scientific_name.split(" ")[1]} ${r.n}`).join(", "));
}

async function rollback() {
  const m = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  const docs = JSON.parse(fs.readFileSync(path.join(BACKUP, "documents.json"), "utf8"));
  const links = JSON.parse(fs.readFileSync(path.join(BACKUP, "document_species.json"), "utf8"));
  const refs = JSON.parse(fs.readFileSync(path.join(BACKUP, "species_reference.json"), "utf8"));
  const del = await prisma.$executeRawUnsafe(`delete from documents where id > $1`, m.maxIdBefore);
  console.log(`ลบย่อหน้าที่เพิ่ม ${del} แถว`);
  for (const [from, to] of Object.entries(m.renames)) await prisma.$executeRawUnsafe(`update documents set source = $1 where source = $2`, from, to);
  const dupIds = new Set(m.deletedDuplicate);
  for (const d of docs.filter((x) => dupIds.has(x.id))) {
    await prisma.$executeRawUnsafe(`insert into documents (id, content, source, year, embedding) overriding system value values ($1, $2, $3, $4, $5::vector)`, d.id, d.content, d.source, d.year, d.embedding);
  }
  for (const l of links.filter((x) => dupIds.has(x.document_id))) {
    await prisma.$executeRawUnsafe(`insert into document_species (document_id, species_id) values ($1, $2) on conflict do nothing`, l.document_id, l.species_id);
  }
  for (const fx of m.refFixes) {
    const r = refs.find((x) => x.id === fx.id);
    if (fx.action === "update") await prisma.$executeRawUnsafe(`update species_reference set citation = $1, doi_or_url = $2, year = $3 where id = $4`, r.citation, r.doi_or_url, r.year, r.id);
    else await prisma.$executeRawUnsafe(`insert into species_reference (id, species_id, citation, doi_or_url, year) overriding system value values ($1, $2, $3, $4, $5)`, r.id, r.species_id, r.citation, r.doi_or_url, r.year);
  }
  fs.renameSync(MANIFEST, MANIFEST.replace(/\.json$/, `.rolled-back-${Date.now()}.json`));
  console.log("ย้อนกลับเสร็จ");
}

try {
  if (MODE === "--rollback") await rollback();
  else await run(MODE === "--dry");
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
