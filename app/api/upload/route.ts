import { put } from "@vercel/blob";
import sharp from "sharp";
import { LLM_SAFE_IMAGE_TYPES } from "@/lib/types";

export const runtime = "nodejs";

// รูปที่อัปขึ้น Blob จะถูกส่งต่อให้ vision LLM ผ่าน URL ซึ่งทุกเจ้ารองรับแค่ไม่กี่ฟอร์แมต
// (Anthropic/OpenAI/Gemini: JPEG, PNG, GIF, WebP) — แต่ dataset ของโปรเจกต์นี้เป็น TIFF
// (โมเดลชื่อ *_tif_best.pth) ถ้าปล่อยผ่านไป Anthropic จะตอบ 400
// "The file format is invalid or unsupported" และคำอธิบายทั้งก้อนล้มทันที
// → แปลงเป็น PNG ตั้งแต่ตรงนี้ที่เดียว ปลายทางทุกเส้นทาง (chat, annotate) ได้รูปที่ใช้ได้เสมอ
// หมายเหตุ: /api/predict ส่งไฟล์ต้นฉบับให้ FastAPI ตรง ๆ ไม่ผ่านที่นี่ TIFF จึงยังถึงโมเดลตามเดิม

export async function GET() {
  return Response.json({ ok: true, route: "upload" });
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return Response.json({ error: "No file uploaded" }, { status: 400 });
    }

    let body: File | Buffer = file;
    let name = file.name;
    let contentType = file.type;

    if (!LLM_SAFE_IMAGE_TYPES.has(file.type)) {
      try {
        body = await sharp(Buffer.from(await file.arrayBuffer()))
          .png()
          .toBuffer();
        name = name.replace(/\.[^.]+$/, "") + ".png";
        contentType = "image/png";
      } catch (err) {
        // แปลงไม่ได้ก็อัปของเดิมไป ดีกว่าทำให้ทั้ง request ล้ม
        console.error("Upload: PNG conversion failed, storing original:", err);
      }
    }

    const blob = await put(`${Date.now()}-${name}`, body, {
      access: "public",
      addRandomSuffix: true,
      contentType,
    });

    return Response.json({
      url: blob.url,
      pathname: blob.pathname,
    });
  } catch (error) {
    console.error("Upload error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 500 }
    );
  }
}
