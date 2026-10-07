// งานในแชตที่ LLM ทำเองไม่ได้ ระบบจึงทำให้:
//   1. ตารางเปรียบเทียบลายปีก 4 ชนิดเป็นไฟล์ CSV (เปิดใน Excel ได้) — สร้างจากข้อมูลจริง ไม่ผ่าน LLM จึงไม่มีการแต่ง
//   2. วาดตามคำขอบนภาพปีกของผู้ใช้ (วงกลม / ลากเส้นชี้ / ติดชื่อ costa, r1, m1 ...)
//      vision LLM วางแผนว่าจะชี้อะไรตรงไหน แล้วเซิร์ฟเวอร์วาดลงภาพปีกจริงเอง
//      ตัวหนังสือจึงสะกดถูกเสมอ และปีกไม่ถูกวาดใหม่แบบโมเดลสร้างภาพ
//
// เดิมคำขอพวกนี้ตกไปที่แชตธรรมดา LLM ตอบว่า "ไม่สามารถวาดรูปได้" หรือตอบเป็นข้อความแทน

import sharp from "sharp";

import { askVision } from "@/lib/vision-json";
import { buildComparisonDocx, buildComparisonPdf } from "@/lib/comparison-docs";
import { loadAndCropWing } from "@/lib/wing-crop";
import {
  LEVEL_LABEL,
  allSpeciesWing,
  expandCodes,
  fullCite,
  landmarkByName,
  shortCite,
  speciesWing,
} from "@/lib/wing-landmarks";
import type { Lang } from "@/lib/i18n";

const has = (text: string, words: string[]) => words.some((w) => text.includes(w));

// ══════════════════════════════════════════════════════════════════
// 1. ตารางเปรียบเทียบ → CSV
// ══════════════════════════════════════════════════════════════════

const FILE_WORDS = [
  "excel", "csv", "xlsx", "เอ็กเซล", "pdf", "พีดีเอฟ", "word", "docx", "เวิร์ด", "เวิด",
  "ไฟล์", "ดาวน์โหลด", "download", "export", "spreadsheet",
];

export type DocFormat = "pdf" | "docx" | "csv";

/** ผู้ใช้ขอไฟล์แบบไหน — ไม่ระบุเลยให้ครบทั้งสามแบบ จะได้ไม่ต้องถามซ้ำ */
export function requestedFormats(message: string): DocFormat[] {
  const m = (message || "").toLowerCase();
  const out: DocFormat[] = [];
  if (has(m, ["pdf", "พีดีเอฟ"])) out.push("pdf");
  if (has(m, ["word", "docx", ".doc", "เวิร์ด", "เวิด"])) out.push("docx");
  if (has(m, ["csv", "excel", "xlsx", "เอ็กเซล", "spreadsheet"])) out.push("csv");
  return out.length ? out : ["pdf", "docx", "csv"];
}
const TABLE_WORDS = ["ตาราง", "table"];
const COMPARE_WORDS = ["เปรียบเทียบ", "เทียบ", "compare", "comparison"];
const WING_WORDS = ["ลายปีก", "ปีก", "จุดสังเกต", "wing", "landmark", "4 ชนิด", "ทุกชนิด", "all species", "four species"];

export function isTableRequest(message: string): boolean {
  const m = (message || "").toLowerCase();
  if (has(m, FILE_WORDS) && (has(m, TABLE_WORDS) || has(m, WING_WORDS))) return true;
  return has(m, TABLE_WORDS) && has(m, COMPARE_WORDS) && has(m, WING_WORDS);
}

