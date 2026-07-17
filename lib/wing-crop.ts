import sharp from "sharp";

// ── Wing localization + crop ─────────────────────────────────
// ปีกมักเล็กและอยู่ไม่กลางเฟรม + พื้นหลังว่างเยอะ → vision LLM ชี้พิกัดพลาด
// วิธีแก้: หา region ปีกด้วย CV (luminance threshold + grid density) แล้ว crop ให้ปีกเต็มเฟรม
// ก่อนส่งให้ LLM ชี้ จากนั้น map พิกัดกลับสู่ภาพเต็ม
// ทุก path resilient: ถ้าตรวจไม่เจอ/ผิดพลาด → คืนภาพเต็ม (box=null) ไม่ throw

export type CropResult = {
  base64: string;
  mime: string;
  // bbox ของ crop เทียบกับภาพเต็ม (fraction 0..1) — ใช้ map พิกัด feature กลับ
  // null = ไม่ได้ crop (ใช้ภาพเต็ม)
  box: { x: number; y: number; w: number; h: number } | null;
};

function mimeFromFormat(format?: string): string {
  if (format === "png") return "image/png";
  if (format === "webp") return "image/webp";
  return "image/jpeg";
}

function fullImage(buf: Buffer, format?: string): CropResult {
  return { base64: buf.toString("base64"), mime: mimeFromFormat(format), box: null };
}

function median(arr: Uint8Array): number {
  const copy = Uint8Array.from(arr);
  copy.sort();
  return copy[copy.length >> 1];
}

function medianAbsDev(arr: Uint8Array, center: number): number {
  const dev = new Uint8Array(arr.length);
  for (let i = 0; i < arr.length; i++) dev[i] = Math.abs(arr[i] - center);
  return median(dev);
}

export async function loadAndCropWing(imageUrl: string): Promise<CropResult | null> {
  const res = await fetch(imageUrl);
  if (!res.ok) return null;
  const inputBuf = Buffer.from(await res.arrayBuffer());

  let format: string | undefined;
  try {
    const meta = await sharp(inputBuf, { failOn: "none" }).metadata();
    format = meta.format;
    const W = meta.width ?? 0;
    const H = meta.height ?? 0;
    if (!W || !H) return fullImage(inputBuf, format);

    // ย่อเป็นภาพเทาเล็ก ๆ เพื่อประเมินตำแหน่งปีกอย่างรวดเร็ว
    const SW = 256;
    const SH = Math.max(1, Math.round((H / W) * SW));
    const { data } = await sharp(inputBuf, { failOn: "none" })
      .resize(SW, SH, { fit: "fill" })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // พื้นหลังครองภาพ → median luminance ≈ สีพื้นหลัง; foreground = ต่างจากพื้นหลังพอ
    const bg = median(data);
    const mad = medianAbsDev(data, bg);
    const T = Math.max(16, Math.round(2.2 * mad));

    // grid density: ปีกเป็นก้อนใหญ่ต่อเนื่อง (cell แน่น) ส่วนฝุ่น/จุดรบกวนกระจายเบาบาง → ถูกกรองทิ้ง
    const GX = 40;
    const GY = Math.max(1, Math.round((SH / SW) * GX));
    const cellW = SW / GX;
    const cellH = SH / GY;
    const dens = new Float32Array(GX * GY);
    for (let y = 0; y < SH; y++) {
      const gy = Math.min(GY - 1, Math.floor(y / cellH));
      for (let x = 0; x < SW; x++) {
        if (Math.abs(data[y * SW + x] - bg) > T) {
          const gx = Math.min(GX - 1, Math.floor(x / cellW));
          dens[gy * GX + gx] += 1;
        }
      }
    }

    const cellArea = cellW * cellH;
    const DENS = 0.12; // สัดส่วน foreground ขั้นต่ำในเซลล์จึงนับว่าเป็นส่วนของปีก
    const keep = new Uint8Array(GX * GY);
    for (let i = 0; i < keep.length; i++) keep[i] = dens[i] / cellArea >= DENS ? 1 : 0;

    // เอา "ก้อนต่อเนื่องที่ใหญ่สุด" = ปีก (4-connectivity flood fill)
    // จุดฝุ่นเล็ก ๆ ที่ dense ในเซลล์ตัวเองจะแยกเป็นก้อนเล็ก → ถูกทิ้ง
    const seen = new Uint8Array(GX * GY);
    let best = { cells: 0, minGX: 0, minGY: 0, maxGX: -1, maxGY: -1 };
    const stack: number[] = [];
    for (let start = 0; start < keep.length; start++) {
      if (!keep[start] || seen[start]) continue;
      stack.length = 0;
      stack.push(start);
      seen[start] = 1;
      let cells = 0, bMinX = GX, bMinY = GY, bMaxX = -1, bMaxY = -1;
      while (stack.length) {
        const c = stack.pop() as number;
        const cx = c % GX, cy = (c / GX) | 0;
        cells++;
        if (cx < bMinX) bMinX = cx;
        if (cx > bMaxX) bMaxX = cx;
        if (cy < bMinY) bMinY = cy;
        if (cy > bMaxY) bMaxY = cy;
        const nb = [cx > 0 ? c - 1 : -1, cx < GX - 1 ? c + 1 : -1, cy > 0 ? c - GX : -1, cy < GY - 1 ? c + GX : -1];
        for (const n of nb) if (n >= 0 && keep[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
      }
      if (cells > best.cells) best = { cells, minGX: bMinX, minGY: bMinY, maxGX: bMaxX, maxGY: bMaxY };
    }
    if (best.cells < 4 || best.maxGX < best.minGX) return fullImage(inputBuf, format);
    const { minGX, minGY, maxGX, maxGY } = best;

    // bbox (fraction) + padding เผื่อขอบปีก
    let fx0 = minGX / GX;
    let fy0 = minGY / GY;
    let fx1 = (maxGX + 1) / GX;
    let fy1 = (maxGY + 1) / GY;
    const padX = (fx1 - fx0) * 0.1;
    const padY = (fy1 - fy0) * 0.1;
    fx0 = Math.max(0, fx0 - padX);
    fy0 = Math.max(0, fy0 - padY);
    fx1 = Math.min(1, fx1 + padX);
    fy1 = Math.min(1, fy1 + padY);

    const box = { x: fx0, y: fy0, w: fx1 - fx0, h: fy1 - fy0 };
    // ถ้าปีกครอบเกือบเต็มเฟรมอยู่แล้ว crop ก็ไม่ช่วย → ใช้ภาพเต็ม
    if (box.w >= 0.92 && box.h >= 0.92) return fullImage(inputBuf, format);

    const left = Math.round(box.x * W);
    const top = Math.round(box.y * H);
    const width = Math.min(Math.max(1, Math.round(box.w * W)), W - left);
    const height = Math.min(Math.max(1, Math.round(box.h * H)), H - top);

    const outBuf = await sharp(inputBuf, { failOn: "none" })
      .extract({ left, top, width, height })
      .png()
      .toBuffer();

    return { base64: outBuf.toString("base64"), mime: "image/png", box };
  } catch (err) {
    console.error("loadAndCropWing error:", err);
    return fullImage(inputBuf, format);
  }
}
