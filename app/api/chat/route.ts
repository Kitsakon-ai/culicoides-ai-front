import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { Lang } from "@/lib/i18n";
import { getDefaultSystemPrompt } from "@/lib/prompts";
import { PROMPT_PACK, resolveLang } from "@/lib/chat-prompts";
import {
  getSpeciesFacts,
  searchDocuments,
  searchDocumentsForSpecies,
  buildKnowledgeContext,
  hasDocuments,
  getWingFeatures,
  getProvincesForSpecies,
  type DocMatch,
  type WingFeature,
} from "@/lib/knowledge";
import { embedText } from "@/lib/embeddings";
import { createTimer } from "@/lib/server-timing";

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
  // ภาษาที่ผู้ใช้เลือกใน UI — กำหนดภาษาของ prompt ทั้งก้อน (ไม่ส่งมา = ไทย)
  lang?: Lang;
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

// ข้อความ prompt ทุกก้อนอยู่ใน lib/chat-prompts.ts (แยกตามภาษา)
// ที่นี่เหลือเฉพาะการประกอบร่างจากผลทำนาย + knowledge context
const topKText = (topK?: { name: string; probability: number }[]) =>
  topK?.map((x) => `${x.name} ${(x.probability * 100).toFixed(1)}%`).join(", ") ?? "";

function buildExplanationPrompt(body: ChatBody, knowledge: string, wingFeatures: WingFeature[]) {
  const lang = resolveLang(body.lang);
  const L = PROMPT_PACK[lang];
  const p = body.prediction;

  const predContext = p
    ? `\n\n${L.explanation.mlResult(p.species, (p.confidence * 100).toFixed(1), p.confidenceLevel, topKText(p.topK))}`
    : "";

  const persona = body.systemPrompt?.trim() || getDefaultSystemPrompt(lang);
  const knowledgeBlock = knowledge ? `\n\n${L.grounding}\n\n${knowledge}` : "";

  // ป้ายบนลูกศรมาจาก getWingFeatures() ตัวเดียวกับที่ /api/annotate ใช้วาดภาพ
  // ส่งเข้า prompt ด้วยเพื่อให้คำอธิบายกับลูกศรในภาพพูดถึงจุดเดียวกันเสมอ
  const featureList = wingFeatures
    .filter((f) => f.nameEn)
    .map((f) => `- ${f.nameEn}${f.nameTh ? ` (${f.nameTh})` : ""}${f.description ? `: ${f.description}` : ""}`)
    .join("\n");
  const annotatedBlock = featureList ? `\n\n${L.explanation.annotatedFeatures(featureList)}` : "";

  return `${persona}${predContext}\n\n${L.vectorDanger}${annotatedBlock}${knowledgeBlock}\n\n${L.explanation.style}`;
}

function buildImageGenTextPrompt(body: ChatBody): string {
  const L = PROMPT_PACK[resolveLang(body.lang)];
  const p = body.prediction;
  const species = p ? `Culicoides ${p.species}` : "Culicoides";
  return L.imageGen(species, body.message);
}

// ---- Distribution map (แผนที่จริงเรนเดอร์ฝั่ง client ไม่ใช่ ASCII จาก LLM) ----

// ผู้ใช้ขอ "ดูแผนที่" หรือถามว่า "พบที่จังหวัดไหน" → ตอบพร้อมข้อมูลให้ client วาดแผนที่
const TH_MAP_WORDS = [
  "แผนที่", "พบที่ไหน", "พบที่จังหวัด", "จังหวัดไหน", "พบในจังหวัด",
  "การกระจายตัว", "กระจายตัว", "แพร่กระจาย", "เจอที่ไหน",
];
const EN_MAP = /\b(?:map|distribution|range|which\s+provinces?|what\s+provinces?|where\s+(?:is|are|was|were|has|have|it|they|this)\b[^.?!]{0,30}?found|found\s+in\s+(?:which|what))\b/;

function isMapRequest(message: string): boolean {
  const lower = (message || "").toLowerCase();
  if (TH_MAP_WORDS.some((k) => lower.includes(k))) return true;
  return EN_MAP.test(lower);
}

function buildMapTextPrompt(body: ChatBody, provinces: string[]): string {
  const L = PROMPT_PACK[resolveLang(body.lang)];
  const p = body.prediction;
  const species = p ? `Culicoides ${p.species}` : "Culicoides";
  const list = provinces.length
    ? provinces.join(", ")
    : resolveLang(body.lang) === "en"
    ? "(no province records in the database for this species)"
    : "(ยังไม่มีรายงานจังหวัดของชนิดนี้ในฐานข้อมูล)";
  return L.mapAnswer(species, list);
}

