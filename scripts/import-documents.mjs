// นำเข้า documents (RAG) จาก JSON เข้า Supabase: embed แบบ batch + insert ลงตาราง documents
//
// รัน:  node --env-file=.env scripts/import-documents.mjs                       # default data/knowledge/documents.json
//       node --env-file=.env scripts/import-documents.mjs data/knowledge/x.json
//
// ต้องรัน migration (supabase/migrations/0001_knowledge_base.sql) ก่อน
// idempotent: ลบ documents ทั่วไป (species_id = null) ของรอบก่อนแล้วใส่ใหม่
//
// รูปแบบ JSON: [{ "content": "...", "source": "...", "year": 2024, "species_name": "..." (optional) }]

import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const BATCH = 96; // จำนวน chunk ต่อ 1 คำขอ embedding
const NUL = String.fromCharCode(0);

// กัน NUL byte (0x00) ที่หลุดมาจากการสกัด PDF — Postgres text เก็บไม่ได้ (error 22021)
function clean(s) {
  return String(s).split(NUL).join("");
}

async function embedBatch(texts) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Missing OPENAI_API_KEY");
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: texts.map((t) => clean(t).slice(0, 8000)),
    }),
  });
  if (!res.ok) throw new Error(`OpenAI embeddings error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.data.map((d) => d.embedding); // ลำดับตรงกับ input
}

async function speciesIdByName(name) {
  if (!name) return null;
  try {
    const rows = await prisma.$queryRaw`
      select id from species
      where lower(scientific_name) = lower(${name})
         or lower(scientific_name) = lower(${"Culicoides " + name})
      limit 1
    `;
    return rows.length ? Number(rows[0].id) : null;
  } catch {
    return null;
  }
}

async function main() {
  const file = process.argv[2] || "data/knowledge/documents.json";
  const docs = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(docs)) throw new Error("ไฟล์ต้องเป็น JSON array ของ document");
  console.log(`อ่าน ${docs.length} chunks จาก ${file}`);

  // idempotent: ล้าง general docs (species_id null) ของรอบก่อน
  await prisma.$executeRaw`delete from documents where species_id is null`;

  let inserted = 0;
  for (let i = 0; i < docs.length; i += BATCH) {
    const slice = docs.slice(i, i + BATCH);
    const embs = await embedBatch(slice.map((d) => d.content));
    for (let j = 0; j < slice.length; j++) {
      const d = slice[j];
      const sid = await speciesIdByName(d.species_name);
      const vec = `[${embs[j].join(",")}]`;
      await prisma.$executeRawUnsafe(
        `insert into documents (species_id, content, source, year, embedding)
         values ($1, $2, $3, $4, $5::vector)`,
        sid,
        clean(d.content),
        d.source ?? null,
        d.year ?? null,
        vec
      );
      inserted++;
    }
    console.log(`  embedded+inserted ${Math.min(i + BATCH, docs.length)}/${docs.length}`);
  }

  await prisma.$disconnect();
  console.log(`เสร็จ: ใส่ ${inserted} documents`);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
