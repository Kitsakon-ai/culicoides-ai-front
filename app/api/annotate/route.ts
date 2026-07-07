import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";

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

const FEATURE_PROMPT = `ดูภาพปีกแมลง Culicoides นี้ แล้วระบุ feature ทางกายวิภาคที่สำคัญ 5 อย่าง โดย:
- ต้องอิงจากสิ่งที่เห็นจริงในภาพนี้เท่านั้น ห้ามเดาตำแหน่งลอย ๆ หรือใช้ค่าตัวอย่าง
- เลือกเฉพาะ feature ที่มองเห็นชัดเจนในภาพนี้
- ระบุตำแหน่ง x, y เป็น fraction 0.0–1.0 ของขนาดภาพ (0,0 = มุมบนซ้าย / 1,1 = มุมล่างขวา)
- ชี้ตรงกลาง feature นั้น ไม่ใช่ขอบ

ตอบ JSON เท่านั้น ห้ามมีข้อความอื่น:
[
  {"name":"rm_crossvein","labelTh":"เส้นขวาง r-m","labelEn":"r-m crossvein","x":0.42,"y":0.45},
  {"name":"wing_pattern","labelTh":"ลวดลายปีก","labelEn":"Wing pattern","x":0.60,"y":0.38},
  {"name":"costal_margin","labelTh":"ขอบปีกด้านหน้า","labelEn":"Costal margin","x":0.75,"y":0.20},
  {"name":"macrotrichia","labelTh":"Macrotrichia","labelEn":"Macrotrichia & fringe","x":0.85,"y":0.65},
  {"name":"apex","labelTh":"ปลายปีกมน","labelEn":"Rounded apex","x":0.90,"y":0.30}
]`;

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

    // Only return what the AI actually found on this specific photo — never
    // pad out a short list with made-up positions.
    return features.length > 0 ? features : null;
  } catch {
    return null;
  }
}

function resolveClaudeModel(aiModel?: string): string {
  if (aiModel?.startsWith("claude-")) return aiModel;
  return "claude-opus-4-8";
}

async function findFeaturesClaude(imageUrl: string, aiModel?: string): Promise<AnnotatedFeature[] | null> {
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
          { type: "image", source: { type: "url", url: imageUrl } },
          { type: "text", text: FEATURE_PROMPT },
        ],
      },
    ],
  });

  const text = message.content.find((b) => b.type === "text")?.text ?? "";
  return parseFeatures(text);
}

async function findFeaturesOpenAI(imageUrl: string, aiModel?: string): Promise<AnnotatedFeature[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: aiModel?.startsWith("gpt") ? aiModel : "gpt-4o",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: FEATURE_PROMPT },
            { type: "input_image", image_url: imageUrl, detail: "high" },
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

async function findFeaturesGemini(imageUrl: string, aiModel?: string): Promise<AnnotatedFeature[] | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) return null;

  const contentType = imgRes.headers.get("content-type") || "image/jpeg";
  const base64 = Buffer.from(await imgRes.arrayBuffer()).toString("base64");
  const model = aiModel?.startsWith("gemini") ? aiModel : "gemini-2.5-flash";

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: FEATURE_PROMPT },
              { inline_data: { mimeType: contentType, data: base64 } },
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

const FINDERS: Record<Provider, (imageUrl: string, aiModel?: string) => Promise<AnnotatedFeature[] | null>> = {
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

export async function POST(req: Request) {
  try {
    const { imageUrl, aiModel, provider } = (await req.json()) as {
      imageUrl?: string;
      aiModel?: string;
      provider?: string;
    };

    if (!isHttpUrl(imageUrl)) {
      return NextResponse.json({ features: [] });
    }

    const preferred = resolveProvider(provider, aiModel);
    // Try the user's selected provider first, then fall through to whichever
    // others are configured — every option here is a genuine AI read of the
    // real photo; if all of them fail, return nothing rather than fabricate.
    const order: Provider[] = [preferred, ...(["openai", "gemini", "claude"] as Provider[]).filter((p) => p !== preferred)];

    let features: AnnotatedFeature[] | null = null;

    for (const p of order) {
      const modelForProvider = p === preferred ? aiModel : undefined;
      try {
        features = await FINDERS[p](imageUrl, modelForProvider);
      } catch (err) {
        console.error(`/api/annotate ${p} error:`, err);
        features = null;
      }
      if (features) break;
    }

    return NextResponse.json({ features: features ?? [] });
  } catch (err) {
    console.error("/api/annotate error:", err);
    return NextResponse.json({ features: [] });
  }
}
