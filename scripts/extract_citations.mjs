// สกัด citation ทางการต่อเปเปอร์ (จาก front matter) ด้วย LLM แล้ว link เข้าแต่ละชนิดใน species-provinces.json
// (ชนิดถูกรายงานในเปเปอร์ไหน = อ้างอิงเปเปอร์นั้น) เพื่อเติมตาราง species_reference
//
// รัน:  node --env-file=.env scripts/extract_citations.mjs
// จากนั้น re-import: node --env-file=.env scripts/import-knowledge.mjs data/knowledge/species-provinces.json

import { readFileSync, writeFileSync } from "node:fs";

const MODEL = process.env.EXTRACT_MODEL || "gpt-4o-mini";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["authors", "year", "title", "journal", "doi_or_url"],
  properties: {
    authors: { type: "string" },
    year: { type: "integer" },
    title: { type: "string" },
    journal: { type: "string" },
    doi_or_url: { type: "string" },
  },
};

async function citationFor(frontText) {
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
            "Extract the bibliographic citation of this research paper from its front matter (title page). " +
            "Use ONLY what is present in the text. authors = author list (abbreviate with 'et al.' if long). " +
            "doi_or_url = the DOI/URL if present, else empty string. year = publication year (integer, 0 if unknown).",
        },
        { role: "user", content: frontText.slice(0, 4000) },
      ],
      response_format: { type: "json_schema", json_schema: { name: "citation", schema: SCHEMA, strict: true } },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
  return JSON.parse((await res.json()).choices[0].message.content);
}

async function main() {
  const docs = JSON.parse(readFileSync("data/knowledge/documents.json", "utf8"));

  // front matter (~4000 ตัวอักษรแรก) ต่อ source
  const front = new Map();
  for (const d of docs) {
    const s = d.source || "unknown";
    const cur = front.get(s) || "";
    if (cur.length < 4000) front.set(s, cur + " " + d.content);
  }

  const citationBySource = {};
  for (const [src, text] of front) {
    process.stdout.write(`citation: ${src} ... `);
    try {
      const c = await citationFor(text);
      const parts = [c.authors, c.year ? `(${c.year})` : "", c.title, c.journal].filter(Boolean);
      citationBySource[src] = {
        citation: parts.join(". ").replace(/\.\./g, ".").trim(),
        doi_or_url: c.doi_or_url || null,
        year: c.year || null,
      };
      console.log("ok");
    } catch (e) {
      console.log(`ERR ${e.message}`);
      citationBySource[src] = { citation: src, doi_or_url: null, year: null };
    }
  }

  // เติม references เข้าแต่ละชนิด (จาก source ที่รายงานชนิดนั้น)
  const species = JSON.parse(readFileSync("data/knowledge/species-provinces.json", "utf8"));
  for (const sp of species) {
    const sources = new Set();
    for (const p of sp.provinces || []) {
      for (const s of String(p.source || "").split(";")) {
        const t = s.trim();
        if (t) sources.add(t);
      }
    }
    sp.references = [...sources]
      .map((s) => citationBySource[s])
      .filter(Boolean)
      .map((c) => ({ citation: c.citation, doi_or_url: c.doi_or_url, year: c.year }));
  }

  writeFileSync("data/knowledge/species-provinces.json", JSON.stringify(species, null, 1), "utf8");
  console.log(`\nเติม references ให้ ${species.length} ชนิด`);
  console.log("re-import: node --env-file=.env scripts/import-knowledge.mjs data/knowledge/species-provinces.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
