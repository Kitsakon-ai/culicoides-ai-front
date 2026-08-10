"use client";

// ── ย่อรูปในเบราว์เซอร์ก่อนส่งขึ้น server ────────────────────────────
// Vercel จำกัด request body ของ function ไว้ที่ 4.5 MB — ภาพจากกล้องจุลทรรศน์
// (เช่น 4912×3684 ≈ 18 ล้านพิกเซล) ทะลุลิมิตนี้ประจำ แล้วโดนตัดตั้งแต่ชั้น edge
// เป็น FUNCTION_PAYLOAD_TOO_LARGE ก่อนเข้าโค้ดเราด้วยซ้ำ
//
// ย่อได้โดยไม่เสียความแม่นยำ เพราะปลายทางย่อลงอีกอยู่แล้ว:
//   - CNN (predict) ย่อเป็น 224×224
//   - vision LLM ย่อเหลือด้านยาว ~1568 px
// ที่ส่งไปเต็มความละเอียดตอนนี้คือทิ้งทั้งแบนด์วิดท์ เวลา และค่า token เปล่า ๆ
//
// ข้อจำกัด: เบราว์เซอร์ decode TIFF ไม่ได้ → คืนไฟล์เดิม (ให้ /api/upload แปลงเอง)

export const MAX_EDGE = 2048;          // ด้านยาวสุดหลังย่อ (พอสำหรับ LLM ที่ cap 1568)
export const MAX_UPLOAD_BYTES = 4_000_000; // เผื่อ overhead ของ multipart จากลิมิต 4.5 MB
const JPEG_QUALITY = 0.92;

export type ResizeResult = {
  file: File;
  preview: string;   // data URL ของไฟล์ที่จะส่งจริง
  resized: boolean;
  /** ยังใหญ่เกินลิมิตของ Vercel อยู่ไหม (เช่น TIFF ที่ย่อในเบราว์เซอร์ไม่ได้) */
  tooLarge: boolean;
  note: string;
};

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

async function drawScaled(bitmap: ImageBitmap, maxEdge: number, quality: number) {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // JPEG ไม่มี alpha — รองพื้นขาวไว้ก่อน กัน PNG โปร่งใสกลายเป็นพื้นดำ
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);

  const blob = await canvasToBlob(canvas, quality);
  return blob ? { blob, w, h } : null;
}

export async function downscaleImage(file: File): Promise<ResizeResult> {
  const keepOriginal = async (note: string, tooLarge = file.size > MAX_UPLOAD_BYTES) => ({
    file,
    preview: await readAsDataUrl(file),
    resized: false,
    tooLarge,
    note,
  });

  let bitmap: ImageBitmap;
  try {
    // TIFF และฟอร์แมตที่เบราว์เซอร์ไม่รู้จักจะ throw ตรงนี้
    bitmap = await createImageBitmap(file);
  } catch {
    return keepOriginal("เบราว์เซอร์อ่านฟอร์แมตนี้ไม่ได้ (เช่น TIFF) — ส่งไฟล์เดิม");
  }

  const longest = Math.max(bitmap.width, bitmap.height);
  if (longest <= MAX_EDGE && file.size <= MAX_UPLOAD_BYTES) {
    bitmap.close();
    return keepOriginal(`${bitmap.width}×${bitmap.height} เล็กพออยู่แล้ว`, false);
  }

  try {
    let out = await drawScaled(bitmap, MAX_EDGE, JPEG_QUALITY);
    // เผื่อกรณีสุดโต่ง: ย่อแล้วยังเกินลิมิต → ลดคุณภาพ/ขนาดลงอีกขั้น
    if (out && out.blob.size > MAX_UPLOAD_BYTES) {
      out = await drawScaled(bitmap, 1600, 0.85);
    }
    if (!out) return keepOriginal("สร้าง canvas ไม่ได้ — ส่งไฟล์เดิม");

    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    const resizedFile = new File([out.blob], name, { type: "image/jpeg" });

    return {
      file: resizedFile,
      preview: await readAsDataUrl(out.blob),
      resized: true,
      tooLarge: resizedFile.size > MAX_UPLOAD_BYTES,
      note:
        `${bitmap.width}×${bitmap.height} ${(file.size / 1024 / 1024).toFixed(2)}MB → ` +
        `${out.w}×${out.h} ${(resizedFile.size / 1024 / 1024).toFixed(2)}MB`,
    };
  } finally {
    bitmap.close();
  }
}
