import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createTimer } from "@/lib/server-timing";
import { levelFromConfidence } from "@/lib/confidence";

export const runtime = "nodejs";
// ปลุก HF Space + หาปีก + จำแนกทีละตัว — ใช้ลิมิตเดียวกับ /api/predict
export const maxDuration = 300;

const API_URL = (process.env.FASTAPI_URL || "http://127.0.0.1:3001").replace(/\/+$/, "");

export type DetectedWing = {
  box: [number, number, number, number]; // พิกัดบน "ภาพต้นฉบับ" ไม่ใช่ขนาดที่แสดงผล
  species: string | null;
  confidence: number | null;
  accepted: boolean;
  knnDistance: number;
  knnRadius: number;
  /** มีเฉพาะเมื่อขอ gradcam และปีกนั้นผ่านด่าน — เป็น data URL */
  gradcam?: string;
  heatmap?: string;
  gradcamError?: string;
  genus?: string | null;
};

export type DetectResponse = {
  wings: DetectedWing[];
  speciesFound: string[];
  speciesCount: number;
  wingsDetected: number;
  wingsAnswered: number;
  imageSize: [number, number];
  modelUsed: string;
};

/**
 * ส่งต่อไป FastAPI /detect — ตัวนี้ตอบว่า "ในรูปมีปีกกี่ตัว กี่ชนิด"
 * ต่างจาก /api/predict ที่มองทั้งรูปเป็นปีกเดียว
 *
 * ไม่บันทึกลง DB เพราะตาราง predictions ออกแบบไว้สำหรับผลเดียวต่อรูป
 * ส่วนตัวนี้ตอบได้หลายผลต่อรูป ถ้าจะเก็บประวัติต้องมีตารางใหม่
 */
export async function POST(req: Request) {
  const t = createTimer();
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const gradcam = (formData.get("gradcam") as string) || "false";
    const mlModel = (formData.get("ml_model") as string) || "efficientnet";
    t.mark("read-form");

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    console.log(
      `[perf] /api/detect input=${file.name} ${(file.size / 1024 / 1024).toFixed(2)}MB gradcam=${gradcam}`
    );

    const forwardForm = new FormData();
    forwardForm.append("file", file);
    forwardForm.append("gradcam", gradcam);
    forwardForm.append("ml_model", mlModel);

    const fastapiRes = await fetch(`${API_URL}/detect`, {
      method: "POST",
      body: forwardForm,
      cache: "no-store",
    });

    if (!fastapiRes.ok) {
      const text = await fastapiRes.text();
      return NextResponse.json(
        { error: text || "Detection failed from ML API" },
        { status: fastapiRes.status }
      );
    }

    const data = (await fastapiRes.json()) as DetectResponse;
    t.mark("fastapi");

    // บันทึกประวัติจากปีกที่มั่นใจที่สุด — เดิมงานนี้อยู่ที่ /api/predict
    // แต่ตอนนี้ตัวตัดสินคือโมเดลครอป ประวัติจึงต้องมาจากที่นี่แทน
    // ตาราง predictions เก็บได้ผลเดียวต่อรูป จึงเก็บตัวที่มั่นใจที่สุดเป็นตัวแทน
    const best = data.wings
      .filter((w) => w.species)
      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];

    if (best?.species) {
      try {
        const saved = await prisma.prediction.create({
          data: {
            filename: file.name,
            species: best.species,
            genus: best.genus ?? "Culicoides",
            confidence: best.confidence ?? 0,
            confidenceLevel: levelFromConfidence(best.confidence ?? 0),
            gradcam: Boolean(best.gradcam),
            modelUsed: data.modelUsed,
          },
        });

        // เก็บรายปีกด้วย — ตาราง predictions เก็บได้ผลเดียวต่อภาพ
        // แต่หนึ่งภาพมีได้หลายปีกหลายชนิด ถ้าไม่เก็บตรงนี้ข้อมูลจะหายไปหมด
        // (ตาราง prediction_wing มาจาก migration 0004)
        for (const [i, w] of data.wings.entries()) {
          await prisma.$executeRaw`
            insert into prediction_wing
              (prediction_id, wing_index, species, confidence, accepted,
               knn_distance, knn_radius, box_x0, box_y0, box_x1, box_y1)
            values
              (${saved.id}, ${i + 1}, ${w.species}, ${w.confidence}, ${w.accepted},
               ${w.knnDistance}, ${w.knnRadius},
               ${w.box[0]}, ${w.box[1]}, ${w.box[2]}, ${w.box[3]})
            on conflict (prediction_id, wing_index) do nothing
          `;
        }
        t.mark("db-insert");
      } catch (dbError) {
        // บันทึกประวัติไม่สำเร็จไม่ควรทำให้ผลตรวจหายไปทั้งก้อน
        console.error("POST /api/detect db insert failed:", dbError);
      }
    }

    t.log("/api/detect");

    return NextResponse.json(data, { headers: { "Server-Timing": t.header() } });
  } catch (error) {
    console.error("POST /api/detect error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
