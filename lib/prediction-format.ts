import type { Lang } from "@/lib/i18n";
import type { PredictionResult } from "@/lib/types";

// ตัด field รูปภาพ (gradcam/annotatedImage/heatmap เป็น base64 ขนาดใหญ่) ออกก่อนส่งไป /api/chat
// เพราะ backend ใช้แค่ species/genus/confidence/topK/explanation และการส่ง base64 ซ้ำทุกครั้ง
// ทำให้ payload ใหญ่เกิน Vercel function limit ได้ (FUNCTION_PAYLOAD_TOO_LARGE)
export function toPredictionPayload(result: PredictionResult) {
  return {
    species: result.species,
    genus: result.genus,
    confidence: result.confidence,
    confidenceLevel: result.confidenceLevel,
    topK: result.topK,
    explanation: result.explanation,
  };
}

// ตรวจจับ error โควต้า/usage limit ของ provider ต่าง ๆ (Anthropic ใช้คำว่า "usage limit"
// ไม่ใช่ "quota" เหมือน OpenAI) แล้วแปลงเป็นข้อความที่ผู้ใช้เข้าใจได้ทันที
export function friendlyChatErrorMessage(error: unknown, lang: Lang): string {
  const rawMessage = error instanceof Error ? error.message : String(error ?? "");
  const isQuota = /insufficient_quota|quota|usage limit/i.test(rawMessage);

  if (isQuota) {
    return lang === "th"
      ? "โควต้าการใช้งาน AI เต็มแล้ว กรุณาลองใหม่ภายหลัง"
      : "AI usage quota exceeded, please try again later";
  }

  return lang === "th"
    ? `เกิดข้อผิดพลาด${rawMessage ? `: ${rawMessage}` : ""}`
    : `Error${rawMessage ? `: ${rawMessage}` : ""}`;
}
