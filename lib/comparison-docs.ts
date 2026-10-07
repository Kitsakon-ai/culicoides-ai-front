// ตารางเปรียบเทียบจุดสังเกตบนปีก 4 ชนิดเป็นไฟล์ Word (.docx) และ PDF — สำหรับใส่ในเล่ม
//
// ข้อมูลมาจาก data/knowledge/species-wing-features.json ตัวเดียวกับที่ระบบใช้ทุกที่ ไม่ผ่าน LLM
//
// PDF ต้องฝังฟอนต์ไทยเอง (Sarabun, OFL — data/fonts) ไม่งั้นตัวอักษรไทยเป็นกล่องสี่เหลี่ยม
// และต้องตัดบรรทัดเอง: ภาษาไทยไม่เว้นวรรคระหว่างคำ ไลบรารี PDF ตัดได้แค่ตรงช่องว่าง
// วลียาว ๆ จะล้นช่องตาราง จึงใช้ Intl.Segmenter หาขอบเขตคำไทยแล้วตัดบรรทัดเองทีละคำ
// Word ตัดคำไทยเองได้ ส่วนนั้นจึงไม่ต้องทำ

import path from "path";
import {
  AlignmentType, BorderStyle, Document, HeadingLevel, PageOrientation, Packer, Paragraph,
  ShadingType, Table, TableCell, TableRow, TextRun, VerticalMergeType, WidthType,
} from "docx";
import PDFDocument from "pdfkit";

import { LEVEL_LABEL, allSpeciesWing, expandCodes, fullCite, landmarkByName, shortCite } from "@/lib/wing-landmarks";

// ── ข้อมูลร่วมของทั้งสองรูปแบบ ───────────────────────────────────────────

type Row = { species: string; subgenus: string; landmark: string; description: string; evidence: string; figure: boolean; cite: string };

function collect() {
  const rows: Row[] = [];
  const keys = new Set<string>();
  for (const sp of allSpeciesWing()) {
    for (const f of sp.features) {
      const lm = landmarkByName(f.name_en);
      f.source.split(",").map((k) => k.trim()).filter(Boolean).forEach((k) => keys.add(k));
      rows.push({
        species: sp.scientific_name,
        subgenus: sp.subgenus,
        landmark: `${f.name_en}${lm ? `\n(${lm.nameTh})` : ""}`,
        description: expandCodes(f.description_th),
        evidence: f.level === "figure" ? `${LEVEL_LABEL.figure.th(sp.subgenus)} *` : LEVEL_LABEL[f.level].th(sp.subgenus),
        figure: f.level === "figure",
        cite: shortCite(f.source),
      });
    }
    keys.add(sp.subgenus_source);
  }
  const refs = [...keys].map((k) => fullCite(k)).filter((x): x is string => Boolean(x)).sort((a, b) => a.localeCompare(b));
  return { rows, refs };
}

const TITLE = "ตารางเปรียบเทียบจุดสังเกตบนปีกของริ้น Culicoides 4 ชนิด";
const HEADERS = ["ชนิด", "สกุลย่อย", "จุดสังเกต", "ลักษณะที่ใช้แยก", "ระดับหลักฐาน", "ที่มา"];
const NOTE =
  "* สังเกตจากภาพถ่ายปีกในเอกสารและชุดข้อมูลภาพของงานวิจัยนี้ ยังไม่มีข้อความตีพิมพ์รองรับ ควรให้ผู้เชี่ยวชาญยืนยันก่อนอ้างอิง · " +
  "ลักษณะระดับสกุลย่อยใช้แยกได้เมื่อในระบบมีชนิดเดียวในสกุลย่อยนั้น · จุดสังเกตทั้งหมดใช้แยกชนิดภายใน 4 ชนิดของระบบเท่านั้น";

function today(): string {
  return new Date().toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric" });
}

// ══════════════════════════════════════════════════════════════════
// Word (.docx)
// ══════════════════════════════════════════════════════════════════

// TH Sarabun New เป็นฟอนต์มาตรฐานเล่มวิทยานิพนธ์ไทย — เครื่องที่ไม่มี Word จะแทนด้วยฟอนต์ไทยอื่นเอง
// ต้องตั้งทั้ง ascii และ cs (complex script) ไม่งั้นตัวไทยจะใช้ฟอนต์อื่นแม้ตัวอังกฤษจะใช้ Sarabun
const WFONT = { ascii: "TH Sarabun New", hAnsi: "TH Sarabun New", cs: "TH Sarabun New", eastAsia: "TH Sarabun New" };
const run = (text: string, o: { bold?: boolean; italics?: boolean; size?: number } = {}) =>
  new TextRun({ text, font: WFONT, size: o.size ?? 28, sizeComplexScript: o.size ?? 28, bold: o.bold, boldComplexScript: o.bold, italics: o.italics });

