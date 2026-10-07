// จุดสังเกตบนปีก 7 จุด + ลักษณะเฉพาะชนิดที่มีเอกสารอ้างอิง
//
// ใช้สามที่: หมุดบนภาพปีก + การ์ดลอย (client), prompt ชี้ตำแหน่งใน /api/annotate และ prompt คำอธิบาย (server)
// ทั้งสองอ่านจาก data/knowledge/species-wing-features.json ไฟล์เดียว จึงพูดตรงกันเสมอ
// (ไฟล์เดียวกันนี้ถูก seed เข้าตาราง species_wing_feature ด้วย scripts/seed-species-wing-features.mjs)

import data from "@/data/knowledge/species-wing-features.json";

/** figure = สังเกตจากภาพปีกในเอกสาร ไม่มีข้อความตีพิมพ์รองรับ — ต้องแสดงให้ผู้อ่านรู้เสมอ */
export type Level = "species" | "subgenus" | "population" | "figure";

export type SpeciesFeature = {
  name_en: string;
  level: Level;
  description_th: string;
  /** ข้อความต้นฉบับคำต่อคำ — ว่างได้เมื่อ level เป็น figure */
  quote: string;
  /** ภาพในเอกสารที่ยืนยันลักษณะนี้ หรือที่มาของการสังเกต */
  figure_note?: string;
  source: string;
};

export type SpeciesWing = {
  species: string;
  scientific_name: string;
  subgenus: string;
  subgenus_source: string;
  summary_th: string;
  system_note_th?: string;
  features: SpeciesFeature[];
  /** ชนิดใกล้ชิดนอกระบบ — ใช้ในแชตเท่านั้น คำอธิบายผลวิเคราะห์ห้ามเอ่ยถึง */
  related_th?: { species: string; relation_th: string; difference_th: string; quote: string; source: string }[];
};

export type Landmark = {
  nameEn: string;
  nameTh: string;
  /** นิยามระดับสกุล — ใช้กับ Culicoides ทุกชนิด (ตรงกับแคตตาล็อก wing_feature) */
  defTh: string;
  defEn: string;
  /** ตำแหน่งบนภาพปีกแผนผังใน <WingDiagram> (viewBox 200×80 โคนปีกซ้าย ปลายปีกขวา) */
  at: { x: number; y: number; r?: number };
  /** บอก vision LLM ว่าจุดนี้อยู่ตรงไหนเทียบกับ stigma/โคน/ปลายปีก — ใช้ตำแหน่งสัมพัทธ์
   *  เพราะภาพปีกจริงหมุนหรือกลับด้านได้ (ทดสอบแล้ว: ไม่มีคำใบ้นี้ โมเดลชี้ r-m ผิดฝั่งของ stigma บนปีกที่กลับด้าน) */
  locate: string;
};