const csvCell = (v: string) => `"${String(v ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;

export async function buildComparison(
  lang: Lang,
  formats: DocFormat[]
): Promise<{ answer: string; attachments: { name: string; url: string }[] }> {
  const species = allSpeciesWing();

  const header = [
    "ชนิด / Species", "สกุลย่อย / Subgenus", "จุดสังเกต / Landmark", "ชื่อไทย", "ลักษณะ (ภาษาไทย)",
    "ระดับหลักฐาน / Evidence", "ข้อความต้นฉบับ / Original text", "ภาพที่ยืนยัน / Figures", "ที่มา (ย่อ)", "ที่มา (เต็ม)",
  ];
  const rows: string[][] = [];
  for (const sp of species) {
    for (const f of sp.features) {
      const lm = landmarkByName(f.name_en);
      rows.push([
        sp.scientific_name,
        sp.subgenus,
        f.name_en,
        lm?.nameTh ?? "",
        expandCodes(f.description_th),
        `${LEVEL_LABEL[f.level].th(sp.subgenus)} / ${LEVEL_LABEL[f.level].en(sp.subgenus)}`,
        expandCodes(f.quote),
        expandCodes(f.figure_note ?? ""),
        shortCite(f.source),
        f.source.split(",").map((k) => fullCite(k) ?? k.trim()).join(" | "),
      ]);
    }
  }
  // BOM ให้ Excel เปิดภาษาไทยถูก (ไม่มี BOM Excel อ่านเป็นภาษาต่างดาว)
  const csv = "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  const files: Record<DocFormat, () => Promise<{ name: string; url: string }>> = {
    pdf: async () => ({
      name: "culicoides-wing-landmarks.pdf",
      url: `data:application/pdf;base64,${(await buildComparisonPdf()).toString("base64")}`,
    }),
    docx: async () => ({
      name: "culicoides-wing-landmarks.docx",
      url: `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${(await buildComparisonDocx()).toString("base64")}`,
    }),
    csv: async () => ({
      name: "culicoides-wing-landmarks.csv",
      url: `data:text/csv;charset=utf-8;base64,${Buffer.from(csv, "utf8").toString("base64")}`,
    }),
  };
  const attachments = await Promise.all(formats.map((f) => files[f]()));
  const names = { pdf: "PDF", docx: "Word", csv: "CSV (เปิดใน Excel)" };
  const kinds = formats.map((f) => (lang === "th" ? names[f] : names[f].replace("เปิดใน", "opens in"))).join(" / ");

  const th = lang === "th";
  const lines = species.map((sp) => {
    const names = sp.features.map((f) => {
      const lm = landmarkByName(f.name_en);
      const n = th ? lm?.nameTh ?? f.name_en : f.name_en;
      return f.level === "figure" ? `${n} 🟡` : n;
    });
    const published = sp.features.filter((f) => f.level !== "figure").length;
    return `| *C. ${sp.species}* | ${sp.subgenus} | ${names.join(" · ")} | ${published}/${sp.features.length} |`;
  });

  const answer = th
    ? `## ตารางเปรียบเทียบจุดสังเกตบนปีก 4 ชนิด

| ชนิด | สกุลย่อย | จุดสังเกตที่ใช้แยก | มีข้อความตีพิมพ์ |
|---|---|---|---|
${lines.join("\n")}

🟡 = สังเกตจากภาพปีกในเอกสาร ยังไม่มีข้อความตีพิมพ์รองรับ ควรให้ผู้เชี่ยวชาญยืนยันก่อนอ้างในเล่ม

ไฟล์ ${kinds} ด้านล่างมีครบทุกจุดสังเกต ${rows.length} แถว พร้อมคำบรรยาย ระดับหลักฐาน และเอกสารอ้างอิงฉบับเต็ม
ข้อมูลมาจากฐานข้อมูลจุดสังเกตของระบบโดยตรง ไม่ได้ให้ AI แต่งขึ้น`
    : `## Wing landmark comparison — 4 species

| Species | Subgenus | Distinguishing landmarks | Published text |
|---|---|---|---|
${lines.join("\n")}

🟡 = observed in published wing figures; no published text yet — needs expert confirmation before citing

The ${kinds} file(s) below have all ${rows.length} landmarks with descriptions, evidence levels and full references.
It is generated straight from the system's landmark database, not written by the AI.`;

  return { answer, attachments };
}

// ══════════════════════════════════════════════════════════════════
// 1b. จังหวัดที่พบหลายชนิดร่วมกัน (แผนที่หลายชั้น)
// ══════════════════════════════════════════════════════════════════

const OVERLAP_WORDS = ["พบทั้ง", "ร่วมกัน", "พบร่วม", "ทั้งสองชนิด", "ทั้ง 2 ชนิด", "ซ้อนกัน", "both", "overlap", "in common", "shared", "co-occur"];

