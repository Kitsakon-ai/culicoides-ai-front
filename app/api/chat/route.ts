import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_AI_SYSTEM_PROMPT } from "@/lib/prompts";
import {
  getSpeciesFacts,
  searchDocuments,
  searchDocumentsForSpecies,
  buildKnowledgeContext,
  hasDocuments,
  type DocMatch,
} from "@/lib/knowledge";
import { embedText } from "@/lib/embeddings";

export const runtime = "nodejs";
// Streamed responses can run long (esp. explanation mode w/ large max_tokens).
// Vercel Pro (Fluid Compute) — up to 300s.
export const maxDuration = 300;

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

// ถามถึง "ภาพ/ตัวอย่างที่วิเคราะห์อยู่" จริง ๆ ไหม — ถ้าใช่ค่อยแนบรูปให้โมเดลดู
// (ถ้าเป็นคำถามความรู้ทั่วไป ไม่ต้องแนบรูป จะได้ไม่ติดอยู่กับการบรรยายภาพ)
function messageRefersToImage(message: string): boolean {
  const m = (message || "").toLowerCase();
  const cues = [
    "ในรูป", "ในภาพ", "จากรูป", "จากภาพ", "ดูรูป", "ดูภาพ", "รูปนี้", "ภาพนี้", "รูปที่", "ภาพที่",
    "ตัวนี้", "อันนี้", "ตัวอย่างนี้", "ที่เห็นในภาพ", "สีแดง", "ที่เน้น", "บริเวณที่",
    "heatmap", "gradcam", "grad-cam", "grad cam",
    "this image", "this photo", "this picture", "the image", "this specimen",
    "this sample", "this wing", "highlighted", "this one",
  ];
  return cues.some((c) => m.includes(c));
}

// วิธีสั่งให้ AI ยึดข้อมูลจากฐานข้อมูล (structured facts + RAG) เป็นแหล่งหลักก่อนเสมอ
// ถ้าไม่มีในฐานข้อมูล ค่อยเสริมด้วยงานวิจัยที่เกี่ยวข้องย้อนหลังไม่เกิน 5 ปี
const GROUNDING = `สำคัญ — วิธีใช้ข้อมูลตอบ:
- ใช้ [ข้อมูลจากฐานข้อมูล] และ [ข้อความจากงานวิจัย] ด้านล่างเป็นแหล่งหลักในการตอบก่อนเสมอ
- ถ้าข้อมูลด้านล่างไม่ครอบคลุมคำถาม ให้เสริมด้วยงานวิจัยที่เกี่ยวข้องย้อนหลังไม่เกิน 5 ปี และระบุให้ชัดว่าเป็นข้อมูลความรู้ทั่วไป/งานวิจัยล่าสุด ไม่ใช่จากฐานข้อมูลของระบบ
- ห้ามกุรายชื่อจังหวัดหรือข้อเท็จจริงที่ไม่มีใน [ข้อมูลจากฐานข้อมูล]`;