// ชื่อและลำดับตรงกับ wing_feature (migration 0002) — แก้ที่นี่ต้องแก้ที่นั่นด้วย
export const LANDMARKS: Landmark[] = [
  {
    nameEn: "Wing pattern",
    nameTh: "ลวดลายปีก",
    defTh: "รูปแบบจุดสีจาง–เข้มบนแผ่นปีก ตัวช่วยหลักในการจำแนกชนิด",
    defEn: "The arrangement of pale and dark spots across the wing membrane — the main character used to tell species apart.",
    at: { x: 138, y: 46, r: 13 },
    locate: "ชี้จุดใสหรือบริเวณที่เห็นลักษณะตามคำบรรยายชัดที่สุด ส่วนใหญ่อยู่ครึ่งปลายของปีก",
  },
  {
    nameEn: "r-m crossvein",
    nameTh: "เส้นขวาง r-m",
    defTh: "เส้นขวางสั้น ๆ เชื่อมเส้นเรเดียส (R) กับเส้นมีเดีย (M) กลางปีกค่อนไปทางขอบหน้า",
    defEn: "The short cross-vein joining the radius (R) and media (M), mid-wing toward the front edge.",
    at: { x: 71, y: 29 },
    locate: "อยู่ฝั่งโคนปีกของ stigma (ไม่ใช่ฝั่งปลายปีก) ห่างจากต้น stigma ไปทางโคนเล็กน้อย ใกล้ขอบหน้า",
  },
  {
    nameEn: "Radial cells (r1, r2)",
    nameTh: "เซลล์เรเดียล",
    defTh: "เซลล์เล็กสองช่องชิดขอบปีกด้านหน้า ใกล้ปลายเส้น costa",
    defEn: "Two small cells along the front edge of the wing, near the end of the costa.",
    at: { x: 104, y: 19 },
    locate: "ตรงกับจุดเข้มยาว (stigma) บนขอบหน้าปีก",
  },
  {
    nameEn: "Costal margin",
    nameTh: "ขอบปีกด้านหน้า",
    defTh: "ขอบปีกด้านหน้าที่มีเส้น costa วิ่งตาม",
    defEn: "The leading edge of the wing, along which the costa runs.",
    at: { x: 52, y: 20 },
    locate: "บนขอบหน้าปีก ช่วงระหว่างโคนปีกกับ stigma",
  },
  {
    nameEn: "Macrotrichia",
    nameTh: "ขนใหญ่บนปีก",
    defTh: "ขนใหญ่ที่ขึ้นบนแผ่นปีก ความหนาแน่นและการกระจายใช้ประกอบการจำแนก",
    defEn: "Large hairs on the wing membrane; their density and spread can help identification.",
    at: { x: 168, y: 50 },
    locate: "บนแผ่นปีกช่วงปลาย บริเวณที่เห็นขนชัด",
  },
  {
    nameEn: "Wing apex",
    nameTh: "ปลายปีก",
    defTh: "ส่วนปลายสุดของปีก",
    defEn: "The far tip of the wing.",
    at: { x: 191, y: 40 },
    locate: "ปลายปีกด้านที่มนกว้าง อยู่ตรงข้ามกับโคนปีก",
  },
  {
    nameEn: "Wing base / anal region",
    nameTh: "โคนปีก / บริเวณ anal",
    defTh: "โคนปีกที่ติดลำตัว และเซลล์ anal ด้านหลังโคนปีก",
    defEn: "Where the wing joins the body, plus the anal cell behind it.",
    at: { x: 18, y: 45 },
    locate: "ปลายด้านที่แคบที่สุดของปีกซึ่งติดลำตัว อยู่ตรงข้ามกับปลายปีก",
  },
  // ── จุดที่ละเอียดกว่า (migration 0005) — ลักษณะที่ใช้แยกชนิดจริงอยู่ตรงนี้ ──
  {
    nameEn: "Pale spots below the stigma",
    nameTh: "จุดใสใต้ stigma",
    defTh: "จุดใสที่อยู่ใต้แนวจุดเข้ม stigma (ใต้ radial cells) ในโคนของ cell r3",
    defEn: "Pale spots just below the dark stigma (under the radial cells), at the base of cell r3.",
    at: { x: 110, y: 27 },
    locate: "ใต้ stigma ทันที ระหว่าง stigma กับเส้น M1 ไม่ใช่บน stigma",
  },
  {
    nameEn: "Poststigmatic pale spot",
    nameTh: "จุดใสหลัง stigma",
    defTh: "จุดใสบนขอบปีกด้านหน้าที่อยู่ถัดจากปลายจุดเข้ม stigma ไปทางปลายปีก",
    defEn: "The pale spot on the leading edge immediately beyond the end of the dark stigma.",
    at: { x: 133, y: 17 },
    // ทดสอบแล้ว: ไม่บอกว่าเป็นบริเวณ "สีอ่อน" โมเดลไปวงหย่อมเข้มที่อยู่ถัดไปบนขอบหน้าแทน (เด่นกว่า)
    locate: "บนขอบหน้าปีก ถัดจากปลาย stigma ไปทางปลายปีก เป็นบริเวณสีอ่อน/ใส ไม่ใช่สีเข้ม — ถ้ามีหย่อมสีเข้มอีกหย่อมถัดไปทางปลายปีก จุดนี้คือส่วนใสที่คั่นอยู่ระหว่าง stigma กับหย่อมเข้มนั้น",
  },
  {
    nameEn: "Mediocubital fork",
    nameTh: "จุดแยก mediocubital",
    defTh: "จุดที่เส้น M3+4 กับ CuA1 แยกจากกันในครึ่งหลังของปีก",
    defEn: "Where veins M3+4 and CuA1 split, in the rear half of the wing.",
    at: { x: 79, y: 48 },
    locate: "ครึ่งหลังของปีก ช่วงกลางระหว่างโคนกับปลาย ตรงที่เส้นปีกด้านหลังแยกเป็นสองแฉก",
  },
];

export function landmarkByName(nameEn: string): Landmark | null {
  const key = nameEn.trim().toLowerCase();
  return LANDMARKS.find((l) => l.nameEn.toLowerCase() === key) ?? null;
}

