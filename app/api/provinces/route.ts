import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";

type ProvincesBody = {
  species: string;
  ai_model: string;
};

function extractJsonArray(text: string): string[] {
  const match = text.match(/\[[\s\S]*?\]/);
  if (!match) return [];
  try {
    return JSON.parse(match[0]) as string[];
  } catch {
    return [];
  }
}

async function askOpenAI(aiModel: string, prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: aiModel,
      temperature: 0,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: prompt }],
        },
      ],
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`OpenAI error ${res.status}`);

  return (
    data?.output_text ||
    data?.output?.[0]?.content?.[0]?.text ||
    ""
  );
}

async function askGemini(aiModel: string, prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${aiModel}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0 },
      }),
    }
  );

  const data = await res.json();
  if (!res.ok) throw new Error(`Gemini error ${res.status}`);

  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

async function askClaude(aiModel: string, prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

  const client = new Anthropic({ apiKey });
  const supportsThinking = aiModel.startsWith("claude-opus") || aiModel.startsWith("claude-sonnet");
  const msg = await client.messages.create({
    model: aiModel,
    max_tokens: supportsThinking ? 16000 : 4096,
    ...(supportsThinking ? { thinking: { type: "adaptive" } } : {}),
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = msg.content.find((b) => b.type === "text");
  return textBlock?.type === "text" ? textBlock.text : "";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ProvincesBody;
    const { species, ai_model } = body;

    const prompt = `คุณเป็นผู้เชี่ยวชาญด้านกีฏวิทยาในประเทศไทย

จงระบุจังหวัดในประเทศไทยที่มีรายงานการพบแมลง Culicoides ${species}

ตอบเฉพาะ JSON array ของชื่อจังหวัดภาษาไทย (ไม่มีคำนำหน้า "จังหวัด") เท่านั้น
ตัวอย่างรูปแบบ: ["เชียงใหม่","แม่ฮ่องสอน","ลำปาง","เชียงราย"]

ไม่ต้องมีคำอธิบาย ตอบเฉพาะ JSON array เท่านั้น`;

    const provider = ai_model.startsWith("gpt")
      ? "openai"
      : ai_model.startsWith("claude")
      ? "claude"
      : "gemini";
    const raw =
      provider === "openai"
        ? await askOpenAI(ai_model, prompt)
        : provider === "claude"
        ? await askClaude(ai_model, prompt)
        : await askGemini(ai_model, prompt);

    const provinces = extractJsonArray(raw);

    return NextResponse.json({ provinces });
  } catch (error) {
    console.error("POST /api/provinces error:", error);
    return NextResponse.json({ provinces: [] }, { status: 500 });
  }
}