function buildExplanationPrompt(body: ChatBody, knowledge: string) {
  const p = body.prediction;
  const predContext = p
    ? `\n\nผล ML model: ทำนาย Culicoides ${p.species} (ความเชื่อมั่น ${(p.confidence * 100).toFixed(1)}%, สถานะ: ${p.confidenceLevel})${p.topK ? ` | topK: ${p.topK.map((x) => `${x.name} ${(x.probability * 100).toFixed(1)}%`).join(", ")}` : ""}`
    : "";

  const persona = body.systemPrompt?.trim() || DEFAULT_AI_SYSTEM_PROMPT;
  const knowledgeBlock = knowledge ? `\n\n${GROUNDING}\n\n${knowledge}` : "";

  return `${persona}${predContext}${knowledgeBlock}`;
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

function buildVisionPrompt(body: ChatBody, knowledge: string, hasImage: boolean) {
  const historyText =
    body.history?.map((m) => `${m.role === "user" ? "ผู้ใช้" : "ผู้ช่วย"}: ${m.content}`).join("\n") ||
    "ยังไม่มีประวัติการสนทนา";

  const p = body.prediction;
  const predLine = p
    ? `ผลทำนายปัจจุบัน: Culicoides ${p.species} (ความเชื่อมั่น ${(p.confidence * 100).toFixed(1)}%, สถานะ ${p.confidenceLevel})${p.topK ? ` | top-k: ${p.topK.map((x) => `${x.name} ${(x.probability * 100).toFixed(1)}%`).join(", ")}` : ""}`
    : "ยังไม่มีผลทำนายในระบบตอนนี้";

  const imageLine = hasImage
    ? `มีภาพปีก${isHttpUrl(body.images?.heatmap) ? " + ภาพ Grad-CAM" : ""} แนบมาให้ในคำถามนี้ (Grad-CAM เน้น: ${(body.xai?.highlightedRegions ?? []).join(", ") || "-"}) ตอบเรื่องภาพนี้ได้`
    : "คำถามนี้ไม่ได้แนบภาพ — ตอบจากผลทำนายและฐานความรู้ อย่าบรรยายรายละเอียดจากภาพที่มองไม่เห็น และอย่าบอกว่ามองภาพไม่ได้ ให้ตอบเนื้อหาที่ถามตามปกติ";

  const knowledgeBlock = knowledge ? `\n\n${GROUNDING}\n\n${knowledge}` : "";

  return `คุณคือ "CulicoidesAI Assistant" ผู้ช่วยของระบบ AI จำแนกริ้น Culicoides จากภาพปีก ตอบเป็นภาษาไทย กระชับ ถูกต้องเชิงวิชาการ เหมาะกับนิสิต/นักวิจัย

หน้าที่หลัก — ช่วยเรื่อง:
- การจำแนกชนิด Culicoides, ลักษณะสัณฐาน/ลายปีก, การแปลผลทำนายและความเชื่อมั่น
- โรคที่นำโดยพาหะ (vector-borne diseases), กีฏวิทยา, ชีววิทยา/นิเวศ
- Deep Learning, Computer Vision, Explainable AI (Grad-CAM), การจำแนกภาพ, คุณภาพภาพ, การเตรียม dataset

ขอบเขตการตอบ:
- คำถามความรู้ทั่วไปที่โยงกับงานของระบบได้ (เช่น "CNN คืออะไร", "Python คืออะไร", "embedding คืออะไร", "overfitting คืออะไร") ให้ตอบได้ แล้วโยงกลับสั้น ๆ ว่าเกี่ยวข้องกับระบบนี้อย่างไร (เช่น CNN คือโมเดลที่ระบบใช้จำแนกภาพปีก Culicoides)
- คำถามนอกขอบเขตโดยสิ้นเชิง (กีฬา, ดารา/บันเทิง, การเมือง, ดูดวง, เรื่องส่วนตัว ฯลฯ) ให้ปฏิเสธอย่างสุภาพสั้น ๆ แล้วเบนกลับว่า ระบบนี้เชี่ยวชาญ Culicoides / กีฏวิทยา / โรคจากพาหะ / AI วิเคราะห์ภาพ และชวนให้ถามเรื่องที่เกี่ยวข้อง — ห้ามแต่งคำตอบให้เรื่องนอกขอบเขต

การใช้ข้อมูลและความซื่อสัตย์:
- ถ้ามี [ข้อมูลจากฐานข้อมูล] / [ข้อความจากงานวิจัย] ด้านล่าง ให้ยึดเป็นแหล่งหลักในการตอบก่อนเสมอ
- ถ้าคำตอบไม่มีในข้อมูลด้านล่าง ให้บอกชัดว่า "ไม่พบในฐานข้อมูลของระบบ" ก่อน แล้วจึงเสริมด้วยความรู้ทั่วไป/งานวิจัยย้อนหลังไม่เกิน 5 ปี (ระบุว่าเป็นความรู้ทั่วไป)
- ห้ามกุข้อเท็จจริง/ตัวเลข/ชื่อจังหวัด/ผลการทดลอง ถ้าไม่แน่ใจให้บอกตรง ๆ ว่าไม่แน่ใจ

บริบทปัจจุบัน:
${predLine}
${imageLine}

ประวัติการสนทนา:
${historyText}

คำถามผู้ใช้: ${body.message}${knowledgeBlock}`;
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

// ---- Provider request bodies (shared by streaming + image-gen collect) ----

function buildOpenAIUserContent(prompt: string, body: ChatBody) {
  const content: any[] = [{ type: "input_text", text: prompt }];
  if (isHttpUrl(body.images?.original)) {
    content.push({ type: "input_image", image_url: body.images!.original, detail: "high" });
  }
  if (isHttpUrl(body.images?.heatmap)) {
    content.push({ type: "input_image", image_url: body.images!.heatmap, detail: "high" });
  }
  return content;
}

function buildClaudeContent(prompt: string, body: ChatBody): Anthropic.MessageParam["content"] {
  const content: Anthropic.MessageParam["content"] = [];
  if (isHttpUrl(body.images?.original)) {
    content.push({ type: "image", source: { type: "url", url: body.images!.original! } });
  }
  if (isHttpUrl(body.images?.heatmap)) {
    content.push({ type: "image", source: { type: "url", url: body.images!.heatmap! } });
  }
  content.push({ type: "text", text: prompt });
  return content;
}

async function buildGeminiParts(prompt: string, body: ChatBody) {
  const parts: any[] = [{ text: prompt }];
  if (isHttpUrl(body.images?.original)) {
    parts.push({ inline_data: await urlToGeminiInlineData(body.images!.original!) });
  }
  if (isHttpUrl(body.images?.heatmap)) {
    parts.push({ inline_data: await urlToGeminiInlineData(body.images!.heatmap!) });
  }
  return parts;
}

// ---- SSE parsing (OpenAI + Gemini share the `data: {json}\n\n` framing) ----

async function* parseSSE(
  body: ReadableStream<Uint8Array>,
  pickText: (data: any) => string | null
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);

        for (const line of rawEvent.split("\n")) {
          const trimmed = line.trimStart();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;

          let json: any;
          try {
            json = JSON.parse(payload);
          } catch {
            continue;
          }

          const text = pickText(json);
          if (text) yield text;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ---- Streaming providers (yield text deltas) ----

async function* streamOpenAI(body: ChatBody, prompt: string): AsyncGenerator<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: body.ai_model,
      stream: true,
      input: [{ role: "user", content: buildOpenAIUserContent(prompt, body) }],
    }),
  });

  if (!res.ok || !res.body) {
    throw new Error(`OpenAI error ${res.status}: ${await res.text().catch(() => "")}`);
  }

  yield* parseSSE(res.body, (d) =>
    d?.type === "response.output_text.delta" && typeof d.delta === "string" ? d.delta : null
  );
}

