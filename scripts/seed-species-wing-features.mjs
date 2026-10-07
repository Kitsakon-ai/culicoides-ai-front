// นำเข้าลักษณะปีกเฉพาะชนิดจาก data/knowledge/species-wing-features.json → ตาราง species_wing_feature
//
// ก่อนหน้านี้ตารางนี้ว่าง (0 แถว) ทุกชนิดจึงได้คำบรรยายระดับสกุลชุดเดียวกัน 7 ข้อ
// คำอธิบายที่ AI เขียนออกมาเลยเป็นเรื่องพื้นฐานที่ใช้กับ Culicoides ทุกชนิด ไม่ได้บอกว่าชนิดนี้ต่างจากชนิดอื่นตรงไหน
//
// รัน:  node --env-file=.env scripts/seed-species-wing-features.mjs
//       node --env-file=.env scripts/seed-species-wing-features.mjs --dry   (ตรวจอย่างเดียว ไม่เขียน)
//
// รันซ้ำได้: ลบแถวเดิมของ 4 ชนิดนี้แล้วใส่ใหม่ทั้งหมด ไฟล์ JSON จึงเป็นแหล่งข้อมูลจริงแหล่งเดียว

import fs from "fs";
import { PrismaClient } from "@prisma/client";

const DRY = process.argv.includes("--dry");
const data = JSON.parse(fs.readFileSync(new URL("../data/knowledge/species-wing-features.json", import.meta.url), "utf8"));
const prisma = new PrismaClient();

/** "J46, W25" → ข้อความอ้างอิงเต็มต่อกัน เก็บในคอลัมน์ source เพื่อให้ตรวจย้อนกลับได้จากฐานข้อมูลเอง */
function expandSource(keys) {
  return keys
    .split(",")
    .map((k) => k.trim())
    .map((k) => {
      const full = data.sources[k];
      if (!full) throw new Error(`ไม่พบรหัสอ้างอิง "${k}" ในหัวข้อ sources`);
      return full;
    })
    .join(" | ");
}

/** รหัสอ้างอิงในคำบรรยาย ("P21", "SU21 Fig.2") → ชื่อผู้แต่ง-ปี
 *  ตรรกะเดียวกับ expandCodes/shortCite ใน lib/wing-landmarks.ts (สคริปต์ .mjs import ไฟล์ TS ไม่ได้) */
function shortCite(code) {
  const full = data.sources[code];
  const year = full.match(/\((\d{4})\)/)?.[1] ?? "";
  const authors = full.slice(0, full.indexOf("(")).trim();
  const first = authors.split(",")[0].trim();
  const many = (authors.match(/,/g) ?? []).length;
  const second = authors.match(/&\s*([^,]+?),/)?.[1]?.trim();
  return `${many >= 3 ? `${first} et al.` : second ? `${first} & ${second}` : first} ${year}`.trim();
}
const expandCodes = (t) => t.replace(/\b[A-Z]{1,3}\d{2}\b/g, (c) => (data.sources[c] ? shortCite(c) : c));

async function main() {
  // จุดสังเกตที่ละเอียดกว่า 7 จุดเดิม (เช่น จุดใสใต้ stigma) — เพิ่มเข้าแคตตาล็อกก่อน
  // ชนิดต่าง ๆ จะได้อ้างถึงตำแหน่งเดียวกันด้วยชื่อเดียวกัน (เทียบเท่า migration 0005)
  for (const c of data.catalog_additions ?? []) {
    console.log(`แคตตาล็อก: ${c.name_en}`);
    if (DRY) continue;
    await prisma.$executeRaw`
      insert into wing_feature (name_en, name_th, description, sort)
      values (${c.name_en}, ${c.name_th}, ${c.description}, ${c.sort})
      on conflict (name_en) do update
        set name_th = excluded.name_th, description = excluded.description, sort = excluded.sort
    `;
  }

  const catalog = await prisma.$queryRawUnsafe(`select id, name_en from wing_feature`);
  // --dry ยังไม่ได้เพิ่มแคตตาล็อกจริง ให้ถือว่าชื่อใหม่มีแล้วเพื่อตรวจส่วนที่เหลือต่อได้
  if (DRY) for (const c of data.catalog_additions ?? []) catalog.push({ id: -1, name_en: c.name_en });
  const featureId = new Map(catalog.map((r) => [r.name_en, r.id]));

  let written = 0;
  for (const sp of data.species) {
    const rows = await prisma.$queryRaw`
      select id from species where lower(scientific_name) = lower(${sp.scientific_name}) limit 1
    `;
    if (!rows.length) throw new Error(`ไม่พบ ${sp.scientific_name} ในตาราง species`);
    const speciesId = rows[0].id;

    // ตรวจทุกแถวให้ผ่านก่อนเขียน — ชื่อสะกดผิดตัวเดียวจะไม่ทำให้ชนิดนั้นเหลือข้อมูลครึ่งเดียว
    const prepared = sp.features.map((f) => {
      const wfId = featureId.get(f.name_en);
      if (!wfId) throw new Error(`[${sp.species}] "${f.name_en}" ไม่ตรงกับแคตตาล็อก wing_feature`);
      const level = {
        species: "ระดับชนิด",
        subgenus: `ระดับสกุลย่อย ${sp.subgenus}`,
        population: "ประชากรในไทย",
        figure: "สังเกตจากภาพปีกในเอกสาร ยังไม่มีข้อความตีพิมพ์รองรับ",
      }[f.level];
      if (!level) throw new Error(`[${sp.species}] level "${f.level}" ไม่รู้จัก`);
      return { wfId, description: `${expandCodes(f.description_th)} (${level})`, source: expandSource(f.source), name: f.name_en };
    });

    console.log(`${sp.scientific_name} (id ${speciesId}) — ${prepared.length} ลักษณะ: ${prepared.map((p) => p.name).join(", ")}`);
    if (DRY) continue;

    await prisma.$transaction([
      prisma.$executeRaw`delete from species_wing_feature where species_id = ${speciesId}`,
      ...prepared.map((p) => prisma.$executeRaw`
        insert into species_wing_feature (species_id, wing_feature_id, description, source)
        values (${speciesId}, ${p.wfId}, ${p.description}, ${p.source})
      `),
    ]);
    written += prepared.length;
  }

  console.log(DRY ? "\n(--dry) ตรวจผ่าน ไม่ได้เขียนฐานข้อมูล" : `\nเขียน species_wing_feature แล้ว ${written} แถว`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("ล้มเหลว:", e.message);
  await prisma.$disconnect();
  process.exit(1);
});
