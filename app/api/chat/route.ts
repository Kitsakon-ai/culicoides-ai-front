import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";

type Msg = {
  role: "user" | "assistant";
  content: string;
};

type ChatBody = {
  provider: "openai" | "gemini" | "claude";
  ai_model: string;
  mode?: "explanation" | "vision";
  message: string;
  prediction: {
    species: string;
    genus: string;
    confidence: number;
    confidenceLevel: "high" | "low" | "ood";
    topK?: { name: string; probability: number }[];
    explanation?: string;
  } | null;
  xai?: {
    highlightedRegions?: string[];
    confidenceDrivers?: string[];
    warningFlags?: string[];
  };
  images?: {
    original?: string | null;
    heatmap?: string | null;
  };
  history?: Msg[];
};

function isHttpUrl(value?: string | null) {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function buildExplanationPrompt(body: ChatBody) {
  const p = body.prediction;

  if (!p) {
    return `ตอบเป็นภาษาไทย แจ้งว่าไม่มีข้อมูลผลทำนายเพียงพอ`;
  }

  return `คุณเป็นผู้เชี่ยวชาญอธิบายผล Explainable AI สำหรับการจำแนกแมลง Culicoides

ข้อมูลผลทำนาย:
- ชนิด: ${p.species} | สกุล: ${p.genus}
- ความเชื่อมั่น: ${(p.confidence * 100).toFixed(2)}% | สถานะ: ${p.confidenceLevel}
- topK: ${p.topK?.map((x) => `${x.name} ${(x.probability * 100).toFixed(1)}%`).join(", ") || "-"}
- Grad-CAM เน้น: ${(body.xai?.highlightedRegions ?? []).join(", ") || "-"}
- confidenceDrivers: ${(body.xai?.confidenceDrivers ?? []).join(", ") || "-"}
${p.confidenceLevel !== "high" ? `- ⚠ ความเชื่อมั่นต่ำหรือ OD` : ""}

จงเขียนผลวิเคราะห์เป็นภาษาไทย จัดเป็น 4 หมวดตามนี้ทุกครั้ง:

## ผลการทำนาย
อธิบายชนิดที่ทำนาย ค่าความเชื่อมั่น สถานะ และ topK เปรียบเทียบ (3-4 bullet)

## ลักษณะที่ตรวจพบ
อธิบายลักษณะปีกจากภาพต้นฉบับที่สังเกตได้ เช่น รูปร่าง ลวดลาย ความเข้ม จุดสี (3-4 bullet)

## การตีความ Heatmap (Grad-CAM)
อธิบายว่า heatmap เน้นบริเวณใด และบริเวณนั้นสัมพันธ์กับการตัดสินใจของโมเดลอย่างไร (2-3 bullet)

## ข้อแนะนำ
${p.confidenceLevel !== "high" ? "เตือนว่าผลเบื้องต้น แนะนำการยืนยันเพิ่มเติม" : "ให้คำแนะนำเกี่ยวกับความน่าเชื่อถือของผล"} (1-2 bullet)

กฎเคร่งครัด:
- ใช้ ## สำหรับหัวข้อ และ - สำหรับ bullet เท่านั้น
- ห้ามขึ้นต้นด้วยชื่อรูปแบบ เช่น "แบบ A" หรือ "รูปแบบ"
- ห้ามแต่งรายละเอียดปีกที่ไม่มีในภาพ ถ้าไม่ชัดให้บอกตรง ๆ
- ห้ามใช้ตัวเลขนำหน้าข้อ`;
}

function buildVisionPrompt(body: ChatBody) {
  const historyText =
    body.history?.map((m) => `${m.role === "user" ? "ผู้ใช้" : "ผู้ช่วย"}: ${m.content}`).join("\n") ||
    "ยังไม่มีประวัติการสนทนา";

  const p = body.prediction;

  return `คุณคือ AI ผู้ช่วยวิเคราะห์ภาพแมลง Culicoides ตอบภาษาไทย กระชับตรงคำถาม ไม่ต้องขยายความเกิน

บริบท:
${p ? `ทำนาย: ${p.species} (${(p.confidence * 100).toFixed(1)}%, ${p.confidenceLevel}) | topK: ${p.topK?.map((x) => `${x.name} ${(x.probability * 100).toFixed(1)}%`).join(", ") || "-"}` : "ไม่มีผลทำนาย"}
Grad-CAM เน้น: ${(body.xai?.highlightedRegions ?? []).join(", ") || "-"}

ประวัติ:
${historyText}

คำถาม: ${body.message}

ตอบตรงคำถาม สั้นเท่าที่จำเป็น ห้ามแต่งข้อมูลที่ไม่มีในภาพ ถ้าไม่แน่ใจให้บอกตรง ๆ`;
}

async function urlToGeminiInlineData(url: string) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`โหลดรูปจาก URL ไม่สำเร็จ: ${url}`);
  }

  const contentType = res.headers.get("content-type") || "image/jpeg";
  const arrayBuffer = await res.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");

  return {
    mimeType: contentType,
    data: base64,
  };
}

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

  return "ไม่สามารถสร้างคำตอบได้";
}

