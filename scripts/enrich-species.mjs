// เติม summary_th + vector_role ให้ชนิด Culicoides — grounded จากข้อมูลจริงในฐานข้อมูล
//   - summary_th: สรุปจาก references/จังหวัดที่มีจริง (ห้ามแต่งข้อเท็จจริง)
//   - vector_role: บทบาทพาหะเท่าที่ references รองรับ; ถ้าไม่มีหลักฐาน → '' (ไม่เดา)
//
// รัน:  node --env-file=.env scripts/enrich-species.mjs peregrinus      (ชนิดเดียว)
//       node --env-file=.env scripts/enrich-species.mjs --all           (ทุกชนิด)
//       เพิ่ม --dry เพื่อดูผลโดยไม่เขียนฐานข้อมูล

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const OPENAI_KEY = process.env.OPENAI_API_KEY;

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const ALL = args.includes("--all");
const targetEpithet = args.find((a) => !a.startsWith("--"));

const SYSTEM = `คุณเป็นผู้เชี่ยวชาญริ้นดูดเลือดสกุล Culicoides (Diptera: Ceratopogonidae)
งาน: สรุปข้อมูลชนิดสำหรับระบบ AI ช่วยจำแนก โดยอิงข้อมูลอ้างอิงที่ให้มาเท่านั้น

ตอบเป็น JSON เท่านั้น:
{
  "summary_th": "สรุป 2-3 ประโยคภาษาไทย",
  "vector_role": "วลีสั้นบทบาทพาหะ (ไทย) หรือ \\"\\" ถ้าอ้างอิงไม่รองรับ"
}

กติกา (สำคัญ — ห้ามเดา):
- summary_th: อิงเฉพาะ references + จังหวัดที่ให้มา + ข้อเท็จจริงชีววิทยาของ Culicoides ที่ยอมรับกว้างขวาง
  ห้ามแต่งชื่อจังหวัด/ตัวเลข/ข้อเท็จจริงที่ไม่มีในอ้างอิง
- vector_role: ระบุเชื้อ/โรคที่ references "รองรับจริง" เท่านั้น สั้นกระชับ
  เช่น "พาหะต้องสงสัยของ Leishmania martiniquensis และ L. orientalis (ภาคใต้ไทย)"
  ถ้า references เป็นแค่การเก็บตัวอย่าง/บาร์โค้ด/ยังไม่พบเชื้อ หรือไม่มีหลักฐานบทบาทพาหะ → vector_role = ""`;

async function generate(sp, provinces, references) {
  const ctx = [
    `ชนิด: ${sp.scientific_name}`,
    provinces.length ? `จังหวัดที่มีรายงานพบ (ฐานข้อมูล): ${provinces.join(", ")}` : `จังหวัด: (ไม่มีข้อมูล)`,
    references.length
      ? "เอกสารอ้างอิง:\n" + references.map((r) => `- ${r.citation}${r.year ? ` (${r.year})` : ""}`).join("\n")
      : "เอกสารอ้างอิง: (ไม่มี)",
  ].join("\n");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: ctx },
      ],
    }),
  });
  if (!res.ok) throw new Error("OpenAI " + res.status + " " + (await res.text()));
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

async function enrichOne(sp) {
  const id = Number(sp.id);
  const [prov, refs] = await Promise.all([
    prisma.$queryRawUnsafe(`select province from species_province where species_id=${id} order by province`),
    prisma.$queryRawUnsafe(`select citation, year from species_reference where species_id=${id} order by year desc nulls last`),
  ]);
  const provinces = prov.map((r) => r.province);
  const references = refs.map((r) => ({ citation: r.citation, year: r.year }));

  const out = await generate(sp, provinces, references);
  const summary = (out.summary_th || "").trim();
  const role = (out.vector_role || "").trim();

  console.log(`\n━━━ ${sp.scientific_name} (id=${id}) · ref=${references.length} ━━━`);
  console.log("summary_th :", summary || "(ว่าง)");
  console.log("vector_role:", role || "(ว่าง — อ้างอิงไม่รองรับ)");

  if (DRY) return;
  if (summary) await prisma.$executeRawUnsafe(`update species set summary_th=$1 where id=${id}`, summary);
  // vector_role: อัปเดตเมื่อมีค่าเท่านั้น (ไม่ล้างค่าเดิมทิ้งด้วยค่าว่าง)
  if (role) await prisma.$executeRawUnsafe(`update species set vector_role=$1 where id=${id}`, role);
}

async function main() {
  if (!OPENAI_KEY) throw new Error("ไม่มี OPENAI_API_KEY");
  let rows;
  if (ALL) {
    rows = await prisma.$queryRawUnsafe(`select id, scientific_name from species order by scientific_name`);
  } else {
    const ep = targetEpithet || "peregrinus";
    rows = await prisma.$queryRawUnsafe(
      `select id, scientific_name from species where lower(scientific_name)=lower('Culicoides ${ep}') or lower(scientific_name)=lower('${ep}')`
    );
    if (!rows.length) throw new Error("ไม่พบชนิด: " + ep);
  }
  console.log((DRY ? "[DRY-RUN] " : "") + "enrich " + rows.length + " ชนิด (summary_th + vector_role)");
  let okSummary = 0, okRole = 0;
  for (const sp of rows) {
    try {
      await enrichOne(sp);
      okSummary++;
    } catch (e) {
      console.error("  ! error", sp.scientific_name, e.message);
    }
  }
  await prisma.$disconnect();
  console.log(`\nเสร็จ (${okSummary}/${rows.length} ชนิด)`);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
