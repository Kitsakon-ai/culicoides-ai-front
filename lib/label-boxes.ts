// หากรอบของ "ตัวหนังสือป้าย" ในภาพ annotation ที่โมเดลสร้างภาพวาดขึ้น
//
// โมเดลสร้างภาพวาดป้ายลงพิกเซล ระบบจึงไม่รู้ว่าป้ายอยู่ตรงไหน
// ขั้นนี้ให้ vision LLM อ่านภาพที่ได้แล้วคืนกรอบของแต่ละป้าย หน้าเว็บจะวางพื้นที่ชี้เมาส์ทับตัวหนังสือพอดี
// ชี้ที่ตัวหนังสือแล้วการ์ดลอยขึ้นมา โดยภาพยังเป็นภาพเดิมที่โมเดลวาดทุกพิกเซล
//
// เรียก vision LLM ผ่าน lib/vision-json.ts (Gemini ก่อน — ถูกฝึกให้คืนกรอบวัตถุ box_2d โดยตรง)

import { askVision } from "@/lib/vision-json";

/** กรอบเป็นสัดส่วน 0–1 ของภาพ */
export type LabelBox = { name: string; x0: number; y0: number; x1: number; y1: number };

function buildPrompt(names: string[]): string {
  return `This image is an annotated scientific figure of an insect wing: a wing photograph with short English text labels and arrows drawn around it.

Find every TEXT LABEL drawn on the figure — the words themselves, not the arrows and not the wing.
For each label return:
- "name": the item from this list that the label says. It must be copied EXACTLY from the list, even if the drawn text is spelled slightly differently or abbreviated:
${names.map((n) => `  - ${n}`).join("\n")}
- "box_2d": [ymin, xmin, ymax, xmax] tightly around the label text, normalized to 0-1000. If a label wraps onto two lines, the box must cover both lines.

Skip any text that matches nothing in the list (for example a caption bar along the bottom edge).
Return a JSON array only.`;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

function parse(text: string, names: string[]): LabelBox[] {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return [];
  let raw: { name?: string; box_2d?: number[] }[];
  try {
    raw = JSON.parse(m[0]);
  } catch {
    return [];
  }
  const byNorm = new Map(names.map((n) => [norm(n), n]));
  const seen = new Set<string>();
  const out: LabelBox[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const name = byNorm.get(norm(r?.name ?? ""));
    const b = r?.box_2d;
    if (!name || seen.has(name) || !Array.isArray(b) || b.length !== 4 || !b.every(Number.isFinite)) continue;
    const [ymin, xmin, ymax, xmax] = b.map((v) => Math.max(0, Math.min(1000, v)) / 1000);
    if (xmax - xmin < 0.01 || ymax - ymin < 0.005) continue;
    // ขยายกรอบเล็กน้อย — กรอบที่โมเดลคืนมามักแนบตัวอักษรพอดีเกินไป ชี้โดนขอบตัวหนังสือแล้วไม่ติด
    const padX = 0.008;
    const padY = 0.006;
    seen.add(name);
    out.push({
      name,
      x0: Math.max(0, xmin - padX),
      y0: Math.max(0, ymin - padY),
      x1: Math.min(1, xmax + padX),
      y1: Math.min(1, ymax + padY),
    });
  }
  return out;
}

// ── ขยับกรอบให้ตรงตัวหนังสือจริงด้วยพิกเซล ───────────────────────────────
//
// กรอบที่ LLM คืนมาเลื่อนไปทางขวาเป็นระบบ (ทดสอบ 2 รอบบนภาพจริง: "r-m crossvein" ได้แค่ "crossvein",
// "Costal margin" ตกตัว "Co") ใช้คิดให้นานขึ้นก็ไม่หาย จึงใช้กรอบของ LLM แค่บอกว่าป้ายอยู่แถวไหน
// แล้วหาตัวอักษรจริงจากพิกเซลเอง: ป้ายเป็นตัวหนังสือสีเข้มบนพื้นสว่าง → หาก้อนพิกเซลเข้ม
// ทิ้งก้อนที่ยาวผอม (ลูกศร) แล้วขยายจากก้อนที่ทับกรอบเดิมไปหาก้อนข้างเคียงในบรรทัดเดียวกัน/บรรทัดถัดไป

type Comp = { x0: number; y0: number; x1: number; y1: number };

function components(mask: Uint8Array, W: number, H: number, win: Comp): Comp[] {
  const seen = new Uint8Array(W * H);
  const out: Comp[] = [];
  const stack: number[] = [];
  for (let y = win.y0; y <= win.y1; y++) {
    for (let x = win.x0; x <= win.x1; x++) {
      const i = y * W + x;
      if (!mask[i] || seen[i]) continue;
      const c: Comp = { x0: x, y0: y, x1: x, y1: y };
      seen[i] = 1;
      stack.push(i);
      while (stack.length) {
        const j = stack.pop()!;
        const jx = j % W;
        const jy = (j - jx) / W;
        if (jx < c.x0) c.x0 = jx;
        if (jx > c.x1) c.x1 = jx;
        if (jy < c.y0) c.y0 = jy;
        if (jy > c.y1) c.y1 = jy;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = jx + dx;
            const ny = jy + dy;
            if (nx < win.x0 || nx > win.x1 || ny < win.y0 || ny > win.y1) continue;
            const k = ny * W + nx;
            if (mask[k] && !seen[k]) {
              seen[k] = 1;
              stack.push(k);
            }
          }
        }
      }
      out.push(c);
    }
  }
  return out;
}