async function askOpenAI(body: ChatBody, prompt: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

  const content: any[] = [
    {
      type: "input_text",
      text: prompt,
    },
  ];

  if (isHttpUrl(body.images?.original)) {
    content.push({
      type: "input_image",
      image_url: body.images!.original,
      detail: "high",
    });
  }

  if (isHttpUrl(body.images?.heatmap)) {
    content.push({
      type: "input_image",
      image_url: body.images!.heatmap,
      detail: "high",
    });
  }

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: body.ai_model,
      input: [
        {
          role: "user",
          content,
        },
      ],
    }),
  });

  const raw = await res.text();

  if (!res.ok) {
    throw new Error(`OpenAI error ${res.status}: ${raw}`);
  }

  const data = JSON.parse(raw);
  return extractOpenAIText(data);
}

async function askGemini(body: ChatBody, prompt: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

  const parts: any[] = [{ text: prompt }];

  if (isHttpUrl(body.images?.original)) {
    const original = await urlToGeminiInlineData(body.images!.original!);
    parts.push({
      inline_data: original,
    });
  }

  if (isHttpUrl(body.images?.heatmap)) {
    const heatmap = await urlToGeminiInlineData(body.images!.heatmap!);
    parts.push({
      inline_data: heatmap,
    });
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${body.ai_model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
      }),
    }
  );

  const raw = await res.text();

  if (!res.ok) {
    throw new Error(`Gemini error ${res.status}: ${raw}`);
  }

  const data = JSON.parse(raw);
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "ไม่สามารถสร้างคำตอบได้";
}

async function askClaude(body: ChatBody, prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

  const client = new Anthropic({ apiKey });

  const content: Anthropic.MessageParam["content"] = [];

  if (isHttpUrl(body.images?.original)) {
    content.push({
      type: "image",
      source: { type: "url", url: body.images!.original! },
    });
  }

  if (isHttpUrl(body.images?.heatmap)) {
    content.push({
      type: "image",
      source: { type: "url", url: body.images!.heatmap! },
    });
  }

  content.push({ type: "text", text: prompt });

  const supportsThinking = body.ai_model.startsWith("claude-opus") || body.ai_model.startsWith("claude-sonnet");
  const stream = client.messages.stream({
    model: body.ai_model,
    max_tokens: supportsThinking ? 16000 : 8192,
    ...(supportsThinking ? { thinking: { type: "adaptive" } } : {}),
    messages: [{ role: "user", content }],
  });

  const msg = await stream.finalMessage();
  const textBlock = msg.content.find((b) => b.type === "text");
  return textBlock?.type === "text" ? textBlock.text : "ไม่สามารถสร้างคำตอบได้";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ChatBody;

    const prompt =
      body.mode === "vision"
        ? buildVisionPrompt(body)
        : buildExplanationPrompt(body);

    const answer =
      body.provider === "openai"
        ? await askOpenAI(body, prompt)
        : body.provider === "claude"
        ? await askClaude(body, prompt)
        : await askGemini(body, prompt);

    return NextResponse.json({ answer });
  } catch (error) {
    console.error("POST /api/chat error:", error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Chat failed",
      },
      { status: 500 }
    );
  }
}