/** ชื่อชนิดที่ผู้ใช้พิมพ์ถึงในข้อความ (เรียงตามลำดับที่พิมพ์) — names = ชื่อวิทยาศาสตร์ทั้งหมดในฐานข้อมูล */
export function speciesMentioned(message: string, names: string[]): string[] {
  const m = (message || "").toLowerCase();
  return names
    .map((full) => {
      const epithet = full.replace(/^culicoides\s+/i, "").toLowerCase();
      // \b ใช้ได้กับข้อความไทยติดกัน เพราะอักษรไทยไม่นับเป็น \w ("oxystomaและ" ยังเจอ)
      const at = m.search(new RegExp(`\\b${epithet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`));
      return { full, at };
    })
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.full);
}

/** ถามเรื่องจังหวัด/การพบร่วมกันของ "หลายชนิด" — ต้องมีชื่อชนิดอย่างน้อย 2 ชนิดถึงจะนับ */
export function isOverlapQuestion(message: string, isMapWords: boolean, mentioned: string[]): boolean {
  if (mentioned.length < 2) return false;
  return isMapWords || has((message || "").toLowerCase(), OVERLAP_WORDS);
}

/** คำตอบสร้างจากรายชื่อจังหวัดในฐานข้อมูลตรง ๆ — ไม่ผ่าน LLM จะได้ไม่มีจังหวัดที่แต่งขึ้น */
export function buildOverlapAnswer(layers: { species: string; provinces: string[] }[], lang: Lang): string {
  const th = lang === "th";
  const short = (s: string) => `*C. ${s.replace(/^Culicoides\s+/i, "")}*`;
  const sets = layers.map((l) => new Set(l.provinces));
  const union = [...new Set(layers.flatMap((l) => l.provinces))].sort((a, b) => a.localeCompare(b, "th"));
  const all = union.filter((p) => sets.every((s) => s.has(p)));
  const list = (ps: string[]) => (ps.length ? ps.join(", ") : th ? "—" : "—");

  const lines: string[] = [];
  lines.push(`## ${th ? "จังหวัดที่พบ" : "Provinces with"} ${layers.map((l) => short(l.species)).join(th ? " และ " : " and ")}`);
  lines.push(
    `**${th ? (layers.length === 2 ? "พบทั้งสองชนิด" : "พบครบทุกชนิด") : layers.length === 2 ? "Found with both" : "Found with all"} (${all.length} ${th ? "จังหวัด" : "provinces"}):** ${list(all)}`
  );
  layers.forEach((l, i) => {
    const only = l.provinces.filter((p) => sets.every((s, j) => j === i || !s.has(p)));
    lines.push(`**${th ? "พบเฉพาะ" : "Only"} ${short(l.species)} (${only.length}):** ${list(only)}`);
  });
  const empty = layers.filter((l) => !l.provinces.length);
  if (empty.length) {
    lines.push(
      th
        ? `⚠️ ยังไม่มีข้อมูลจังหวัดของ ${empty.map((l) => short(l.species)).join(", ")} ในฐานข้อมูล`
        : `⚠️ No province records for ${empty.map((l) => short(l.species)).join(", ")} in the database`
    );
  }
  lines.push(
    th
      ? "_จากรายงานในฐานข้อมูลงานวิจัยของระบบ — จังหวัดที่ไม่อยู่ในรายการแปลว่ายังไม่มีรายงาน ไม่ได้แปลว่าไม่มีริ้นชนิดนั้น_"
      : "_From reports in the system's research database — a province missing from the list has no report yet, not a confirmed absence._"
  );
  return lines.join("\n\n");
}

// ══════════════════════════════════════════════════════════════════
// 2. วาดตามคำขอบนภาพปีก
// ══════════════════════════════════════════════════════════════════

const DRAW_WORDS = [
  "วาด", "ลากเส้น", "เส้นชี้", "ชี้ตำแหน่ง", "ชี้ให้ดู", "วงกลม", "วงจุด", "วงให้", "ติดป้าย", "เขียนชื่อ",
  "ใส่ชื่อ", "มาร์ค", "ไฮไลต์", "ทำเครื่องหมาย", "ระบุตำแหน่ง",
  "annotate", "label", "circle", "mark", "highlight", "arrow", "point to", "point out", "draw",
];
const ON_IMAGE_WORDS = [
  "บนภาพ", "บนรูป", "ลงบนภาพ", "ลงบนรูป", "ลงภาพ", "ลงรูป", "ในภาพ", "ในรูป", "ภาพนี้", "รูปนี้", "บนปีก",
  "on the image", "on this image", "on the photo", "on this photo", "on the picture", "on the wing", "in the image",
];
// คำที่ชัดพอจนไม่ต้องบอกว่า "บนภาพ"
const STRONG_DRAW = ["วงกลม", "ลากเส้น", "วาดเส้น", "เส้นชี้"];

