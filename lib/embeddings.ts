// สร้าง embedding ด้วย OpenAI (text-embedding-3-small, 1536 มิติ) สำหรับ RAG
// ใช้ OPENAI_API_KEY ที่มีอยู่แล้ว — ไม่ต้องลง dependency เพิ่ม
export async function embedText(text: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: text.slice(0, 8000), // กันข้อความยาวเกิน
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI embeddings error ${res.status}: ${await res.text().catch(() => "")}`);
  }

  const data = await res.json();
  const embedding = data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) throw new Error("OpenAI embeddings: unexpected response shape");
  return embedding as number[];
}