function buildVisionPrompt(body: ChatBody, knowledge: string, hasImage: boolean) {
  const L = PROMPT_PACK[resolveLang(body.lang)].vision;
  const grounding = PROMPT_PACK[resolveLang(body.lang)].grounding;

  const historyText =
    body.history
      ?.map((m) => `${m.role === "user" ? L.user : L.assistant}: ${m.content}`)
      .join("\n") || L.noHistory;

  const p = body.prediction;
  const predLine = p
    ? L.prediction(p.species, (p.confidence * 100).toFixed(1), p.confidenceLevel, topKText(p.topK))
    : L.noPrediction;

  const imageLine = hasImage
    ? L.imageAttached(
        isHttpUrl(body.images?.heatmap),
        (body.xai?.highlightedRegions ?? []).join(", ")
      )
    : L.imageMissing;

  const knowledgeBlock = knowledge ? `\n\n${grounding}\n\n${knowledge}` : "";

  return `${L.persona}

${L.contextHeading}
${predLine}
${imageLine}

${L.historyHeading}
${historyText}

${L.questionHeading} ${body.message}${knowledgeBlock}`;
}

async function urlToGeminiInlineData(url: string, lang: Lang) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(PROMPT_PACK[lang].notice.imageFetchFailed(url));
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
  const lang = resolveLang(body.lang);
  const parts: any[] = [{ text: prompt }];
  if (isHttpUrl(body.images?.original)) {
    parts.push({ inline_data: await urlToGeminiInlineData(body.images!.original!, lang) });
  }
  if (isHttpUrl(body.images?.heatmap)) {
    parts.push({ inline_data: await urlToGeminiInlineData(body.images!.heatmap!, lang) });
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

      // OpenAI คั่น event ด้วย "\n\n" แต่ Google ใช้ "\r\n\r\n" (ทดสอบยิงจริงยืนยันแล้ว)
      // ถ้าไม่ normalize CRLF ก่อน จะหา event ของ Gemini ไม่เจอเลยสักอัน → stream ว่างเปล่า
      // ปลอดภัยกับเนื้อหา เพราะ JSON escape ขึ้นบรรทัดใหม่เป็น \\n อยู่แล้ว ไบต์ CR/LF จริงไม่โผล่ในสตริง
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

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
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          // ให้งบเท่าฝั่ง Claude (16000) — เดิมไม่ตั้งเลย ปล่อยตาม default ของ Google
          // คำอธิบายที่สั่งให้ไล่ทุก feature + หัวข้อย่อย ยาวเกิน default ได้ง่าย
          maxOutputTokens: 16000,
          // Gemini 3.x เปิด thinking เป็น medium โดยปริยาย และ thought token คิดเงินเท่า output
          // วัดจริงแล้ว: ไม่ตั้ง = คิด 579 tok ต่อคำตอบ 116 tok / ตั้ง low = 498 tok แต่ตอบยาวกว่า
          // (thinkingBudget เป็นของรุ่น 2.x — ยิงกับ 3.x แล้วได้ 400)
          thinkingConfig: { thinkingLevel: "low" },
        },
      }),
    }
  );

  if (!res.ok || !res.body) {
    // ไม่สลับโมเดลแทนให้อัตโนมัติ — ผู้ใช้ต้องรู้ว่าโมเดลที่เลือกไว้มีปัญหาอะไร
    if (res.status === 503 || res.status === 429) {
      throw new Error(
        PROMPT_PACK[resolveLang(body.lang)].notice.geminiBusy(body.ai_model, res.status)
      );
    }
    throw new Error(`Gemini error ${res.status}: ${await res.text().catch(() => "")}`);
  }

  // เดิมอ่านแค่ parts[0].text — ถ้า Gemini ส่ง thought part มาก่อน คำตอบจริงที่อยู่ part ถัด ๆ ไป
  // จะหายทั้งก้อนแบบเงียบ ๆ (ไม่มี error) → รวมทุก part ที่ไม่ใช่ thought แทน
  yield* parseSSE(res.body, (d) => {
    const parts = d?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return null;
    const text = parts
      .filter((p: any) => !p?.thought)
      .map((p: any) => p?.text)
      .filter((t: unknown): t is string => typeof t === "string" && t.length > 0)
      .join("");
    return text || null;
  });
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
  const notice = PROMPT_PACK[resolveLang(body.lang)].notice;
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
          yield notice.claudeFallback(original, model);
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
      yield notice.noAnswer(final.stop_reason ?? "unknown");
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

