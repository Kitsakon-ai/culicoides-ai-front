import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_AI_SYSTEM_PROMPT } from "@/lib/prompts";

export const runtime = "nodejs";
export const maxDuration = 60;

type Msg = {
  role: "user" | "assistant";
  content: string;
};

type ChatBody = {
  provider: "openai" | "gemini" | "claude";
  ai_model: string;
  mode?: "explanation" | "vision";
  message: string;
  systemPrompt?: string;
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
  const predContext = p
    ? `\n\nผล ML model: ทำนาย Culicoides ${p.species} (ความเชื่อมั่น ${(p.confidence * 100).toFixed(1)}%, สถานะ: ${p.confidenceLevel})${p.topK ? ` | topK: ${p.topK.map((x) => `${x.name} ${(x.probability * 100).toFixed(1)}%`).join(", ")}` : ""}`
    : "";

  const persona = body.systemPrompt?.trim() || DEFAULT_AI_SYSTEM_PROMPT;

  return `${persona}${predContext}`;
}

function buildImageGenTextPrompt(body: ChatBody): string {
  const p = body.prediction;
  const species = p ? `Culicoides ${p.species}` : "Culicoides";
  return `คุณเป็น AI ผู้ช่วยวิจัยแมลง Culicoides ผู้ใช้ขอสร้างภาพ: "${body.message}"
ระบบกำลังสร้างภาพ ${species} ให้อธิบายสั้น ๆ (2-3 ประโยค ภาษาไทย) ว่า:
- ภาพที่จะได้รับจะแสดงลักษณะอะไรของ ${species}
- ลักษณะสัณฐานวิทยาสำคัญที่ควรสังเกต
ห้ามบอกว่าสร้างรูปไม่ได้ เพราะระบบกำลังสร้างรูปให้อยู่แล้ว`;
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

// ---- Image generation ----

function isImageGenRequest(message: string): boolean {
  const lower = message.toLowerCase();
  return [
    "สร้างรูป", "วาดรูป", "สร้างภาพ", "วาดภาพ", "ทำรูป", "ออกแบบรูป", "เขียนรูป",
    "generate image", "create image", "generate picture", "create picture",
    "make image", "draw image", "draw me", "draw a ", "draw an ",
  ].some((k) => lower.includes(k));
}

async function buildDALLEPrompt(
  userMessage: string,
  apiKey: string,
  body: ChatBody,
): Promise<string> {
  const p = body.prediction;
  const speciesCtx = p
    ? `The current specimen is Culicoides ${p.species} (confidence ${(p.confidence * 100).toFixed(1)}%).`
    : "This is a Culicoides (biting midge) research application.";

  const systemPrompt = `You are a scientific image prompt engineer for a Culicoides (biting midge) entomology research application.
${speciesCtx}
Convert the user's request into a detailed English prompt for scientific image generation.
Rules:
- Always reference Culicoides (biting midge) specifically, never other insects
- Use scientific microscopy / macro photography style language
- Focus on wing morphology, venation, macrotrichia, patterns as relevant
- Keep the prompt under 400 characters
- Return ONLY the prompt, no explanation`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 200,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
      }),
    });
    if (!res.ok) return userMessage;
    const data = await res.json();
    return (data?.choices?.[0]?.message?.content as string) || userMessage;
  } catch {
    return userMessage;
  }
}

type ImageGenResult = { url: string | null; error?: string };

async function generateImageOpenAI(prompt: string, body: ChatBody): Promise<ImageGenResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { url: null, error: "Missing OPENAI_API_KEY" };
  try {
    const refined = await buildDALLEPrompt(prompt, apiKey, body);
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt: refined,
        n: 1,
        size: "1024x1024",
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error("OpenAI image gen error:", res.status, errText);
      return { url: null, error: `OpenAI image gen error ${res.status}: ${errText.slice(0, 300)}` };
    }
    const data = await res.json();
    // gpt-image-1 returns b64_json
    const b64 = data?.data?.[0]?.b64_json as string | undefined;
    if (b64) return { url: `data:image/png;base64,${b64}` };
    return { url: (data?.data?.[0]?.url as string) ?? null };
  } catch (e) {
    console.error("generateImageOpenAI exception:", e);
    return { url: null, error: e instanceof Error ? e.message : "Unknown OpenAI image gen error" };
  }
}

async function generateImageGemini(prompt: string): Promise<ImageGenResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { url: null, error: "Missing GEMINI_API_KEY" };
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
        }),
      }
    );
    if (!res.ok) {
      const errText = await res.text();
      console.error("Gemini image gen error:", res.status, errText);
      return { url: null, error: `Gemini image gen error ${res.status}: ${errText.slice(0, 300)}` };
    }
    const data = await res.json();
    const parts: { inlineData?: { mimeType: string; data: string } }[] =
      data?.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        return { url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` };
      }
    }
    return { url: null, error: "Gemini returned no image data" };
  } catch (e) {
    console.error("generateImageGemini exception:", e);
    return { url: null, error: e instanceof Error ? e.message : "Unknown Gemini image gen error" };
  }
}

async function generateImage(provider: string, prompt: string, body: ChatBody): Promise<ImageGenResult> {
  if (provider === "gemini") {
    const result = await generateImageGemini(prompt);
    if (result.url) return result;
  }
  return generateImageOpenAI(prompt, body);
}

// ---- Main handler ----

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ChatBody;

    const isImgGen = isImageGenRequest(body.message);

    const prompt = isImgGen
      ? buildImageGenTextPrompt(body)
      : body.mode === "vision"
      ? buildVisionPrompt(body)
      : buildExplanationPrompt(body);

    const [answer, imageResult] = await Promise.all([
      body.provider === "openai"
        ? askOpenAI(body, prompt)
        : body.provider === "claude"
        ? askClaude(body, prompt)
        : askGemini(body, prompt),
      isImgGen ? generateImage(body.provider, body.message, body) : Promise.resolve(null),
    ]);

    return NextResponse.json({
      answer,
      imageUrl: imageResult?.url ?? undefined,
      imageError: imageResult?.error,
    });
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