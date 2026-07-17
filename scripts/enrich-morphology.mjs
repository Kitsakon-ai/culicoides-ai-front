// เติม morphology_feature (ลักษณะปีกรายชนิด) จากความรู้อนุกรมวิธานมาตรฐาน
//   - guard: ถ้าโมเดลไม่มั่นใจลายปีกเฉพาะชนิด (แยกจากชนิดอื่นในสกุลไม่ได้) → confident=false, ไม่ insert
//   - เขียน draft ทั้งหมดลง data/knowledge/morphology-draft.json ให้ผู้เชี่ยวชาญ review/แก้ก่อนใช้จริง
//   - insert เฉพาะชนิดที่ confident (annotation จะใช้ per-species แทน genus-level อัตโนมัติ)
//
// รัน:  node --env-file=.env scripts/enrich-morphology.mjs           (ทุกชนิด, insert confident)
//       node --env-file=.env scripts/enrich-morphology.mjs --dry     (ดู+เขียน draft, ไม่แตะ DB)
//       node --env-file=.env scripts/enrich-morphology.mjs peregrinus

import { PrismaClient } from "@prisma/client";
import { writeFileSync, mkdirSync } from "node:fs";

const prisma = new PrismaClient();
const OPENAI_KEY = process.env.OPENAI_API_KEY;

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const targetEpithet = args.find((a) => !a.startsWith("--"));

const SYSTEM = `คุณเป็นผู้เชี่ยวชาญอนุกรมวิธานริ้นดูดเลือดสกุล Culicoides (Diptera: Ceratopogonidae)
อ้างอิงคำบรรยายลักษณะปีกจากวรรณกรรมอนุกรมวิธานมาตรฐาน (เช่น Wirth & Hubert 1989 "The Culicoides of Southeast Asia" และ taxonomic keys ที่เกี่ยวข้อง)
งาน: ให้ "ลักษณะปีกที่ใช้จำแนกชนิดนี้" สำหรับระบบ AI ที่ชี้ตำแหน่งบนภาพปีก

ตอบเป็น JSON เท่านั้น:
{
  "confident": true/false,
  "wing_features": [ {"name_en":"...", "name_th":"...", "description":"..."} ]
}

กติกา (สำคัญ — ห้ามเดา):
- ให้ลักษณะปีก 4-6 จุด ที่ "ระบุตำแหน่งบนภาพปีกได้จริง" และเป็นลักษณะเชิงจำแนกของชนิดนี้
  (เช่น รูปแบบ pale/dark spot บน cell ที่เจาะจง, เส้นขวาง r-m, radial cells r1/r2, ปลายปีก, โคนปีก)
- name_en = อังกฤษ, name_th = ไทย, description = ไทยสั้น ๆ ระบุว่าเด่นอย่างไรในชนิดนี้ (เช่น "มี pale spot คร่อม r-m")
- ถ้าคุณไม่ทราบลายปีกเฉพาะชนิดนี้อย่างมั่นใจพอจะแยกจากชนิดอื่นในสกุลได้ → confident=false และ wing_features=[]
  อย่าให้ลักษณะกลาง ๆ ระดับสกุลแล้วอ้างว่าเป็นของชนิดนี้`;

async function generate(scientificName) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `ชนิด: ${scientificName}` },
      ],
    }),
  });
  if (!res.ok) throw new Error("OpenAI " + res.status + " " + (await res.text()));
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

async function main() {
  if (!OPENAI_KEY) throw new Error("ไม่มี OPENAI_API_KEY");

  let rows;
  if (targetEpithet) {
    rows = await prisma.$queryRawUnsafe(
      `select id, scientific_name from species where lower(scientific_name)=lower('Culicoides ${targetEpithet}') or lower(scientific_name)=lower('${targetEpithet}')`
    );
    if (!rows.length) throw new Error("ไม่พบชนิด: " + targetEpithet);
  } else {
    rows = await prisma.$queryRawUnsafe(`select id, scientific_name from species order by scientific_name`);
  }

  console.log((DRY ? "[DRY-RUN] " : "") + "morphology " + rows.length + " ชนิด");
  const draft = [];
  let confidentCount = 0;

  for (const sp of rows) {
    const id = Number(sp.id);
    try {
      const out = await generate(sp.scientific_name);
      const wf = Array.isArray(out.wing_features) ? out.wing_features.filter((f) => f && f.name_en && f.name_th) : [];
      const confident = out.confident === true && wf.length > 0;

      draft.push({ species: sp.scientific_name, confident, wing_features: wf });
      console.log(`\n━━━ ${sp.scientific_name} · confident=${confident} · ${wf.length} จุด ${confident ? "" : "→ ข้าม (คง genus-level)"}`);
      wf.forEach((f, i) => console.log(`   ${i + 1}. ${f.name_en} / ${f.name_th} — ${f.description || ""}`));

      if (confident) {
        confidentCount++;
        if (!DRY) {
          await prisma.$executeRawUnsafe(`delete from morphology_feature where species_id=${id}`);
          for (const f of wf) {
            await prisma.$executeRaw`insert into morphology_feature (species_id, name_en, name_th, description)
              values (${id}, ${f.name_en}, ${f.name_th}, ${f.description ?? null})`;
          }
        }
      }
    } catch (e) {
      console.error("  ! error", sp.scientific_name, e.message);
      draft.push({ species: sp.scientific_name, confident: false, wing_features: [], error: e.message });
    }
  }

  // เขียน draft ให้ผู้เชี่ยวชาญ review เสมอ
  mkdirSync("data/knowledge", { recursive: true });
  writeFileSync("data/knowledge/morphology-draft.json", JSON.stringify(draft, null, 2), "utf8");

  await prisma.$disconnect();
  console.log(`\nเสร็จ — confident ${confidentCount}/${rows.length} ชนิด${DRY ? " (dry, ไม่เขียน DB)" : " (insert แล้ว)"}`);
  console.log("draft: data/knowledge/morphology-draft.json (review/แก้ได้)");
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