function cellParas(text: string, o: { bold?: boolean; italics?: boolean } = {}) {
  return text.split("\n").map((line) => new Paragraph({ children: [run(line, o)], spacing: { before: 0, after: 0 } }));
}

export async function buildComparisonDocx(): Promise<Buffer> {
  const { rows, refs } = collect();
  const widths = [2000, 1300, 2300, 5600, 1700, 2100]; // twips รวม ≈ ความกว้างหน้ากระดาษแนวนอน
  const border = { style: BorderStyle.SINGLE, size: 4, color: "999999" };
  const borders = { top: border, bottom: border, left: border, right: border };

  const header = new TableRow({
    tableHeader: true, // ข้ามหน้าแล้วหัวตารางซ้ำให้เอง
    children: HEADERS.map((h, i) => new TableCell({
      width: { size: widths[i], type: WidthType.DXA },
      borders,
      shading: { type: ShadingType.CLEAR, color: "auto", fill: "E8EEF7" },
      children: cellParas(h, { bold: true }),
    })),
  });

  const body = rows.map((r, idx) => {
    const first = idx === 0 || rows[idx - 1].species !== r.species;
    // ชนิดและสกุลย่อยรวมเซลล์แนวตั้งตลอดกลุ่ม อ่านง่ายกว่าพิมพ์ซ้ำทุกแถว
    const merge = first ? VerticalMergeType.RESTART : VerticalMergeType.CONTINUE;
    return new TableRow({
      cantSplit: true,
      children: [
        new TableCell({ width: { size: widths[0], type: WidthType.DXA }, borders, verticalMerge: merge, children: first ? cellParas(r.species, { italics: true }) : [new Paragraph("")] }),
        new TableCell({ width: { size: widths[1], type: WidthType.DXA }, borders, verticalMerge: merge, children: first ? cellParas(r.subgenus) : [new Paragraph("")] }),
        new TableCell({ width: { size: widths[2], type: WidthType.DXA }, borders, children: cellParas(r.landmark) }),
        new TableCell({ width: { size: widths[3], type: WidthType.DXA }, borders, children: cellParas(r.description) }),
        new TableCell({
          width: { size: widths[4], type: WidthType.DXA }, borders,
          shading: r.figure ? { type: ShadingType.CLEAR, color: "auto", fill: "FFF4D6" } : undefined,
          children: cellParas(r.evidence),
        }),
        new TableCell({ width: { size: widths[5], type: WidthType.DXA }, borders, children: cellParas(r.cite) }),
      ],
    });
  });

  const doc = new Document({
    styles: { default: { document: { run: { font: WFONT, size: 28 } } } },
    sections: [{
      properties: {
        page: {
          // ใส่ขนาด A4 แนวตั้ง — ไลบรารีสลับกว้าง/สูงให้เองเมื่อเป็น LANDSCAPE (ใส่แนวนอนไปจะโดนสลับกลับเป็นแนวตั้ง)
          size: { orientation: PageOrientation.LANDSCAPE, width: 11906, height: 16838 },
          margin: { top: 1000, bottom: 1000, left: 900, right: 900 },
        },
      },
      children: [
        new Paragraph({ heading: HeadingLevel.HEADING_2, alignment: AlignmentType.CENTER, children: [run(TITLE, { bold: true, size: 36 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [run(`สร้างจากฐานข้อมูลจุดสังเกตของระบบ Culicoides AI · ${today()}`, { size: 24 })] }),
        new Table({ width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA }, rows: [header, ...body] }),
        new Paragraph({ spacing: { before: 200 }, children: [run(NOTE, { size: 24 })] }),
        new Paragraph({ spacing: { before: 240 }, children: [run("เอกสารอ้างอิง", { bold: true })] }),
        ...refs.map((ref, i) => new Paragraph({ indent: { left: 500, hanging: 500 }, children: [run(`${i + 1}. ${ref}`, { size: 24 })] })),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}

// ══════════════════════════════════════════════════════════════════
// PDF
// ══════════════════════════════════════════════════════════════════

const FONT_DIR = path.join(process.cwd(), "data", "fonts");
const segmenter = new Intl.Segmenter("th", { granularity: "word" });

/** ตัดบรรทัดเองตามขอบเขตคำ (รองรับภาษาไทยที่ไม่เว้นวรรค) แล้วคืนเป็นรายการบรรทัด */
function wrap(doc: PDFKit.PDFDocument, text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const { segment } of segmenter.segment(para)) {
      const next = line + segment;
      if (line && doc.widthOfString(next.trimEnd()) > width) {
        out.push(line.trimEnd());
        line = segment.trimStart();
      } else {
        line = next;
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

export function buildComparisonPdf(): Promise<Buffer> {
  const { rows, refs } = collect();
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36, bufferPages: true });
  doc.registerFont("th", path.join(FONT_DIR, "Sarabun-Regular.ttf"));
  doc.registerFont("th-bold", path.join(FONT_DIR, "Sarabun-Bold.ttf"));

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const left = doc.page.margins.left;
  const usable = doc.page.width - left - doc.page.margins.right;
  const ratios = [0.13, 0.08, 0.15, 0.39, 0.12, 0.13];
  const W = ratios.map((r) => r * usable);
  const X = W.map((_, i) => left + W.slice(0, i).reduce((a, b) => a + b, 0));
  const SIZE = 9;
  const LH = SIZE * 1.45;
  const PAD = 4;
  const bottom = () => doc.page.height - doc.page.margins.bottom;

  doc.font("th-bold").fontSize(15).text(TITLE, { align: "center" });
  doc.font("th").fontSize(9.5).fillColor("#555").text(`สร้างจากฐานข้อมูลจุดสังเกตของระบบ Culicoides AI · ${today()}`, { align: "center" });
  doc.fillColor("#000");
  let y = doc.y + 10;

  const drawHeader = () => {
    doc.font("th-bold").fontSize(SIZE);
    const h = LH + PAD * 2;
    doc.rect(left, y, usable, h).fill("#E8EEF7").fillColor("#000");
    HEADERS.forEach((t, i) => doc.text(t, X[i] + PAD, y + PAD, { width: W[i] - PAD * 2, lineBreak: false }));
    doc.rect(left, y, usable, h).lineWidth(0.6).stroke("#888");
    y += h;
  };
  drawHeader();

  rows.forEach((r, idx) => {
    const first = idx === 0 || rows[idx - 1].species !== r.species;
    doc.font("th").fontSize(SIZE);
    const cells = [first ? r.species : "", first ? r.subgenus : "", r.landmark, r.description, r.evidence, r.cite];
    const lines = cells.map((c, i) => wrap(doc, c, W[i] - PAD * 2));
    const h = Math.max(...lines.map((l) => l.length)) * LH + PAD * 2;

    if (y + h > bottom()) {
      doc.addPage();
      y = doc.page.margins.top;
      drawHeader();
      doc.font("th").fontSize(SIZE);
    }
    if (r.figure) doc.rect(X[4], y, W[4], h).fill("#FFF4D6").fillColor("#000");
    // เส้นคั่นกลุ่มชนิดหนากว่าเส้นแถวปกติ
    doc.moveTo(left, y).lineTo(left + usable, y).lineWidth(first ? 1.1 : 0.4).stroke(first ? "#555" : "#BBB");
    lines.forEach((ls, i) => ls.forEach((ln, k) => doc.text(ln, X[i] + PAD, y + PAD + k * LH, { lineBreak: false })));
    y += h;
  });
  doc.moveTo(left, y).lineTo(left + usable, y).lineWidth(1.1).stroke("#555");

  // หมายเหตุ + เอกสารอ้างอิง
  doc.font("th").fontSize(8.5).fillColor("#444");
  y += 8;
  for (const ln of wrap(doc, NOTE, usable)) {
    if (y + 12 > bottom()) { doc.addPage(); y = doc.page.margins.top; }
    doc.text(ln, left, y, { lineBreak: false });
    y += 12;
  }
  doc.fillColor("#000").font("th-bold").fontSize(10);
  y += 8;
  if (y + 16 > bottom()) { doc.addPage(); y = doc.page.margins.top; }
  doc.text("เอกสารอ้างอิง", left, y, { lineBreak: false });
  y += 16;
  doc.font("th").fontSize(8.5);
  refs.forEach((ref, i) => {
    const ls = wrap(doc, `${i + 1}. ${ref}`, usable - 14);
    ls.forEach((ln, k) => {
      if (y + 12 > bottom()) { doc.addPage(); y = doc.page.margins.top; }
      doc.text(ln, left + (k ? 14 : 0), y, { lineBreak: false });
      y += 12;
    });
  });

  // เลขหน้า
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    // เลขหน้าอยู่ใต้ขอบล่าง — ถ้าไม่ปิดขอบชั่วคราว pdfkit จะนึกว่าล้นหน้าแล้วเพิ่มหน้าว่างให้ทุกหน้า
    doc.page.margins.bottom = 0;
    doc.font("th").fontSize(8).fillColor("#888")
      .text(`${i + 1} / ${range.count}`, left, doc.page.height - 24, { width: usable, align: "right", lineBreak: false });
  }
  doc.end();
  return done;
}