export function isAnnotateRequest(message: string): boolean {
  const m = (message || "").toLowerCase();
  return (has(m, DRAW_WORDS) && has(m, ON_IMAGE_WORDS)) || has(m, STRONG_DRAW);
}

/** ตำแหน่งของโครงสร้างปีกพื้นฐาน — ให้ vision LLM รู้ว่าแต่ละชื่ออยู่ตรงไหนเทียบกับ stigma/โคน/ปลายปีก
 *  (ปีกในภาพหมุนหรือกลับด้านได้ ต้องบอกเป็นตำแหน่งสัมพัทธ์) */
const ANATOMY: [string, string][] = [
  ["Costa", "the thick leading-edge vein along the front margin, from the wing base to where the dark stigma ends (about 60% of the wing length)"],
  ["Stigma", "the dark elongated spot on the front margin, lying over the radial cells"],
  ["r1", "first radial cell: a small narrow cell on the front margin, immediately on the BASE side of the stigma"],
  ["r2", "second radial cell: a narrow cell on the front margin directly UNDER the dark stigma, ending where the costa ends"],
  ["r3", "the large cell filling the front distal part of the wing, from beyond the radial cells to the apex, bounded behind by vein M1"],
  ["m1", "the cell between veins M1 and M2, in the distal middle of the wing, reaching the wing margin"],
  ["m2", "the cell between veins M2 and M3+4, just behind m1, reaching the margin"],
  ["m4", "the cell between veins M3+4 and CuA1, in the rear distal part of the wing, reaching the rear margin"],
  ["cua1", "the cell between veins CuA1 and CuA2, near the rear margin"],
  ["Anal cell", "the rear cell close to the wing base, behind vein CuA2"],
  ["r-m crossvein", "the short crossvein joining R and M, on the BASE side of the stigma, near the front edge"],
  ["Wing apex", "the broad rounded tip of the wing, opposite the base"],
  ["Wing base", "the narrow end of the wing that attaches to the body"],
];

type Item = { label: string; x: number; y: number; shape: "arrow" | "circle"; radius: number; note: string };
type Plan = { items: Item[]; reply: string };

function buildPlanPrompt(message: string, species: string | null | undefined, lang: Lang): string {
  const sp = speciesWing(species);
  const landmarks = sp
    ? sp.features
        .map((f) => {
          const lm = landmarkByName(f.name_en);
          return `- "${f.name_en}" — what to look for: ${expandCodes(f.description_th)}${lm ? ` | where: ${lm.locate}` : ""}${
            f.level === "figure" ? " (observed in published figures only)" : ""
          }`;
        })
        .join("\n")
    : "(none)";
  const replyLang = lang === "th" ? "Thai" : "English";

  return `You are annotating a microscope photograph of a Culicoides (biting midge) wing for a user.
${sp ? `The system identified this wing as Culicoides ${sp.species}.` : ""}

USER REQUEST: ${message}

How to read the wing: the front edge (costa) is the edge carrying the dark elongated stigma; the base is the narrow end attached to the body; the apex is the broad rounded end. The wing may be rotated or mirrored — find the costa and the base first.

Wing anatomy names and where they are:
${ANATOMY.map(([n, w]) => `- ${n}: ${w}`).join("\n")}

Diagnostic landmarks of this species in the system's database (use these when the user asks for species-specific / diagnostic points; do not invent others):
${landmarks}

Plan exactly what the user asked for. Return JSON only:
{"items":[{"label":"short English label, max 26 characters","x":0.0,"y":0.0,"shape":"arrow","radius":0.0,"note":"one short ${replyLang} sentence about what is at this spot"}],"reply":"2-4 sentence ${replyLang} reply to the user"}

Rules:
- x, y are fractions 0-1 of this image (0,0 = top-left) at the CENTRE of the structure
- a "pale spot" is a LIGHT area of the membrane — never place it on a dark patch, even if the dark patch is more conspicuous
- shape "circle" when the user asks to circle / วงกลม or for an area; otherwise "arrow". radius only for circles, as a fraction of the image width (0.02-0.15)
- labels must be the anatomy names above (Costa, r1, m1, Anal cell ...) or the landmark names above, written exactly
- at most 10 items; if a requested structure is not visible, leave it out and say so in reply
- notes and reply must not add species characters that are not given above`;
}

