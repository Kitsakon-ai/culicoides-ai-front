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

const COLORS = ["#e74c3c", "#27ae60", "#2980b9", "#8e44ad", "#16a085"];

const FALLBACK: AnnotatedFeature[] = [
  { name: "f0", labelTh: "เส้นขวาง r-m",     labelEn: "r-m crossvein",        color: COLORS[0], x: 0.42, y: 0.48 },
  { name: "f1", labelTh: "ลวดลายบนปีก",      labelEn: "Wing pattern",          color: COLORS[1], x: 0.60, y: 0.40 },
  { name: "f2", labelTh: "ขอบปีกด้านหน้า",   labelEn: "Costal margin",         color: COLORS[2], x: 0.72, y: 0.22 },
  { name: "f3", labelTh: "Macrotrichia",      labelEn: "Macrotrichia & fringe", color: COLORS[3], x: 0.82, y: 0.68 },
  { name: "f4", labelTh: "ปลายปีกมน",        labelEn: "Rounded apex",          color: COLORS[4], x: 0.88, y: 0.32 },
];

function isHttpUrl(v?: string | null): v is string {
  return typeof v === "string" && /^https?:\/\//i.test(v);
}

// Resolve the model to use: keep Claude models as-is; for GPT/Gemini fall back to opus
function resolveClaudeModel(aiModel?: string): string {
  if (aiModel?.startsWith("claude-")) return aiModel;
  return "claude-opus-4-8";
}

export async function POST(req: Request) {
  try {
    const { imageUrl, aiModel } = await req.json() as {
      imageUrl?: string;
      aiModel?: string;
    };

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || !isHttpUrl(imageUrl)) {
      return NextResponse.json({ features: FALLBACK });
    }

    const model = resolveClaudeModel(aiModel);
    const client = new Anthropic({ apiKey });

    const prompt = `ดูภาพปีกแมลง Culicoides นี้ แล้วระบุ feature ทางกายวิภาคที่สำคัญ 5 อย่าง โดย:
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

    const message = await client.messages.create({
      model,
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "url", url: imageUrl } },
            { type: "text", text: prompt },
          ],
        },
      ],
    });

    const text = message.content.find((b) => b.type === "text")?.text ?? "";
    const match = text.match(/\[[\s\S]*?\]/);
    if (!match) return NextResponse.json({ features: FALLBACK });

    const raw = JSON.parse(match[0]) as {
      name: string; labelTh: string; labelEn: string; x: number; y: number;
    }[];

    const features: AnnotatedFeature[] = raw.slice(0, 5).map((f, i) => ({
      name: f.name ?? `f${i}`,
      labelTh: f.labelTh ?? `Feature ${i + 1}`,
      labelEn: f.labelEn ?? `Feature ${i + 1}`,
      color: COLORS[i % COLORS.length],
      x: Math.max(0.02, Math.min(0.98, f.x)),
      y: Math.max(0.02, Math.min(0.98, f.y)),
    }));

    while (features.length < 5) {
      const i = features.length;
      features.push({ ...FALLBACK[i], color: COLORS[i % COLORS.length] });
    }

    return NextResponse.json({ features });
  } catch (err) {
    console.error("/api/annotate error:", err);
    return NextResponse.json({ features: FALLBACK });
  }
}
