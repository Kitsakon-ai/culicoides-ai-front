import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { getWingFeatures, type WingFeature } from "@/lib/knowledge";
import { landmarkByName } from "@/lib/wing-landmarks";
import { detectLabelBoxes } from "@/lib/label-boxes";
import { loadAndCropWing } from "@/lib/wing-crop";
import { createTimer } from "@/lib/server-timing";

export const runtime = "nodejs";
// Vercel Pro (Fluid Compute) รองรับถึง 300s — gpt-image edit ~57s ต้องการ headroom
// (หมายเหตุ: Hobby cap 60s → ค่านี้จะ deploy ไม่ผ่านบน Hobby ต้องอัปเป็น Pro ก่อน)
export const maxDuration = 300;

export type AnnotatedFeature = {
  name: string;
  labelTh: string;
  labelEn: string;
  color: string;
  x: number;
  y: number;
};

type Provider = "openai" | "gemini" | "claude";

const COLORS = ["#e74c3c", "#27ae60", "#2980b9", "#8e44ad", "#16a085"];

function isHttpUrl(v?: string | null): v is string {
  return typeof v === "string" && /^https?:\/\//i.test(v);
}

type ClaudeMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";
function toClaudeMedia(mime: string): ClaudeMediaType {
  if (mime === "image/png") return "image/png";
  if (mime === "image/webp") return "image/webp";
  if (mime === "image/gif") return "image/gif";
  return "image/jpeg";
}

// ===================================================================
// วิธีหลัก: ให้ gpt-image "วาด annotation ทับภาพปีกจริง" (image edit)
// ตำแหน่งป้ายในภาพหาด้วย lib/label-boxes.ts หลังได้ภาพ หน้าเว็บจึงชี้ที่ตัวหนังสือแล้วเปิดการ์ดได้
// หมายเหตุ: gpt-image เป็น generative → ปีกอาจถูกเรนเดอร์ใหม่ จึงติดป้าย
// "AI-rendered" ไว้บนภาพเสมอ กันเข้าใจผิดว่าเป็นภาพตัวอย่างต้นฉบับ
// ===================================================================

