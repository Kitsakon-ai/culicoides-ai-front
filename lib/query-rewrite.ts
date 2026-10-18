// เขียนคำถามของผู้ใช้ใหม่เป็นคำค้นภาษาอังกฤษก่อนค้นงานวิจัย (query rewriting)
// เหตุผล: คลังงานวิจัยเป็นภาษาอังกฤษทั้งหมด แต่ผู้ใช้ถามภาษาไทย — การทดลองใน
// benchmark/rag-sources พบว่าเอกสารเฉลยติดผลค้น 6 อันดับแรกเพิ่มจาก 57% เป็น 96%
// ล้มเหลว/ช้าเกิน → คืนข้อความเดิม (แชตยังทำงานได้ แค่ค้นแม่นน้อยลง)

const MODEL = "gpt-5.6-luna";
const TIMEOUT_MS = 6000;
const CACHE_MAX = 300;
const cache = new Map<string, string>();

function rewritePrompt(message: string, species: string): string {
  return `Rewrite the user's question as one concise English search query for retrieving passages from scientific papers about Culicoides biting midges.
- The system has identified the specimen as Culicoides ${species}; include that species name.
- Keep every specific term from the question (places, pathogens, hosts, numbers, years) and translate Thai place names to their usual English spelling.
- Add 2-4 technical synonyms a paper would use. Output only the query, no quotes.

Question: ${message}`;
}

export async function rewriteSearchQuery(message: string, species: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  const text = message.trim();
  if (!apiKey || !text) return text;

  const key = `${species}\n${text}`;
  const hit = cache.get(key);
  if (hit) return hit;

  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      // effort "none" ตอบใน ~2 วินาที (ค่าตั้งต้น ~3 วินาที) คำค้นที่ได้ใกล้เคียงกัน
      body: JSON.stringify({ model: MODEL, input: rewritePrompt(text, species), reasoning: { effort: "none" } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`rewrite ${res.status}`);
    const data = await res.json();
    const out = ((data?.output ?? []) as { content?: { type: string; text?: string }[] }[])
      .flatMap((o) => o.content ?? [])
      .filter((c) => c.type === "output_text")
      .map((c) => c.text ?? "")
      .join("")
      .trim();
    if (!out) return text;
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, out);
    return out;
  } catch (err) {
    console.error("rewriteSearchQuery failed, using original message:", err);
    return text;
  }
}