function snapBox(mask: Uint8Array, W: number, H: number, b: LabelBox): LabelBox {
  const seed: Comp = { x0: b.x0 * W, y0: b.y0 * H, x1: b.x1 * W, y1: b.y1 * H };
  const win: Comp = {
    x0: Math.max(0, Math.round(seed.x0 - 0.12 * W)),
    x1: Math.min(W - 1, Math.round(seed.x1 + 0.12 * W)),
    y0: Math.max(0, Math.round(seed.y0 - 0.03 * H)),
    y1: Math.min(H - 1, Math.round(seed.y1 + 0.03 * H)),
  };
  const lineH = 0.07 * H; // ตัวอักษรสูงไม่เกินนี้ (ภาพ 1024 ≈ 70px)
  const glyphs = components(mask, W, H, win).filter((c) => {
    const w = c.x1 - c.x0 + 1;
    const h = c.y1 - c.y0 + 1;
    if (w * h < 6 || h > lineH || w > 0.2 * W) return false;
    // ลูกศร/เส้นนำ: ยาวผอม
    return !((w > 4 * h && h <= 4) || (h > 4 * w && w <= 4) || w > 6 * h);
  });
  if (!glyphs.length) return b;

  const hits = (c: Comp, r: Comp) => c.x0 <= r.x1 && c.x1 >= r.x0 && c.y0 <= r.y1 && c.y1 >= r.y0;
  const picked = new Set(glyphs.filter((g) => hits(g, seed)));
  if (!picked.size) return b;
  const medH = [...picked].map((g) => g.y1 - g.y0 + 1).sort((a, z) => a - z)[picked.size >> 1];

  // ขยายไปหาก้อนข้างเคียง: บรรทัดเดียวกันห่างไม่เกินช่องว่างระหว่างคำ หรือบรรทัดถัดไปที่ซ้อนแนวนอนกัน
  for (let grew = true; grew; ) {
    grew = false;
    for (const g of glyphs) {
      if (picked.has(g)) continue;
      for (const p of picked) {
        const vOverlap = Math.min(g.y1, p.y1) - Math.max(g.y0, p.y0);
        const hGap = Math.max(g.x0 - p.x1, p.x0 - g.x1);
        const hOverlap = Math.min(g.x1, p.x1) - Math.max(g.x0, p.x0);
        const vGap = Math.max(g.y0 - p.y1, p.y0 - g.y1);
        const sameLine = vOverlap > 0.4 * medH && hGap <= 0.9 * medH;
        const nextLine = vGap >= 0 && vGap <= 0.8 * medH && hOverlap > -0.5 * medH;
        if (sameLine || nextLine) {
          picked.add(g);
          grew = true;
          break;
        }
      }
    }
  }

  const u = [...picked].reduce((a, g) => ({
    x0: Math.min(a.x0, g.x0), y0: Math.min(a.y0, g.y0), x1: Math.max(a.x1, g.x1), y1: Math.max(a.y1, g.y1),
  }));
  const pad = Math.max(3, medH * 0.35);
  return {
    name: b.name,
    x0: Math.max(0, (u.x0 - pad) / W),
    y0: Math.max(0, (u.y0 - pad) / H),
    x1: Math.min(1, (u.x1 + pad) / W),
    y1: Math.min(1, (u.y1 + pad) / H),
  };
}

async function snapAll(png: string, boxes: LabelBox[]): Promise<LabelBox[]> {
  try {
    const sharp = (await import("sharp")).default;
    const { data, info } = await sharp(Buffer.from(png, "base64")).greyscale().raw().toBuffer({ resolveWithObject: true });
    const W = info.width;
    const H = info.height;
    const mask = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) mask[i] = data[i * info.channels] < 110 ? 1 : 0;
    return boxes.map((b) => snapBox(mask, W, H, b));
  } catch (err) {
    console.error("label-boxes snap:", err);
    return boxes;
  }
}

/** png = base64 ล้วน (ไม่มี data: นำหน้า) · names = ชื่อป้ายที่สั่งให้โมเดลสร้างภาพวาด */
export async function detectLabelBoxes(png: string, names: string[]): Promise<LabelBox[]> {
  if (!names.length) return [];
  const boxes = await askVision(png, "image/png", buildPrompt(names), (text) => {
    const b = parse(text, names);
    return b.length ? b : null;
  });
  return boxes ? snapAll(png, boxes) : [];
}