// ภาษาไทยไม่มี article → เทียบคำตรง ๆ พอ
const TH_IMAGE_GEN_WORDS = [
  "สร้างรูป", "วาดรูป", "สร้างภาพ", "วาดภาพ", "ทำรูป", "ทำภาพ",
  "ออกแบบรูป", "เขียนรูป", "ขอรูป", "ขอภาพ",
];

const IMAGE_NOUN =
  "(?:image|picture|pic|photo|photograph|illustration|diagram|drawing|sketch|figure|visual|view|rendering|visuali[sz]ation|graphic|artwork)s?";

// ภาษาอังกฤษเทียบ substring ตรง ๆ ไม่ได้ เพราะ article คั่นกลาง —
// "generate an image" ไม่มี substring "generate image" อยู่ในนั้น
const EN_IMAGE_GEN = new RegExp(
  `\\b(?:generate|create|make|produce|render|design)\\b[^.?!]{0,24}?\\b${IMAGE_NOUN}\\b`
);

// ขอแบบไม่ใช้ verb สร้าง ("I'd like a rendered image of the wing")
const EN_WANT_IMAGE = new RegExp(
  `\\b(?:i want|i'd like|i would like|i need|can i get|could i get|can you give me)\\b[^.?!]{0,24}?\\b${IMAGE_NOUN}\\b`
);

// "show/give me a picture" — บังคับ article ไม่ชี้เฉพาะ กัน "show me the image"
// ที่หมายถึงภาพตัวอย่างที่แสดงอยู่แล้ว ไม่ใช่ขอให้สร้างใหม่
const EN_SHOW_ME_IMAGE = new RegExp(
  `\\b(?:show|give)\\s+me\\s+(?:an?|another|some)\\s+[^.?!]{0,16}?${IMAGE_NOUN}\\b`
);

// verb ที่แปลว่า "วาด" ตรงตัว → เป็นคำขอรูปแม้ไม่มีคำว่า image ตามหลัง ("draw the wing")
// ยกเว้นสำนวนที่ไม่ได้หมายถึงการวาดจริง ("draw a conclusion")
const EN_DRAW_VERB =
  /\b(?:draw|sketch|illustrate)s?\b(?!\s+(?:an?\s+|the\s+)?(?:conclusion|comparison|parallel|distinction|analogy|inference))/;

function isImageGenRequest(message: string): boolean {
  const lower = (message || "").toLowerCase();
  if (TH_IMAGE_GEN_WORDS.some((k) => lower.includes(k))) return true;
  return (
    EN_IMAGE_GEN.test(lower) ||
    EN_WANT_IMAGE.test(lower) ||
    EN_SHOW_ME_IMAGE.test(lower) ||
    EN_DRAW_VERB.test(lower)
  );
}

