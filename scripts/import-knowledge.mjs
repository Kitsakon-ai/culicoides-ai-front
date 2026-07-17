// นำเข้าข้อมูล knowledge base เข้า Supabase (ผ่าน Prisma) + สร้าง embedding ให้ documents
//
// รัน:  node --env-file=.env scripts/import-knowledge.mjs data/knowledge/example.json
//       (Node 20.6+ รองรับ --env-file; ถ้าเวอร์ชันเก่า ให้ set DATABASE_URL / OPENAI_API_KEY เอง)
//
// ต้องรัน SQL migration (supabase/migrations/0001_knowledge_base.sql) ให้เสร็จก่อน
// รันซ้ำได้ (idempotent) — จะ upsert species แล้วเขียน children ใหม่ทั้งชุด

import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function embed(text) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Missing OPENAI_API_KEY");
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: "text-embedding-3-small", input: String(text).slice(0, 8000) }),
  });
  if (!res.ok) throw new Error(`OpenAI embeddings error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.data[0].embedding;
}

async function upsertSpecies(sp) {
  const rows = await prisma.$queryRaw`
    insert into species (scientific_name, genus, common_name_th, summary_th, vector_role)
    values (${sp.scientific_name}, ${sp.genus}, ${sp.common_name_th ?? null}, ${sp.summary_th ?? null}, ${sp.vector_role ?? null})
    on conflict (scientific_name) do update
      set genus          = excluded.genus,
          common_name_th = excluded.common_name_th,
          summary_th     = excluded.summary_th,
          vector_role    = excluded.vector_role
    returning id
  `;
  return Number(rows[0].id);
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node --env-file=.env scripts/import-knowledge.mjs <data.json>");
    process.exit(1);
  }

  const items = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(items)) throw new Error("ไฟล์ต้องเป็น JSON array ของชนิด");

  for (const sp of items) {
    const id = await upsertSpecies(sp);

    // เขียน children ใหม่ทั้งชุด เพื่อให้ import ซ้ำได้ผลลัพธ์เดิม
    await prisma.$executeRaw`delete from species_province   where species_id = ${id}`;
    await prisma.$executeRaw`delete from morphology_feature where species_id = ${id}`;
    await prisma.$executeRaw`delete from species_reference  where species_id = ${id}`;
    await prisma.$executeRaw`delete from documents          where species_id = ${id}`;

    for (const p of sp.provinces ?? []) {
      await prisma.$executeRaw`
        insert into species_province (species_id, province, source)
        values (${id}, ${p.province}, ${p.source ?? null})
        on conflict (species_id, province) do update set source = excluded.source
      `;
    }

    for (const f of sp.features ?? []) {
      await prisma.$executeRaw`
        insert into morphology_feature (species_id, name_en, name_th, description)
        values (${id}, ${f.name_en ?? null}, ${f.name_th ?? null}, ${f.description ?? null})
      `;
    }

    for (const r of sp.references ?? []) {
      await prisma.$executeRaw`
        insert into species_reference (species_id, citation, doi_or_url, year)
        values (${id}, ${r.citation}, ${r.doi_or_url ?? null}, ${r.year ?? null})
      `;
    }

    for (const d of sp.documents ?? []) {
      const vec = `[${(await embed(d.content)).join(",")}]`;
      await prisma.$executeRawUnsafe(
        `insert into documents (species_id, content, source, year, embedding)
         values ($1, $2, $3, $4, $5::vector)`,
        id,
        d.content,
        d.source ?? null,
        d.year ?? null,
        vec
      );
    }

    console.log(
      `✓ ${sp.scientific_name}: ${(sp.provinces ?? []).length} จังหวัด, ${(sp.features ?? []).length} features, ${(sp.references ?? []).length} refs, ${(sp.documents ?? []).length} docs`
    );
  }

  await prisma.$disconnect();
  console.log("เสร็จเรียบร้อย");
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
