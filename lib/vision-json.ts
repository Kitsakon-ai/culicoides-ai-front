// ส่งภาพ + prompt ให้ vision LLM แล้วรับข้อความ (มักเป็น JSON) กลับมา — ใช้กับงาน "ชี้ตำแหน่งบนภาพ"
//
// ลำดับค่าย: Gemini 3.6 Flash ก่อน เพราะทดสอบแล้วชี้ตำแหน่งบนปีกแม่นที่สุดในราคานี้
// (Flash-Lite ชี้ r-m ผิดฝั่ง stigma) ถ้าไม่มีคีย์หรือพังค่อยลอง OpenAI แล้ว Claude
// ใช้ร่วมกันใน lib/label-boxes.ts (หากรอบป้ายในภาพ) และ lib/chat-tools.ts (วาดตามคำขอในแชต)

import Anthropic from "@anthropic-ai/sdk";

type Provider = (png: string, mime: string, prompt: string) => Promise<string | null>;

const viaGemini: Provider = async (img, mime, prompt) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: img } }] }],
        generationConfig: {
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
          // งานชี้ตำแหน่ง ไม่ต้อง reasoning ยาว (ลองระดับ low แล้วไม่แม่นขึ้น)
          thinkingConfig: { thinkingLevel: "minimal" },
        },
      }),
    }
  );
  if (!res.ok) {
    console.error("vision-json gemini:", res.status, await res.text());
    return null;
  }
  const data = await res.json();
  return (data?.candidates?.[0]?.content?.parts ?? [])
    .filter((p: { thought?: boolean }) => !p?.thought)
    .map((p: { text?: string }) => p?.text ?? "")
    .join("");
};

const viaOpenAI: Provider = async (img, mime, prompt) => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "gpt-4.1",
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          { type: "input_image", image_url: `data:${mime};base64,${img}`, detail: "high" },
        ],
      }],
    }),
  });
  if (!res.ok) {
    console.error("vision-json openai:", res.status, await res.text());
    return null;
  }
  const data = await res.json();
  return typeof data?.output_text === "string"
    ? data.output_text
    : (data?.output ?? [])
        .flatMap((i: { content?: { type: string; text?: string }[] }) => i?.content ?? [])
        .find((c: { type: string }) => c?.type === "output_text")?.text ?? null;
};

const viaClaude: Provider = async (img, mime, prompt) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const media = (["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mime) ? mime : "image/png") as
    "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  const msg = await new Anthropic({ apiKey: key }).messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 2048,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: media, data: img } },
        { type: "text", text: prompt },
      ],
    }],
  });
  return msg.content.find((b) => b.type === "text")?.text ?? null;
};

/** ลองทีละค่ายจนกว่า parse จะได้ผลที่ใช้ได้ — img = base64 ล้วน (ไม่มี data: นำหน้า) */
export async function askVision<T>(
  img: string,
  mime: string,
  prompt: string,
  parse: (text: string) => T | null
): Promise<T | null> {
  for (const call of [viaGemini, viaOpenAI, viaClaude]) {
    try {
      const text = await call(img, mime, prompt);
      const out = text ? parse(text) : null;
      if (out) return out;
    } catch (err) {
      console.error("vision-json:", err);
    }
  }
  return null;
}