const SPECIES = data.species as SpeciesWing[];
const SOURCES = data.sources as Record<string, string>;

/** "Culicoides guttifer" / "C. guttifer" / "guttifer" → ข้อมูลของชนิดนั้น */
export function speciesWing(species?: string | null): SpeciesWing | null {
  const key = (species ?? "").toLowerCase().replace(/^(culicoides|c\.)\s+/, "").trim();
  return SPECIES.find((s) => s.species === key) ?? null;
}

export function allSpeciesWing(): SpeciesWing[] {
  return SPECIES;
}


export function featureOf(sp: SpeciesWing | null, nameEn: string): SpeciesFeature | null {
  return sp?.features.find((f) => f.name_en === nameEn) ?? null;
}

/** รหัสอ้างอิง "J46, W25" → "Johannsen 1946; Wang et al. 2025" สำหรับแสดงสั้น ๆ */
export function shortCite(keys: string): string {
  return keys
    .split(",")
    .map((k) => k.trim())
    .map((k) => {
      const full = SOURCES[k];
      if (!full) return k;
      const year = full.match(/\((\d{4})\)/)?.[1] ?? "";
      const authors = full.slice(0, full.indexOf("(")).trim();
      const first = authors.split(",")[0].trim();
      // ผู้แต่ง 2 คนเขียนชื่อทั้งคู่ 3 คนขึ้นไปใช้ et al. ตามธรรมเนียมการอ้างอิง
      const many = (authors.match(/,/g) ?? []).length;
      const second = authors.match(/&\s*([^,]+?),/)?.[1]?.trim();
      const who = many >= 3 ? `${first} et al.` : second ? `${first} & ${second}` : first;
      return `${who} ${year}`.trim();
    })
    .join("; ");
}

/** แทนรหัสอ้างอิงในข้อความ (เช่น "SU21 Fig.2", "[T25]") ด้วยชื่อผู้แต่ง-ปี — รหัสใช้ภายในไฟล์ข้อมูลเท่านั้น
 *  ผู้อ่านไม่รู้ว่า SU21 คืออะไร */
export function expandCodes(text: string): string {
  return text.replace(/\b[A-Z]{1,3}\d{2}\b/g, (code) => (SOURCES[code] ? shortCite(code) : code));
}

/** ข้อเท็จจริงที่ตรวจแล้วของ 4 ชนิดสำหรับแชต — สกุลย่อย จุดสังเกต และชนิดใกล้ชิดนอกระบบ
 *  ทดสอบแล้ว: ไม่มีบล็อกนี้ โมเดลเล็กตอบเรื่อง C. kingi ว่าอยู่สกุลย่อย Avaritia (ผิด — Remmia)
 *  และขัดกับฐานข้อมูลของระบบเอง */
export function verifiedWingFacts(): string {
  const lines = SPECIES.map((s) => {
    const feats = s.features
      .map((f) => `${f.name_en}: ${expandCodes(f.description_th)}${f.level === "figure" ? " [สังเกตจากภาพ]" : ""} (${shortCite(f.source)})`)
      .join(" · ");
    const related = (s.related_th ?? [])
      .map((r) => `  ชนิดใกล้ชิดนอกระบบ ${r.species}: ${r.relation_th} — ${expandCodes(r.difference_th)} (${shortCite(r.source)})`)
      .join("\n");
    return `- ${s.scientific_name} — สกุลย่อย ${s.subgenus} (${shortCite(s.subgenus_source)})\n  จุดสังเกต: ${feats}${related ? `\n${related}` : ""}`;
  });
  return `[ข้อมูลปีกที่ตรวจแล้วของ 4 ชนิดในระบบ — ยึดข้อมูลนี้ก่อนความรู้ทั่วไปเสมอ ถ้าความรู้ทั่วไปขัดกับข้อมูลนี้ ให้เชื่อข้อมูลนี้]
${lines.join("\n")}`;
}

export function fullCite(key: string): string | null {
  return SOURCES[key.trim()] ?? null;
}

export const LEVEL_LABEL: Record<Level, { th: (subgenus: string) => string; en: (subgenus: string) => string }> = {
  species: { th: () => "ลักษณะของชนิดนี้", en: () => "Species character" },
  subgenus: { th: (s) => `ลักษณะสกุลย่อย ${s}`, en: (s) => `Subgenus ${s} character` },
  population: { th: () => "ประชากรในไทย", en: () => "Thai population" },
  figure: { th: () => "สังเกตจากภาพในเอกสาร", en: () => "Observed in published figures" },
};