async function* streamGemini(body: ChatBody, prompt: string): AsyncGenerator<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

  const parts = await buildGeminiParts(prompt, body);

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${body.ai_model}:streamGenerateContent?alt=sse&key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts }] }),
    }
  );

  if (!res.ok || !res.body) {
    // ไม่สลับโมเดลแทนให้อัตโนมัติ — ผู้ใช้ต้องรู้ว่าโมเดลที่เลือกไว้มีปัญหาอะไร
    if (res.status === 503 || res.status === 429) {
      throw new Error(
        `${body.ai_model} คิวเต็มชั่วคราวฝั่ง Google (${res.status}) — รอสักครู่แล้วลองใหม่ หรือเปลี่ยนโมเดลจากเมนู`
      );
    }
    throw new Error(`Gemini error ${res.status}: ${await res.text().catch(() => "")}`);
  }

  yield* parseSSE(res.body, (d) => d?.candidates?.[0]?.content?.parts?.[0]?.text ?? null);
}

// Anthropic's automated safety classifiers can refuse a request per-model
// (stop_reason: "refusal") even when the content is benign — Opus refuses this
// app's tropical-disease-vector persona while Sonnet/Haiku answer it. On a
// refusal (which emits no text) we retry with the next model down.
const CLAUDE_FALLBACK_MODEL: Record<string, string> = {
  "claude-opus-4-8": "claude-sonnet-4-6",
  "claude-sonnet-4-6": "claude-haiku-4-5",
};

async function* streamClaude(body: ChatBody, prompt: string): AsyncGenerator<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

  const client = new Anthropic({ apiKey });
  const content = buildClaudeContent(prompt, body);
  const original = body.ai_model;
  let model = body.ai_model;

  // Walk the fallback chain (opus -> sonnet -> haiku) on refusals. A refusal
  // emits no text, so nothing has been streamed yet when we switch.
  while (true) {
    const supportsLargerBudget = model.startsWith("claude-opus") || model.startsWith("claude-sonnet");
    const stream = client.messages.stream({
      model,
      max_tokens: supportsLargerBudget ? 16000 : 8192,
      messages: [{ role: "user", content }],
    });

    let emitted = false;
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        if (!emitted && model !== original) {
          yield `_(หมายเหตุ: ${original} ปฏิเสธคำขอนี้ ระบบจึงใช้ ${model} ตอบแทน)_\n\n`;
        }
        emitted = true;
        yield event.delta.text;
      }
    }

    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal" && !emitted) {
      const fallback = CLAUDE_FALLBACK_MODEL[model];
      console.error(
        "streamClaude: refusal, falling back",
        JSON.stringify({ model, category: (final.stop_details as any)?.category, fallback }, null, 2)
      );
      if (fallback) {
        model = fallback;
        continue;
      }
    }

    if (!emitted) {
      yield `ไม่สามารถสร้างคำตอบได้ (stop_reason: ${final.stop_reason ?? "unknown"})`;
    }
    return;
  }
}

function pickStream(body: ChatBody, prompt: string): AsyncGenerator<string> {
  if (body.provider === "openai") return streamOpenAI(body, prompt);
  if (body.provider === "claude") return streamClaude(body, prompt);
  return streamGemini(body, prompt);
}