function parsePlan(text: string): Plan | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const raw = JSON.parse(m[0]) as { items?: Partial<Item>[]; reply?: string };
    const items = (raw.items ?? [])
      .filter((i) => Number.isFinite(i?.x) && Number.isFinite(i?.y) && typeof i?.label === "string" && i.label.trim())
      .slice(0, 10)
      .map((i) => ({
        label: String(i.label).trim().slice(0, 30),
        x: Math.max(0, Math.min(1, Number(i.x))),
        y: Math.max(0, Math.min(1, Number(i.y))),
        shape: (i.shape === "circle" ? "circle" : "arrow") as Item["shape"],
        radius: Math.max(0.015, Math.min(0.2, Number(i.radius) || 0.05)),
        note: String(i.note ?? "").trim(),
      }));
    return items.length ? { items, reply: String(raw.reply ?? "").trim() } : null;
  } catch {
    return null;
  }
}

const xml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!));

const FONT = 21;
const LINE = 25;
const CHAR_W = 11.5; // ความกว้างเฉลี่ยต่อตัวอักษรของ Arial ขนาด 21px โดยประมาณ

/** ตัดป้ายยาวเป็นสองบรรทัดตรงช่องว่าง — "Pale spots below the stigma" ยาวเกินคอลัมน์แล้วโดนตัดท้าย */
function wrapLabel(label: string, max = 18): string[] {
  if (label.length <= max) return [label];
  const words = label.split(" ");
  let best = [label];
  let bestW = Infinity;
  for (let k = 1; k < words.length; k++) {
    const a = words.slice(0, k).join(" ");
    const b = words.slice(k).join(" ");
    const w = Math.max(a.length, b.length);
    if (w < bestW) {
      bestW = w;
      best = [a, b];
    }
  }
  return best;
}

/** วาดลงภาพปีกจริง: ขยายขอบซ้าย/ขวาเป็นพื้นขาวไว้วางป้าย แบบภาพประกอบในเปเปอร์
 *  ป้ายเรียงเป็นคอลัมน์ไม่ทับกัน เส้นลากจากป้ายไปหัวลูกศร/วงกลมที่ตำแหน่งจริง */
