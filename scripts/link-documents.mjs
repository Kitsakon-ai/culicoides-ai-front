// ผูก document chunks เข้ากับชนิด (deterministic — จับคู่ชื่อ epithet แบบ whole-word ไม่ใช้ LLM)
// สร้าง join table document_species (many-to-many) แล้วเติมลิงก์
// ทำให้ RAG ดึงเฉพาะงานวิจัยที่ "พูดถึงชนิดนั้นจริง" ได้ (แม่นกว่า global semantic)
//
// รัน:  node --env-file=.env scripts/link-documents.mjs

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // ตาราง join
  await prisma.$executeRawUnsafe(`
    create table if not exists document_species (
      document_id bigint not null references documents(id) on delete cascade,
      species_id  bigint not null references species(id)  on delete cascade,
      primary key (document_id, species_id)
    )
  `);
  await prisma.$executeRawUnsafe(`create index if not exists idx_document_species_species on document_species(species_id)`);
  await prisma.$executeRawUnsafe(`alter table document_species enable row level security`);
  await prisma.$executeRawUnsafe(`drop policy if exists "public read document_species" on document_species`);
  await prisma.$executeRawUnsafe(`create policy "public read document_species" on document_species for select using (true)`);

  // เริ่มใหม่ทุกครั้ง (rerun ปลอดภัย)
  await prisma.$executeRawUnsafe(`truncate document_species`);

  const species = await prisma.$queryRawUnsafe(`select id, scientific_name from species order by scientific_name`);
  const docs = await prisma.$queryRawUnsafe(`select id, content, source, year from documents`);
  console.log(`species=${species.length} documents=${docs.length}`);

  // ตรวจ source ต่อปี (อธิบายปีที่ดูแปลก เช่น 2026)
  const byYearSource = {};
  for (const d of docs) {
    const k = `${d.year ?? "null"} · ${d.source ?? "?"}`;
    byYearSource[k] = (byYearSource[k] || 0) + 1;
  }
  console.log("\nsource ต่อปี:");
  Object.entries(byYearSource).sort().forEach(([k, n]) => console.log(`  ${k}: ${n}`));

  // เตรียม regex whole-word ต่อ epithet
  const matchers = species.map((s) => {
    const epithet = s.scientific_name.replace(/^Culicoides\s+/i, "").trim();
    return { id: Number(s.id), name: s.scientific_name, epithet, re: new RegExp(`\\b${epithet}\\b`, "i") };
  });

  const perSpecies = new Map(matchers.map((m) => [m.id, 0]));
  let links = 0, linkedDocs = 0;

  for (const d of docs) {
    const text = d.content || "";
    let hit = false;
    for (const m of matchers) {
      if (m.re.test(text)) {
        await prisma.$executeRaw`insert into document_species (document_id, species_id)
          values (${Number(d.id)}, ${m.id}) on conflict do nothing`;
        perSpecies.set(m.id, perSpecies.get(m.id) + 1);
        links++;
        hit = true;
      }
    }
    if (hit) linkedDocs++;
  }

  console.log(`\nลิงก์ทั้งหมด: ${links} | documents ที่ผูกได้อย่างน้อย 1 ชนิด: ${linkedDocs}/${docs.length}`);
  console.log("chunk ต่อชนิด (ที่ > 0):");
  matchers
    .map((m) => ({ name: m.name, n: perSpecies.get(m.id) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .forEach((x) => console.log(`  ${x.name}: ${x.n}`));

  await prisma.$disconnect();
  console.log("\nเสร็จ");
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