async function collectStream(gen: AsyncGenerator<string>): Promise<string> {
  let out = "";
  for await (const chunk of gen) out += chunk;
  return out;
}

// ---- Image generation (single URL result — not streamable) ----

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
        model: "gpt-image-2",
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
    // gpt-image-2 returns b64_json
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
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent?key=${apiKey}`,
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

// ---- Knowledge base (Supabase): structured facts + RAG ----
// ดึงข้อมูลชนิดจากตาราง + ค้นย่อหน้างานวิจัยด้วย semantic search แล้วประกอบเป็น context
// resilient: ถ้ายังไม่ได้รัน migration หรือ DB/embedding ล่ม จะคืน "" (แชตยังทำงานปกติ)
async function getKnowledgeContext(body: ChatBody): Promise<string> {
  const speciesName = body.prediction?.species;
  if (!speciesName) return "";
  try {
    const facts = await getSpeciesFacts(speciesName);
    let docs: DocMatch[] = [];
    // ยิง embedding เฉพาะเมื่อมี documents อยู่จริง — เลี่ยงเรียกฟรีก่อน import ข้อมูล
    if (await hasDocuments()) {
      try {
        const emb = await embedText(body.message?.trim() || speciesName);
        const sinceYear = new Date().getFullYear() - 5; // งานวิจัยย้อนหลังไม่เกิน 5 ปี
        // 1) เอกสารที่ "พูดถึงชนิดนี้จริง" ก่อน (แม่นสุด, ในกรอบ 5 ปี)
        if (facts.speciesId) {
          docs = await searchDocumentsForSpecies(emb, facts.speciesId, { limit: 6, sinceYear });
        }
        // 2) ถ้าได้น้อย เติมด้วย global (ยังในกรอบ 5 ปี) แบบไม่ซ้ำ
        if (docs.length < 4) {
          const global = await searchDocuments(emb, { limit: 6, sinceYear });
          const seen = new Set(docs.map((d) => d.content));
          for (const g of global) {
            if (seen.has(g.content)) continue;
            docs.push(g);
            if (docs.length >= 6) break;
          }
        }
      } catch (err) {
        console.error("getKnowledgeContext: RAG embed/search failed:", err);
      }
    }
    return buildKnowledgeContext(facts, docs);
  } catch (err) {
    console.error("getKnowledgeContext failed:", err);
    return "";
  }
}

// ---- Main handler ----

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ChatBody;

    // Image generation returns a URL (not streamable) → keep the JSON contract.
    if (isImageGenRequest(body.message)) {
      const prompt = buildImageGenTextPrompt(body);
      const [answer, imageResult] = await Promise.all([
        collectStream(pickStream(body, prompt)),
        generateImage(body.provider, body.message, body),
      ]);
      return NextResponse.json({
        answer,
        imageUrl: imageResult?.url ?? undefined,
        imageError: imageResult?.error,
      });
    }

    // ดึง context จาก knowledge base (facts + RAG) ก่อนสร้าง prompt
    const knowledge = await getKnowledgeContext(body);
    // แนบรูปเฉพาะโหมด explanation (วิเคราะห์ภาพ) หรือเมื่อผู้ใช้ถามถึงรูป/ตัวอย่างนี้จริง ๆ
    // คำถามความรู้ทั่วไปในขอบเขต → ไม่แนบรูป จะได้ไม่ติดอยู่กับการบรรยายภาพ
    const attachImages = body.mode !== "vision" || messageRefersToImage(body.message);
    const prompt = body.mode === "vision"
      ? buildVisionPrompt(body, knowledge, attachImages)
      : buildExplanationPrompt(body, knowledge);
    const streamBody = attachImages ? body : { ...body, images: undefined };
    const gen = pickStream(streamBody, prompt);

    // Prime the first chunk so provider setup errors (missing key, quota/429,
    // refusal with no fallback) surface as a JSON 500 the client can toast —
    // instead of a 200 stream that silently contains the error text.
    let first: IteratorResult<string>;
    try {
      first = await gen.next();
    } catch (err) {
      console.error("POST /api/chat stream init error:", err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Chat failed" },
        { status: 500 }
      );
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          if (!first.done && first.value) controller.enqueue(encoder.encode(first.value));
          for await (const chunk of gen) controller.enqueue(encoder.encode(chunk));
        } catch (err) {
          // Already responded 200 + started streaming — can't change status now,
          // so append a visible marker instead of failing silently.
          console.error("POST /api/chat stream error:", err);
          const msg = err instanceof Error ? err.message : "stream error";
          controller.enqueue(encoder.encode(`\n\n⚠️ ${msg}`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    console.error("POST /api/chat error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Chat failed" },
      { status: 500 }
    );
  }
}