async function render(cropB64: string, items: Item[], species?: string | null): Promise<string> {
  const W = 900;
  const img = await sharp(Buffer.from(cropB64, "base64")).resize({ width: W }).png().toBuffer();
  const H = (await sharp(img).metadata()).height ?? 600;
  const lines = items.map((i) => wrapLabel(i.label));
  const longest = Math.max(...lines.flat().map((l) => l.length), 6);
  // คอลัมน์ป้ายกว้างพอดีป้ายที่ยาวที่สุด (หลังตัดบรรทัดแล้ว)
  const M = Math.round(Math.min(380, Math.max(170, longest * CHAR_W + 34)));
  const TOP = 24;
  const CAP = 34;
  const FW = W + 2 * M;
  const FH = H + TOP + CAP;

  type P = Item & { px: number; py: number; side: "L" | "R"; ly: number; text: string[] };
  const pts: P[] = items.map((i, k) => ({
    ...i, text: lines[k], px: M + i.x * W, py: TOP + i.y * H, side: i.x < 0.5 ? "L" : "R", ly: 0,
  }));
  for (const side of ["L", "R"] as const) {
    const col = pts.filter((p) => p.side === side).sort((a, b) => a.py - b.py);
    // ระยะห่างขึ้นกับจำนวนบรรทัดของป้ายสองตัวที่อยู่ติดกัน
    col.forEach((p, k) => {
      const prev = col[k - 1];
      const gap = prev ? ((prev.text.length + p.text.length) / 2) * LINE + 10 : 0;
      p.ly = Math.max(p.py, prev ? prev.ly + gap : TOP + 14);
    });
    const over = (col.at(-1)?.ly ?? 0) - (TOP + H - 6);
    if (over > 0) col.forEach((p) => (p.ly = Math.max(TOP + 14, p.ly - over)));
  }

  const RED = "#dc2626";
  const parts: string[] = [];
  for (const p of pts) {
    const textX = p.side === "L" ? M - 14 : M + W + 14;
    const anchorX = p.side === "L" ? M - 8 : M + W + 8;
    const r = p.radius * W;
    // เส้นจากป้ายไปถึงขอบวงกลม หรือถึงจุดพอดีถ้าเป็นลูกศร
    const dx = p.px - anchorX;
    const dy = p.py - p.ly;
    const len = Math.hypot(dx, dy) || 1;
    const stop = p.shape === "circle" ? r : 2;
    const ex = p.px - (dx / len) * stop;
    const ey = p.py - (dy / len) * stop;
    parts.push(
      `<line x1="${anchorX}" y1="${p.ly}" x2="${ex}" y2="${ey}" stroke="#111" stroke-width="1.6"${
        p.shape === "arrow" ? ' marker-end="url(#ah)"' : ""
      }/>`
    );
    if (p.shape === "circle") {
      parts.push(`<circle cx="${p.px}" cy="${p.py}" r="${r}" fill="none" stroke="${RED}" stroke-width="3"/>`);
    }
    // ป้ายหลายบรรทัด: จัดให้กึ่งกลางของก้อนข้อความอยู่ที่ปลายเส้น
    const y0 = p.ly - ((p.text.length - 1) * LINE) / 2;
    const tspans = p.text.map((t, k) => `<tspan x="${textX}" y="${y0 + k * LINE}">${xml(t)}</tspan>`).join("");
    parts.push(
      `<text dominant-baseline="middle" text-anchor="${p.side === "L" ? "end" : "start"}" font-family="Arial, Helvetica, sans-serif" font-size="${FONT}" fill="#111">${tspans}</text>`
    );
  }
  const caption = `Culicoides${species ? ` ${species}` : ""} · labels on the original specimen photo · positions placed by AI`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${FW}" height="${FH}">
    <defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="#111"/></marker></defs>
    ${parts.join("\n")}
    <text x="${FW / 2}" y="${FH - CAP / 2}" dominant-baseline="middle" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="15" fill="#666">${xml(caption)}</text>
  </svg>`;

  const out = await sharp({ create: { width: FW, height: FH, channels: 3, background: "#ffffff" } })
    .composite([{ input: img, left: M, top: TOP }, { input: Buffer.from(svg), left: 0, top: 0 }])
    .png()
    .toBuffer();
  return `data:image/png;base64,${out.toString("base64")}`;
}

export async function annotateOnRequest(
  imageUrl: string,
  message: string,
  species: string | null | undefined,
  lang: Lang
): Promise<{ answer: string; imageUrl?: string; imageError?: string }> {
  const th = lang === "th";
  const crop = await loadAndCropWing(imageUrl);
  if (!crop) {
    return { answer: th ? "โหลดภาพปีกไม่สำเร็จ ลองอัปโหลดภาพใหม่อีกครั้ง" : "Couldn't load the wing image — try uploading it again." };
  }

  const plan = await askVision(crop.base64, crop.mime, buildPlanPrompt(message, species, lang), parsePlan);
  if (!plan) {
    return {
      answer: th
        ? "AI หาตำแหน่งที่ขอบนภาพนี้ไม่เจอ ลองระบุชื่อให้ชัดขึ้น เช่น \"วงกลม r2 และ m1 บนภาพ\""
        : "The AI couldn't locate what you asked for on this image. Try naming the parts, e.g. \"circle r2 and m1 on the image\".",
    };
  }

  try {
    const url = await render(crop.base64, plan.items, speciesWing(species)?.species ?? species);
    const list = plan.items.map((i, k) => `${k + 1}. **${i.label}**${i.note ? ` — ${i.note}` : ""}`).join("\n");
    const footer = th
      ? "_ตำแหน่งวางโดย AI บนภาพปีกจริง ใช้ดูประกอบ ไม่ใช่การวัด_"
      : "_Positions are placed by AI on the real wing photo — a visual guide, not a measurement._";
    return { answer: `${plan.reply}\n\n${list}\n\n${footer}`.trim(), imageUrl: url };
  } catch (err) {
    console.error("annotateOnRequest render:", err);
    return { answer: plan.reply, imageError: err instanceof Error ? err.message : "render failed" };
  }
}