// prompt ที่การันตีว่าพูดถึงปีก Culicoides เสมอ ไม่ต้องพึ่ง LLM ช่วยเรียบเรียง
// จำเป็นเพราะข้อความผู้ใช้อย่าง "Draw a labelled wing diagram" ไม่มีคำว่าแมลงเลย
// ถ้าส่งดิบ ๆ โมเดลภาพจะเดาเป็น "ปีกนก" (เจอจริงมาแล้ว)
function groundedImagePrompt(body: ChatBody): string {
  const p = body.prediction;
  const species = p ? `Culicoides ${p.species}` : "Culicoides";
  return `Scientific microscopy-style illustration of the WING of ${species} — a biting midge (Diptera: Ceratopogonidae), a tiny fly 1-3 mm long.
This is an INSECT wing: one transparent membranous wing with dark chitinous wing veins, pale and dark spot patterns on the membrane, and fine hairs (macrotrichia) on the surface and margin.
It is NOT a bird wing: no feathers, no bones, no primaries or coverts.
User request: ${body.message}`;
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
    // ล้มเหลวก็ต้องไม่ตกกลับไปใช้ข้อความดิบ ไม่งั้นได้ปีกนกเหมือนเดิม
    if (!res.ok) return groundedImagePrompt(body);
    const data = await res.json();
    return (data?.choices?.[0]?.message?.content as string) || groundedImagePrompt(body);
  } catch {
    return groundedImagePrompt(body);
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
  // เลือก Gemini ไว้ → ใช้โมเดลภาพของ Gemini เท่านั้น พังก็รายงานตรง ๆ
  // (เดิม fallback ไป gpt-image เงียบ ๆ ทำให้ผู้ใช้เข้าใจผิดว่ารูปมาจาก Gemini)
  // เดิมส่ง body.message ดิบเข้าไป ไม่มีบริบทว่าเป็นแมลง → ได้ปีกนกกลับมา
  if (provider === "gemini") return generateImageGemini(groundedImagePrompt(body));
  // Claude ไม่มีโมเดลสร้างภาพ → ใช้ของ OpenAI ตามเดิม (มี buildDALLEPrompt ใส่บริบทให้)
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
  const t = createTimer();
  try {
    const body = (await req.json()) as ChatBody;

    // Image generation returns a URL (not streamable) → keep the JSON contract.
    if (isImageGenRequest(body.message)) {
      const prompt = buildImageGenTextPrompt(body);
      const [answer, imageResult] = await Promise.all([
        collectStream(pickStream(body, prompt)),
        generateImage(body.provider, body.message, body),
      ]);
      t.mark("text+image");
      t.log("/api/chat (imagegen)");
      return NextResponse.json({
        answer,
        imageUrl: imageResult?.url ?? undefined,
        imageError: imageResult?.error,
      }, { headers: { "Server-Timing": t.header() } });
    }

    // ขอดูแผนที่การกระจายตัว → ส่งรายชื่อจังหวัด "จากฐานข้อมูล" กลับไปให้ client
    // เรนเดอร์ <ThailandMap> ของจริง (LLM เขียนแค่คำบรรยาย ไม่ให้วาดแผนที่เอง)
    const species = body.prediction?.species;
    if (species && body.mode === "vision" && isMapRequest(body.message)) {
      const provinces = await getProvincesForSpecies(species);
      t.mark("db-provinces");
      const answer = await collectStream(pickStream(body, buildMapTextPrompt(body, provinces)));
      t.mark("llm-caption");
      t.log(`/api/chat (map, ${provinces.length} provinces)`);
      return NextResponse.json(
        { answer, mapProvinces: provinces },
        { headers: { "Server-Timing": t.header() } }
      );
    }

    // ดึง context จาก knowledge base (facts + RAG) ก่อนสร้าง prompt
    // โหมด explanation ดึงชุดลักษณะปีกมาด้วย (ชุดเดียวกับที่ /api/annotate เอาไปวาดป้ายบนลูกศร)
    const isExplanation = body.mode !== "vision";
    const [knowledge, wingFeatures] = await Promise.all([
      getKnowledgeContext(body),
      isExplanation ? getWingFeatures(body.prediction?.species) : Promise.resolve([]),
    ]);
    t.mark("knowledge+rag");
    // แนบรูปเฉพาะโหมด explanation (วิเคราะห์ภาพ) หรือเมื่อผู้ใช้ถามถึงรูป/ตัวอย่างนี้จริง ๆ
    // คำถามความรู้ทั่วไปในขอบเขต → ไม่แนบรูป จะได้ไม่ติดอยู่กับการบรรยายภาพ
    const attachImages = body.mode !== "vision" || messageRefersToImage(body.message);
    const prompt = body.mode === "vision"
      ? buildVisionPrompt(body, knowledge, attachImages)
      : buildExplanationPrompt(body, knowledge, wingFeatures);
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

    // token แรกจากผู้ให้บริการ = เวลาที่ LLM ใช้ "คิด" ก่อนพ่นคำแรก
    t.mark("llm-first-token");

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let chars = 0;
        try {
          if (!first.done && first.value) {
            chars += first.value.length;
            controller.enqueue(encoder.encode(first.value));
          }
          for await (const chunk of gen) {
            chars += chunk.length;
            controller.enqueue(encoder.encode(chunk));
          }
        } catch (err) {
          // Already responded 200 + started streaming — can't change status now,
          // so append a visible marker instead of failing silently.
          console.error("POST /api/chat stream error:", err);
          const msg = err instanceof Error ? err.message : "stream error";
          controller.enqueue(encoder.encode(`\n\n⚠️ ${msg}`));
        } finally {
          controller.close();
          // header ส่งไปตั้งแต่ก่อน stream แล้ว → เวลารวมของการ stream log ได้ที่นี่อย่างเดียว
          t.mark("stream");
          t.log(`/api/chat (${body.mode ?? "explanation"}, ${body.ai_model}, ${chars} chars)`);
        }
      },
    });

    // header ต้องถูกส่งก่อนเริ่ม stream → มีได้แค่เฟสก่อนหน้า (knowledge + คิดจนได้ token แรก)
    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "Server-Timing": t.header(),
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
