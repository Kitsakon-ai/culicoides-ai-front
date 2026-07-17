// สกัดคู่ (Culicoides species, จังหวัดไทย) จากเปเปอร์ ด้วย LLM (gpt-4o-mini — เลี่ยง opus ที่โดน bio refuse)
// อ่านข้อความเปเปอร์จาก data/knowledge/documents.json (รวม chunk ตาม source)
// เขียนผลเป็น data/knowledge/species-provinces.json ในรูปแบบที่ import-knowledge.mjs ใช้ได้เลย
// **ให้ตรวจไฟล์ก่อน** แล้วค่อย: node --env-file=.env scripts/import-knowledge.mjs data/knowledge/species-provinces.json
//
// รัน:  node --env-file=.env scripts/extract_provinces.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const MODEL = process.env.EXTRACT_MODEL || "gpt-4o-mini";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["records"],
  properties: {
    records: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["species", "province_en", "province_th", "evidence"],
        properties: {
          species: { type: "string" },
          province_en: { type: "string" },
          province_th: { type: "string" },
          evidence: { type: "string" },
        },
      },
    },
  },
};

function normalizeEpithet(s) {
  if (!s) return "";
  let t = String(s).trim().replace(/^culicoides\s+/i, "").replace(/^C\.\s*/i, "").trim();
  t = (t.split(/\s+/)[0] || "").replace(/[^A-Za-z-]/g, "");
  return t;
}

function cleanProvinceTh(s) {
  return String(s || "").replace(/^จังหวัด/, "").trim();
}

async function extractFromPaper(text, source) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Missing OPENAI_API_KEY");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You extract occurrence records from an entomology research paper. " +
            "Return every (Culicoides species, Thai province) pair where the paper reports that the species was " +
            "collected / found / recorded / present in that province in Thailand. " +
            "Use ONLY what the paper explicitly states — do not infer or add general knowledge. " +
            "species = the scientific name (genus + epithet, e.g. 'Culicoides guttifer'). " +
            "province_th = the Thai name of the province (translate the English name), province_en = the English name. " +
            "evidence = a short quote/context from the paper. If none, return an empty list.",
        },
        {
          role: "user",
          content: `Paper source: ${source}\n\n${text.slice(0, 120000)}`,
        },
      ],
      response_format: { type: "json_schema", json_schema: { name: "occurrences", schema: SCHEMA, strict: true } },
    }),
  });

  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  try {
    return JSON.parse(data.choices[0].message.content).records || [];
  } catch {
    return [];
  }
}

async function main() {
  const docs = JSON.parse(readFileSync("data/knowledge/documents.json", "utf8"));

  // รวมข้อความเปเปอร์ตาม source
  const bySource = new Map();
  for (const d of docs) {
    const src = d.source || "unknown";
    if (!bySource.has(src)) bySource.set(src, { text: "", year: d.year ?? null });
    bySource.get(src).text += " " + d.content;
  }

  // species -> { scientific_name, genus, provinces: Map(province -> Set(source)) }
  const species = new Map();

  for (const [src, { text }] of bySource) {
    process.stdout.write(`สกัด: ${src} ... `);
    let records = [];
    try {
      records = await extractFromPaper(text, src);
    } catch (e) {
      console.log(`ERR ${e.message}`);
      continue;
    }
    console.log(`${records.length} records`);

    for (const r of records) {
      const epithet = normalizeEpithet(r.species);
      const prov = cleanProvinceTh(r.province_th);
      if (!epithet || !prov) continue;
      const key = epithet.toLowerCase();
      if (!species.has(key)) {
        species.set(key, { scientific_name: `Culicoides ${epithet}`, genus: "Culicoides", provinces: new Map() });
      }
      const pm = species.get(key).provinces;
      if (!pm.has(prov)) pm.set(prov, new Set());
      pm.get(prov).add(src);
    }
  }

  const out = [...species.values()]
    .sort((a, b) => a.scientific_name.localeCompare(b.scientific_name))
    .map((s) => ({
      scientific_name: s.scientific_name,
      genus: s.genus,
      provinces: [...s.provinces.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], "th"))
        .map(([province, sources]) => ({ province, source: [...sources].join("; ") })),
    }));

  mkdirSync("data/knowledge", { recursive: true });
  const outPath = "data/knowledge/species-provinces.json";
  writeFileSync(outPath, JSON.stringify(out, null, 1), "utf8");

  console.log("\n── สรุป (ตรวจก่อน import) ──");
  for (const s of out) {
    console.log(`${s.scientific_name}: ${s.provinces.map((p) => p.province).join(", ") || "(ไม่มี)"}`);
  }
  console.log(`\nเขียน ${out.length} ชนิด -> ${outPath}`);
  console.log("ตรวจไฟล์แล้วรัน: node --env-file=.env scripts/import-knowledge.mjs data/knowledge/species-provinces.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
