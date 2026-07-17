// สร้างตาราง wing_feature (ลักษณะปีกมาตรฐานของ Culicoides — genus-level) + seed
// ใช้เป็นชุด feature ให้ /api/annotate ชี้ตำแหน่งบนภาพ (แทนการให้ LLM คิดเอง)
// รัน:  node --env-file=.env scripts/setup-wing-features.mjs
// (เทียบเท่า supabase/migrations/0002_wing_features.sql)

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ลักษณะปีกมาตรฐานที่ใช้จำแนก Culicoides (ความรู้กีฏวิทยาจริง, genus-level)
const FEATURES = [
  { en: "Wing pattern", th: "ลวดลายปีก (จุดจาง/เข้ม)", d: "รูปแบบจุดสีจาง–เข้มบนแผ่นปีก ตัวช่วยหลักในการจำแนกชนิด", sort: 1 },
  { en: "r-m crossvein", th: "เส้นขวาง r-m", d: "เส้นขวางเชื่อมระหว่างเส้นเรเดียส (R) กับมีเดีย (M)", sort: 2 },
  { en: "Radial cells (r1, r2)", th: "เซลล์เรเดียล (r1, r2)", d: "เซลล์บริเวณขอบหน้าปีกใกล้ปลาย costa รูปร่าง/ขนาดใช้จำแนก", sort: 3 },
  { en: "Costal margin", th: "ขอบปีกด้านหน้า (costa)", d: "ขอบปีกด้านหน้าและปลาย costa", sort: 4 },
  { en: "Macrotrichia", th: "ขนใหญ่บนปีก (macrotrichia)", d: "ขนใหญ่ที่กระจายบนแผ่นปีก ความหนาแน่น/การกระจายใช้จำแนก", sort: 5 },
  { en: "Wing apex", th: "ปลายปีก", d: "ส่วนปลายสุดของปีก รูปทรงมน/แหลม", sort: 6 },
  { en: "Wing base / anal region", th: "โคนปีก / บริเวณ anal", d: "โคนปีกและเซลล์ anal", sort: 7 },
];

async function main() {
  await prisma.$executeRawUnsafe(`
    create table if not exists wing_feature (
      id          bigint generated always as identity primary key,
      name_en     text not null unique,
      name_th     text not null,
      description text,
      sort        int  not null default 0
    )
  `);
  await prisma.$executeRawUnsafe(`alter table wing_feature enable row level security`);
  await prisma.$executeRawUnsafe(`drop policy if exists "public read wing_feature" on wing_feature`);
  await prisma.$executeRawUnsafe(`create policy "public read wing_feature" on wing_feature for select using (true)`);

  for (const f of FEATURES) {
    await prisma.$executeRaw`
      insert into wing_feature (name_en, name_th, description, sort)
      values (${f.en}, ${f.th}, ${f.d}, ${f.sort})
      on conflict (name_en) do update
        set name_th = excluded.name_th, description = excluded.description, sort = excluded.sort
    `;
  }

  const n = await prisma.$queryRawUnsafe(`select count(*)::int as n from wing_feature`);
  console.log("wing_feature:", n[0].n, "rows");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
