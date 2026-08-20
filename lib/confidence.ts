// ── เกณฑ์ความเชื่อมั่นของผลจำแนก (แหล่งความจริงเดียวของทั้งระบบ) ──────
//
//   conf >= 0.85            → "high"  แสดงผลตามปกติ
//   0.70 <= conf < 0.85     → "low"   แสดงผล + เตือนให้ถ่ายใหม่
//   conf <  0.70            → "ood"   ไม่แสดงผล ให้อัปโหลดรูปใหม่
//
// คำนวณฝั่งเราเองจากค่า confidence ที่ FastAPI ส่งมา ไม่ใช้ confidenceLevel ของ backend
// เพราะ backend อยู่คนละที่ (HF Space) และอาจใช้เกณฑ์คนละชุด — ถ้าอยากปรับเกณฑ์
// แก้ที่ไฟล์นี้ไฟล์เดียวแล้วมีผลทั้ง UI, prompt ที่ส่งให้ LLM และประวัติที่บันทึกลง DB

export type ConfidenceLevel = "high" | "low" | "ood";

export const CONFIDENCE_HIGH = 0.85;
export const CONFIDENCE_LOW = 0.70;

export function levelFromConfidence(confidence: number): ConfidenceLevel {
  if (!Number.isFinite(confidence)) return "ood";
  if (confidence >= CONFIDENCE_HIGH) return "high";
  if (confidence >= CONFIDENCE_LOW) return "low";
  return "ood";
}

// ใช้กับผลจาก FastAPI ก่อนส่งต่อทุกปลายทาง
export function withConfidenceLevel<T extends { confidence: number }>(
  data: T
): T & { confidenceLevel: ConfidenceLevel } {
  return { ...data, confidenceLevel: levelFromConfidence(data.confidence) };
}
