import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { getWingFeatures, type WingFeature } from "@/lib/knowledge";
import { loadAndCropWing } from "@/lib/wing-crop";

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

async function annotateWithGptImage(
  cropBase64: string,
  features: WingFeature[],
  species?: string
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const names = features.map((f) => f.nameEn).filter(Boolean);
  if (names.length === 0) return null;

  // pad เป็นสี่เหลี่ยมจัตุรัสก่อน (กัน gpt-image บิดสัดส่วนปีกตอน output 1024x1024)
  let squarePng: Buffer;
  try {
    const buf = Buffer.from(cropBase64, "base64");
    const meta = await sharp(buf).metadata();
    const side = Math.max(meta.width ?? 1, meta.height ?? 1);
    squarePng = await sharp(buf)
      .resize(side, side, { fit: "contain", background: { r: 230, g: 233, b: 228 } })
      .png()
      .toBuffer();
  } catch (err) {
    console.error("annotateWithGptImage: pad failed:", err);
    squarePng = Buffer.from(cropBase64, "base64");
  }

  const prompt = `Add a clean scientific annotation overlay to this Culicoides midge wing microscopy photograph.
Draw thin black arrows with short English text labels pointing to each of these wing features where visible: ${names.join(", ")}.
Keep the wing photograph itself unchanged and in place — only add thin arrows and short English labels on the empty background around the wing. Do not repaint or restyle the wing. Do not add any other text, numbers, or watermark.`;

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

// ===================================================================
// Fallback: วิธีเดิม — ให้ vision LLM คืนพิกัด (x,y) ของลักษณะปีกจาก DB
// แล้ว client วาด overlay ทับภาพจริง (พิกเซลปีกไม่ถูกแตะ)
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
    .map((f, i) => `${i + 1}. ${f.nameEn} (${f.nameTh})${f.description ? ` — ${f.description}` : ""}`)
    .join("\n");

  return `ภาพนี้คือภาพระยะใกล้ของปีกแมลง Culicoides (ปีกกินพื้นที่เกือบเต็มเฟรม) ชี้ตำแหน่งของ "ลักษณะปีกมาตรฐาน" ต่อไปนี้ เท่าที่มองเห็นได้ชัดเจนในภาพนี้จริง:
${list}

กติกา:
- ใช้เฉพาะลักษณะจากรายการด้านบนเท่านั้น ห้ามคิดชื่อ/ลักษณะใหม่เอง (labelEn = ชื่ออังกฤษ, labelTh = ชื่อไทย ตามรายการ)
- ต้องอิงจากสิ่งที่เห็นจริงในภาพนี้ ห้ามเดาตำแหน่งลอย ๆ เลือกเฉพาะที่เห็นชัด
- ระบุ x, y เป็น fraction 0.0–1.0 ของขนาดภาพนี้ (0,0 = มุมบนซ้าย / 1,1 = มุมล่างขวา) ชี้ตรงกลาง feature
- ถ้าลักษณะไหนไม่เห็นชัดในภาพ ให้ข้ามไป (ไม่ต้องใส่)

ตอบ JSON array เท่านั้น ห้ามมีข้อความอื่น ตัวอย่างรูปแบบ:
[
  {"name":"rm_crossvein","labelTh":"เส้นขวาง r-m","labelEn":"r-m crossvein","x":0.42,"y":0.45}
]`;
}

function parseFeatures(text: string): AnnotatedFeature[] | null {
  const match = text.match(/\[[\s\S]*?\]/);
  if (!match) return null;

  try {
    const raw = JSON.parse(match[0]) as {
      name: string; labelTh: string; labelEn: string; x: number; y: number;
    }[];

    if (!Array.isArray(raw) || raw.length === 0) return null;

    const features: AnnotatedFeature[] = raw
      .filter((f) => Number.isFinite(f?.x) && Number.isFinite(f?.y))
      .slice(0, 5)
      .map((f, i) => ({
        name: f.name ?? `f${i}`,
        labelTh: f.labelTh ?? `Feature ${i + 1}`,
        labelEn: f.labelEn ?? `Feature ${i + 1}`,
        color: COLORS[i % COLORS.length],
        x: Math.max(0.02, Math.min(0.98, Number(f.x))),
        y: Math.max(0.02, Math.min(0.98, Number(f.y))),
      }));

    return features.length > 0 ? features : null;
  } catch {
    return null;
  }
}

function resolveClaudeModel(aiModel?: string): string {
  if (aiModel?.startsWith("claude-")) return aiModel;
  return "claude-opus-4-8";
}

async function findFeaturesClaude(base64: string, mime: string, prompt: string, aiModel?: string): Promise<AnnotatedFeature[] | null> {
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
  return parseFeatures(text);
}

async function findFeaturesOpenAI(base64: string, mime: string, prompt: string, aiModel?: string): Promise<AnnotatedFeature[] | null> {
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

  return parseFeatures(text);
}

async function findFeaturesGemini(base64: string, mime: string, prompt: string, aiModel?: string): Promise<AnnotatedFeature[] | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const model = aiModel?.startsWith("gemini") ? aiModel : "gemini-3.5-flash";

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
      }),
    }
  );

  if (!res.ok) {
    console.error("/api/annotate Gemini error:", res.status, await res.text());
    return null;
  }

  const data = await res.json();
  const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return parseFeatures(text);
}

const FINDERS: Record<Provider, (base64: string, mime: string, prompt: string, aiModel?: string) => Promise<AnnotatedFeature[] | null>> = {
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
      features = await FINDERS[p](crop.base64, crop.mime, prompt, modelForProvider);
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
  try {
    const { imageUrl, aiModel, provider, species } = (await req.json()) as {
      imageUrl?: string;
      aiModel?: string;
      provider?: string;
      species?: string;
    };

    if (!isHttpUrl(imageUrl)) {
      return NextResponse.json({ features: [] });
    }

    // ดึงชุดลักษณะปีกจริงจากฐานข้อมูล + crop ปีกให้เต็มเฟรม
    const wingFeatures = await getWingFeatures(species);
    const crop = await loadAndCropWing(imageUrl);
    if (!crop) {
      return NextResponse.json({ features: [] });
    }

    // วิธีหลัก: gpt-image วาด annotation ทับภาพปีกจริง (ติดป้าย AI-rendered)
    try {
      const aiImage = await annotateWithGptImage(crop.base64, wingFeatures, species);
      if (aiImage) {
        return NextResponse.json({ features: [], annotatedImage: aiImage, aiRendered: true });
      }
    } catch (err) {
      console.error("/api/annotate gpt-image failed, falling back to coordinates:", err);
    }

    // Fallback: คืนพิกัดให้ client วาด overlay บนภาพจริง (ไม่แตะพิกเซลปีก)
    const features = await fallbackCoordinateAnnotate(crop, wingFeatures, provider, aiModel);
    return NextResponse.json({ features });
  } catch (err) {
    console.error("/api/annotate error:", err);
    return NextResponse.json({ features: [] });
  }
}
