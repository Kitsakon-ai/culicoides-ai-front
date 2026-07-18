import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getProvincesForSpecies } from "@/lib/knowledge";

export const runtime = "nodejs";
// Vercel Pro (Fluid Compute) — up to 300s (DB-first เร็ว, เผื่อ LLM fallback ช้า)
export const maxDuration = 300;

type ProvincesBody = {
  species: string;
  ai_model: string;
};

const PROVINCES_JSON_SCHEMA = {
  type: "object",
  properties: { provinces: { type: "array", items: { type: "string" } } },
  required: ["provinces"],
  additionalProperties: false,
};

function extractJsonArray(text: string): string[] {
  // OpenAI structured-output responses are a JSON object ({"provinces": [...]}).
  try {
    const parsed = JSON.parse(text);
    if (parsed && Array.isArray(parsed.provinces)) return parsed.provinces;
  } catch {
    // fall through to free-form array extraction (Claude/Gemini return plain text)
  }

  const match = text.match(/\[[\s\S]*?\]/);
  if (!match) return [];
  try {
    return JSON.parse(match[0]) as string[];
  } catch {
    return [];
  }
}

// Reasoning models (gpt-5.x) put a "reasoning" item (empty content) first in
// output[], with the actual answer in a later "message" item — output[0] is
// not reliably the answer, unlike gpt-4.x/gpt-4o where it is.
function extractOpenAIText(data: any): string {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text;
  }

  const output = Array.isArray(data?.output) ? data.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (part?.type === "output_text" && typeof part?.text === "string" && part.text.trim()) {
        return part.text;
      }
    }
  }

  return "";
}

async function askOpenAI(aiModel: string, prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

  // gpt-5.x models reject the "temperature" param outright ("Unsupported
  // parameter"), unlike gpt-4.x/gpt-4o which accept it.
  const supportsTemperature = !aiModel.startsWith("gpt-5");
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: aiModel,
      ...(supportsTemperature ? { temperature: 0 } : {}),
      // gpt-5.x is a reasoning model; full reasoning made this simple recall task
      // take minutes. "low" effort is faster and — unlike "minimal" — is still
      // compatible with the json_schema structured output below.
      ...(aiModel.startsWith("gpt-5") ? { reasoning: { effort: "low" } } : {}),
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: prompt }],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "provinces",
          schema: PROVINCES_JSON_SCHEMA,
          strict: true,
        },
      },
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);

  return extractOpenAIText(data);
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

  if (!res.ok) {
    // ไม่สลับโมเดลแทนให้อัตโนมัติ — ผู้ใช้ต้องรู้ว่าโมเดลที่เลือกไว้มีปัญหาอะไร
    if (res.status === 503 || res.status === 429) {
      throw new Error(
        `${aiModel} คิวเต็มชั่วคราวฝั่ง Google (${res.status}) — รอสักครู่แล้วลองใหม่ หรือเปลี่ยนโมเดลจากเมนู`
      );
    }
    throw new Error(`Gemini error ${res.status}`);
  }

  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

// Same fallback chain as app/api/chat/route.ts: Anthropic's automated "bio"
// safety classifier refuses this province/species-distribution lookup on
// Opus (confirmed via direct API test) while Sonnet and Haiku answer it
// normally, so on a refusal we retry once with the next model down instead
// of silently returning an empty province list.
const CLAUDE_FALLBACK_MODEL: Record<string, string> = {
  "claude-opus-4-8": "claude-sonnet-4-6",
  "claude-sonnet-4-6": "claude-haiku-4-5",
};

async function callClaude(apiKey: string, aiModel: string, prompt: string) {
  const client = new Anthropic({ apiKey });
  // A province list is short structured output. Adaptive "thinking" + max_tokens
  // 16000 previously pushed this call to ~138s (FUNCTION_INVOCATION_TIMEOUT risk);
  // dropping thinking and capping the budget keeps it to a few seconds.
  return client.messages.create({
    model: aiModel,
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });
}

async function askClaude(aiModel: string, prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

  let msg = await callClaude(apiKey, aiModel, prompt);

  if (msg.stop_reason === "refusal") {
    const fallbackModel = CLAUDE_FALLBACK_MODEL[aiModel];
    console.error(
      "askClaude (provinces): refusal, falling back to next model",
      JSON.stringify({ aiModel, category: (msg.stop_details as any)?.category, fallbackModel }, null, 2)
    );
    if (fallbackModel) {
      msg = await callClaude(apiKey, fallbackModel, prompt);
    }
  }

  const textBlock = msg.content.find((b) => b.type === "text");
  return textBlock?.type === "text" ? textBlock.text : "";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ProvincesBody;
    const { species, ai_model } = body;

    // ── DB first: จังหวัดจริงจากฐานข้อมูล (แม่น/เร็ว/ไม่มโน/ไม่โดน LLM refuse) ──
    // ถ้าชนิดนี้ยังไม่มีในฐานข้อมูล → fallback ไปถาม LLM (ของเดิม) ด้านล่าง
    const dbProvinces = await getProvincesForSpecies(species);
    if (dbProvinces.length > 0) {
      return NextResponse.json({ provinces: dbProvinces });
    }

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