// ติดแถบข้อความ "AI-rendered" ที่ขอบล่างของภาพ (ภาษาอังกฤษ เรนเดอร์ผ่าน SVG ได้ชัวร์)
async function addAiCaption(png: Buffer, species?: string): Promise<Buffer> {
  try {
    const meta = await sharp(png).metadata();
    const W = meta.width ?? 1024;
    const H = meta.height ?? 1024;
    const barH = Math.max(30, Math.round(H * 0.05));
    const fontSize = Math.round(barH * 0.42);
    const sp = species ? ` · Culicoides ${species}` : "";
    const label = `AI-rendered annotation${sp} — not the original specimen photo`;
    const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="${H - barH}" width="${W}" height="${barH}" fill="rgba(15,23,42,0.72)"/>
      <text x="14" y="${H - barH / 2}" dominant-baseline="middle" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" fill="#ffffff">${label}</text>
    </svg>`;
    return await sharp(png).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer();
  } catch (err) {
    console.error("addAiCaption error:", err);
    return png;
  }
}

// pad เป็นสี่เหลี่ยมจัตุรัสก่อน (กันโมเดลบิดสัดส่วนปีกตอน output เป็นภาพจัตุรัส)
async function padToSquare(cropBase64: string, label: string): Promise<Buffer> {
  try {
    const buf = Buffer.from(cropBase64, "base64");
    const meta = await sharp(buf).metadata();
    const side = Math.max(meta.width ?? 1, meta.height ?? 1);
    return await sharp(buf)
      .resize(side, side, { fit: "contain", background: { r: 230, g: 233, b: 228 } })
      .png()
      .toBuffer();
  } catch (err) {
    console.error(`${label}: pad failed:`, err);
    return Buffer.from(cropBase64, "base64");
  }
}

// ป้ายต้องสะกดตรงชื่อในรายการทุกตัวอักษร — ขั้นถัดไป (detectLabelBoxes) จับคู่ตัวหนังสือในภาพกับชื่อนี้
// เพื่อวางพื้นที่ชี้เมาส์ ถ้าโมเดลย่อหรือเปลี่ยนคำ ป้ายนั้นจะชี้แล้วไม่มีการ์ด
// บอกตำแหน่งที่ลูกศรต้องชี้ด้วย เพราะจุดที่ใช้แยกชนิด (เช่น จุดใสใต้ stigma) เจาะจงกว่าชื่อโครงสร้างทั่วไป
function buildAnnotationPrompt(names: string[]): string {
  const items = names
    .map((n) => {
      const where = landmarkByName(n)?.defEn;
      return `- "${n}"${where ? ` — point the arrow at: ${where}` : ""}`;
    })
    .join("\n");
  return `Add a clean scientific annotation overlay to this Culicoides midge wing microscopy photograph, in the style of a labelled figure in a taxonomy paper.
Draw thin black arrows with short black English text labels, one label for each item below. Write each label EXACTLY as given between the quotes — same words, same spelling, no abbreviations:
${items}
Keep the wing photograph itself unchanged and in place — only add thin arrows and labels on the empty background around the wing, never on top of the wing. Do not repaint or restyle the wing. Do not add any other text, numbers, or watermark.`;
}

async function annotateWithGptImage(
  cropBase64: string,
  features: WingFeature[],
  species?: string
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const names = features.map((f) => f.nameEn).filter(Boolean);
  if (names.length === 0) return null;

  const squarePng = await padToSquare(cropBase64, "annotateWithGptImage");
  const prompt = buildAnnotationPrompt(names);

  const fd = new FormData();
  fd.append("model", "gpt-image-2");
  fd.append("prompt", prompt);
  fd.append("size", "1024x1024");
  const imgBytes = new Uint8Array(squarePng); // สำเนา ArrayBuffer ใหม่ให้ type ตรงกับ BlobPart
  fd.append("image", new Blob([imgBytes.buffer as ArrayBuffer], { type: "image/png" }), "wing.png");

  const res = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: fd,
  });
  if (!res.ok) {
    console.error("/api/annotate gpt-image error:", res.status, await res.text());
    return null;
  }
  const data = await res.json();
  const b64 = data?.data?.[0]?.b64_json as string | undefined;
  if (!b64) return null;

  const captioned = await addAiCaption(Buffer.from(b64, "base64"), species);
  return `data:image/png;base64,${captioned.toString("base64")}`;
}

// เลือก Gemini อยู่ → ต้องได้ภาพจากโมเดลของ Gemini เอง ไม่ใช่ตกไปใช้ gpt-image เงียบ ๆ
// (Nano Banana 2 = gemini-3.1-flash-image รับภาพเข้า + prompt แล้วคืนภาพที่แก้แล้ว)
const GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image";

async function annotateWithGeminiImage(
  cropBase64: string,
  features: WingFeature[],
  species?: string
): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const names = features.map((f) => f.nameEn).filter(Boolean);
  if (names.length === 0) return null;

  const squarePng = await padToSquare(cropBase64, "annotateWithGeminiImage");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: buildAnnotationPrompt(names) },
              { inline_data: { mime_type: "image/png", data: squarePng.toString("base64") } },
            ],
          },
        ],
        generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
      }),
    }
  );
  if (!res.ok) {
    console.error(`/api/annotate ${GEMINI_IMAGE_MODEL} error:`, res.status, await res.text());
    return null;
  }

  const data = await res.json();
  const parts: { inlineData?: { mimeType: string; data: string } }[] =
    data?.candidates?.[0]?.content?.parts ?? [];
  const b64 = parts.find((p) => p.inlineData?.data)?.inlineData?.data;
  if (!b64) {
    console.error(`/api/annotate ${GEMINI_IMAGE_MODEL}: no image in response`);
    return null;
  }

  const captioned = await addAiCaption(Buffer.from(b64, "base64"), species);
  return `data:image/png;base64,${captioned.toString("base64")}`;
}

// ===================================================================
// วิธีสำรอง: ให้ vision LLM คืนพิกัด (x,y) ของจุดสังเกตจาก DB
// แล้ว client วางหมุดทับภาพจริง (พิกเซลปีกไม่ถูกแตะ) ชี้เมาส์ที่หมุดเปิดการ์ดได้
// ===================================================================

const DEFAULT_FEATURE_PROMPT = `ภาพนี้คือภาพระยะใกล้ของปีกแมลง Culicoides (ปีกกินพื้นที่เกือบเต็มเฟรม) ระบุ feature ทางกายวิภาคที่สำคัญ 5 อย่าง โดย:
- ต้องอิงจากสิ่งที่เห็นจริงในภาพนี้เท่านั้น ห้ามเดาตำแหน่งลอย ๆ หรือใช้ค่าตัวอย่าง
- เลือกเฉพาะ feature ที่มองเห็นชัดเจนในภาพนี้
- ระบุตำแหน่ง x, y เป็น fraction 0.0–1.0 ของขนาดภาพนี้ (0,0 = มุมบนซ้าย / 1,1 = มุมล่างขวา)
- ชี้ตรงกลาง feature นั้น ไม่ใช่ขอบ

ตอบ JSON เท่านั้น ห้ามมีข้อความอื่น:
[
  {"name":"rm_crossvein","labelTh":"เส้นขวาง r-m","labelEn":"r-m crossvein","x":0.42,"y":0.45},
  {"name":"wing_pattern","labelTh":"ลวดลายปีก","labelEn":"Wing pattern","x":0.60,"y":0.38}
]`;

function buildFeaturePrompt(features: WingFeature[]): string {
  if (features.length === 0) return DEFAULT_FEATURE_PROMPT;

  const list = features
    .map((f, i) => {
      const where = landmarkByName(f.nameEn)?.locate;
      return `${i + 1}. ${f.nameEn} (${f.nameTh})${where ? `\n   ตำแหน่ง: ${where}` : ""}${
        f.description ? `\n   ลักษณะที่ต้องหา: ${f.description}` : ""
      }`;
    })
    .join("\n");

  return `ภาพนี้คือภาพระยะใกล้ของปีกแมลง Culicoides (ปีกกินพื้นที่เกือบเต็มเฟรม) ชี้ตำแหน่งของจุดสังเกตต่อไปนี้บนภาพนี้
แต่ละข้อมีคำบรรยายลักษณะที่ต้องหา ให้ชี้ไปที่ตัวลักษณะนั้นจริง ๆ ไม่ใช่แค่โครงสร้างทั่วไป:
${list}

วิธีอ่านปีก: ขอบหน้า (costa) คือขอบที่มีจุดเข้มยาว (stigma) อยู่ใกล้ปลาย · โคนปีกคือด้านที่แคบและติดลำตัว · ปลายปีกคือด้านที่มนกว้าง
ปีกอาจหมุนหรือกลับด้านในภาพ ให้หาขอบหน้าและโคนปีกก่อนแล้วค่อยชี้

กติกา:
- name ต้องเป็นชื่ออังกฤษจากรายการด้านบน "ตรงทุกตัวอักษร" ห้ามคิดชื่อใหม่ (labelEn = ชื่ออังกฤษ, labelTh = ชื่อไทย ตามรายการ)
- ชี้ตรงกลางตัวลักษณะ เช่น "จุดใสใต้ stigma" ให้ชี้ที่จุดใสนั้น ไม่ใช่ที่ stigma
- ถ้าคำบรรยายบอกว่า "ไม่มี" อะไรบางอย่าง ให้ชี้บริเวณที่ผู้ใช้ควรดูเพื่อยืนยันว่าไม่มี
- ถ้าลักษณะเป็นลายทั้งแผ่นปีก ให้ชี้จุดที่เห็นลักษณะตามคำบรรยายชัดที่สุด
- อิงจากสิ่งที่เห็นจริงในภาพนี้ ห้ามเดาลอย ๆ ถ้าข้อไหนมองไม่เห็นเลยให้ข้าม
- ระบุ x, y เป็น fraction 0.0–1.0 ของขนาดภาพนี้ (0,0 = มุมบนซ้าย / 1,1 = มุมล่างขวา)

ตอบ JSON array เท่านั้น ห้ามมีข้อความอื่น ตัวอย่างรูปแบบ:
[
  {"name":"${features[0].nameEn}","labelTh":"${features[0].nameTh}","labelEn":"${features[0].nameEn}","x":0.42,"y":0.45}
]`;
}

/** allowed = ชื่อที่ขอไป — โมเดลชอบสะกดชื่อเพี้ยนหรือคิดชื่อใหม่ ต้องจับคู่กลับเป็นชื่อในแคตตาล็อก
 *  client ใช้ name นี้หาข้อมูลการ์ดลอย ถ้าชื่อไม่ตรงหมุดจะไม่มีการ์ด */
function parseFeatures(text: string, allowed: WingFeature[]): AnnotatedFeature[] | null {
  const match = text.match(/\[[\s\S]*?\]/);
  if (!match) return null;

  try {
    const raw = JSON.parse(match[0]) as {
      name: string; labelTh: string; labelEn: string; x: number; y: number;
    }[];

    if (!Array.isArray(raw) || raw.length === 0) return null;

    const norm = (s?: string) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const byName = new Map(allowed.map((f) => [norm(f.nameEn), f]));
    const seen = new Set<string>();

    const features: AnnotatedFeature[] = [];
    for (const f of raw) {
      if (!Number.isFinite(f?.x) || !Number.isFinite(f?.y)) continue;
      const known = byName.get(norm(f.name)) ?? byName.get(norm(f.labelEn));
      // ไม่มีรายการให้เทียบ (DB ล่ม) → รับตามที่โมเดลตอบ มีรายการ → รับเฉพาะที่ตรง และข้อละหมุดเดียว
      if (allowed.length && (!known || seen.has(known.nameEn))) continue;
      if (known) seen.add(known.nameEn);
      const i = features.length;
      features.push({
        name: known?.nameEn ?? f.name ?? `f${i}`,
        labelTh: known?.nameTh ?? f.labelTh ?? `Feature ${i + 1}`,
        labelEn: known?.nameEn ?? f.labelEn ?? `Feature ${i + 1}`,
        color: COLORS[i % COLORS.length],
        x: Math.max(0.02, Math.min(0.98, Number(f.x))),
        y: Math.max(0.02, Math.min(0.98, Number(f.y))),
      });
    }

    return features.length > 0 ? features.slice(0, 7) : null;
  } catch {
    return null;
  }
}

function resolveClaudeModel(aiModel?: string): string {
  if (aiModel?.startsWith("claude-")) return aiModel;
  return "claude-opus-4-8";
}

async function findFeaturesClaude(base64: string, mime: string, prompt: string, allowed: WingFeature[], aiModel?: string): Promise<AnnotatedFeature[] | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: resolveClaudeModel(aiModel),
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: toClaudeMedia(mime), data: base64 } },
          { type: "text", text: prompt },
        ],
      },
    ],
  });

  const text = message.content.find((b) => b.type === "text")?.text ?? "";
  return parseFeatures(text, allowed);
}

async function findFeaturesOpenAI(base64: string, mime: string, prompt: string, allowed: WingFeature[], aiModel?: string): Promise<AnnotatedFeature[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: aiModel?.startsWith("gpt") ? aiModel : "gpt-4.1",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: `data:${mime};base64,${base64}`, detail: "high" },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    console.error("/api/annotate OpenAI error:", res.status, await res.text());
    return null;
  }

  const data = await res.json();
  const text: string =
    typeof data?.output_text === "string"
      ? data.output_text
      : (Array.isArray(data?.output) ? data.output : [])
          .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
          .find((part: any) => part?.type === "output_text")?.text ?? "";

  return parseFeatures(text, allowed);
}

async function findFeaturesGemini(base64: string, mime: string, prompt: string, allowed: WingFeature[], aiModel?: string): Promise<AnnotatedFeature[] | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  // ค่าตั้งต้นเมื่อผู้ใช้เลือกโมเดลค่ายอื่นอยู่ แต่เส้นทางนี้ตกมาใช้ Gemini
  // (ไม่ใช้ gemini-3.5-flash เพราะฝั่ง Google คืน 503 บ่อย)
  // Flash-Lite ชี้ตำแหน่งบนปีกได้แย่จนใช้ไม่ได้ (ทดสอบบนปีก guttifer ที่กลับด้าน: ชี้ r-m ผิดฝั่ง stigma
  // และชี้ลายปีกออกนอกแผ่นปีก) ขณะที่ 3.6 Flash ชี้ถูกครบ 5 จุด — งานชี้หมุดจึงใช้ 3.6 Flash แทน
  // ยังเป็นค่ายเดียวกับที่ผู้ใช้เลือก และเป็นการเรียกสั้น ๆ ครั้งเดียว (~$0.002) คำอธิบายยังใช้โมเดลที่เลือกตามเดิม
  const chosen = aiModel?.startsWith("gemini") ? aiModel : "gemini-3.6-flash";
  const model = chosen.includes("flash-lite") ? "gemini-3.6-flash" : chosen;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              { inline_data: { mimeType: mime, data: base64 } },
            ],
          },
        ],
        generationConfig: {
          // จำกัดงบเหมือนฝั่ง Claude (max_tokens 512) — เผื่อ thought token ที่กินงบเดียวกัน
          maxOutputTokens: 2048,
          // บังคับ JSON ตาม schema แทนการงมด้วย regex ใน parseFeatures()
          responseMimeType: "application/json",
          responseSchema: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                name: { type: "STRING" },
                labelTh: { type: "STRING" },
                labelEn: { type: "STRING" },
                x: { type: "NUMBER" },
                y: { type: "NUMBER" },
              },
              required: ["name", "labelTh", "labelEn", "x", "y"],
            },
          },
          // งานชี้พิกัดจากภาพ ไม่ต้อง reasoning ยาว
          thinkingConfig: { thinkingLevel: "minimal" },
        },
      }),
    }
  );

  if (!res.ok) {
    console.error("/api/annotate Gemini error:", res.status, await res.text());
    return null;
  }

  const data = await res.json();
  // รวมทุก part ที่ไม่ใช่ thought (เดิมอ่านแค่ parts[0] — เสี่ยงได้ thought แทนคำตอบ)
  const text: string = (data?.candidates?.[0]?.content?.parts ?? [])
    .filter((p: any) => !p?.thought)
    .map((p: any) => p?.text)
    .filter((t: unknown) => typeof t === "string")
    .join("");
  return parseFeatures(text, allowed);
}

const FINDERS: Record<Provider, (base64: string, mime: string, prompt: string, allowed: WingFeature[], aiModel?: string) => Promise<AnnotatedFeature[] | null>> = {
  openai: findFeaturesOpenAI,
  gemini: findFeaturesGemini,
  claude: findFeaturesClaude,
};

function resolveProvider(provider?: string, aiModel?: string): Provider {
  if (provider === "openai" || provider === "gemini" || provider === "claude") return provider;
  if (aiModel?.startsWith("gpt")) return "openai";
  if (aiModel?.startsWith("gemini")) return "gemini";
  return "claude";
}

async function fallbackCoordinateAnnotate(
  crop: { base64: string; mime: string; box: { x: number; y: number; w: number; h: number } | null },
  wingFeatures: WingFeature[],
  provider?: string,
  aiModel?: string
): Promise<AnnotatedFeature[]> {
  const prompt = buildFeaturePrompt(wingFeatures);
  const preferred = resolveProvider(provider, aiModel);
  const order: Provider[] = [preferred, ...(["openai", "gemini", "claude"] as Provider[]).filter((p) => p !== preferred)];

  let features: AnnotatedFeature[] | null = null;
  for (const p of order) {
    const modelForProvider = p === preferred ? aiModel : undefined;
    try {
      features = await FINDERS[p](crop.base64, crop.mime, prompt, wingFeatures, modelForProvider);
    } catch (err) {
      console.error(`/api/annotate ${p} error:`, err);
      features = null;
    }
    if (features) break;
  }

  // map พิกัดจากภาพ crop กลับสู่ภาพเต็ม (client วาดบนภาพเต็ม)
  if (features && crop.box) {
    const box = crop.box;
    features = features.map((f) => ({
      ...f,
      x: Math.max(0.02, Math.min(0.98, box.x + f.x * box.w)),
      y: Math.max(0.02, Math.min(0.98, box.y + f.y * box.h)),
    }));
  }
  return features ?? [];
}

export async function POST(req: Request) {
  const t = createTimer();
  const done = (data: object) => {
    t.log("/api/annotate");
    return NextResponse.json(data, { headers: { "Server-Timing": t.header() } });
  };

  try {
    const { imageUrl, aiModel, provider, species } = (await req.json()) as {
      imageUrl?: string;
      aiModel?: string;
      provider?: string;
      species?: string;
    };

    if (!isHttpUrl(imageUrl)) {
      return done({ features: [] });
    }

    // ดึงจุดสังเกตจากฐานข้อมูล + crop ปีกให้เต็มเฟรม
    // ชี้เฉพาะจุดที่ใช้แยกชนิดนี้ (species_wing_feature) — เดิมชี้ครบ 7 จุดระดับสกุลทุกชนิด
    // ภาพจึงเหมือนกันหมดไม่ว่าจะเป็นชนิดไหน ถ้าชนิดนี้ไม่มีข้อมูลรายชนิดเลยค่อยตกไปใช้ 7 จุดเดิม
    const allFeatures = await getWingFeatures(species);
    const diagnostic = allFeatures.filter((f) => f.specific);
    const wingFeatures = diagnostic.length ? diagnostic : allFeatures.slice(0, 7);
    t.mark("db-features");
    const crop = await loadAndCropWing(imageUrl);
    t.mark("fetch-crop");
    if (!crop) {
      return done({ features: [] });
    }

    // วิธีหลัก: โมเดลภาพวาดป้าย + ลูกศรลงภาพปีก (ติดป้าย AI-rendered)
    // ใช้โมเดลของค่ายที่ผู้ใช้เลือกไว้ — เลือก Gemini ก็ต้องได้ภาพจาก Gemini
    // (Claude ไม่มีโมเดลสร้างภาพ จึงใช้ gpt-image)
    const imageProvider = resolveProvider(provider, aiModel) === "gemini" ? "gemini" : "openai";
    try {
      const aiImage =
        imageProvider === "gemini"
          ? await annotateWithGeminiImage(crop.base64, wingFeatures, species)
          : await annotateWithGptImage(crop.base64, wingFeatures, species);
      t.mark(`${imageProvider}-image`);
      if (aiImage) {
        console.log(
          `[perf] /api/annotate provider=${imageProvider} payload=${(aiImage.length / 1024 / 1024).toFixed(2)}MB base64`
        );
        // หากรอบของตัวหนังสือแต่ละป้ายในภาพที่ได้ หน้าเว็บจะวางพื้นที่ชี้เมาส์ทับตัวหนังสือพอดี
        // หาไม่เจอก็ยังส่งภาพไป (ดูได้ แค่ชี้ที่ป้ายแล้วไม่มีการ์ด)
        const labels = await detectLabelBoxes(
          aiImage.slice(aiImage.indexOf(",") + 1),
          wingFeatures.map((f) => f.nameEn).filter(Boolean)
        );
        t.mark("label-boxes");
        return done({
          features: [],
          annotatedImage: aiImage,
          labels,
          aiRendered: true,
          imageProvider,
          imageModel: imageProvider === "gemini" ? GEMINI_IMAGE_MODEL : "gpt-image-2",
        });
      }
    } catch (err) {
      t.mark(`${imageProvider}-image-failed`);
      console.error(`/api/annotate ${imageProvider} image failed, falling back to coordinates:`, err);
    }

    // สำรอง: สร้างภาพไม่ได้ → ให้ vision LLM คืนพิกัด แล้วหน้าเว็บปักหมุดบนภาพปีกจริง (ชี้หมุดเปิดการ์ดได้)
    const features = await fallbackCoordinateAnnotate(crop, wingFeatures, provider, aiModel);
    t.mark("vision-coords");
    return done({ features });
  } catch (err) {
    console.error("/api/annotate error:", err);
    return done({ features: [] });
  }
}
