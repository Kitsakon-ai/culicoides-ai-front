import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Msg = {
  role: "user" | "assistant";
  content: string;
};

type TopKItem = {
  name: string;
  probability: number;
};

type PredictionPayload = {
  species: string;
  genus: string;
  confidence: number;
  confidenceLevel: "high" | "low" | "ood";
  topK?: TopKItem[];
  explanation?: string;
};

type ChatBody = {
  provider: "openai" | "gemini";
  ai_model: string;
  mode?: "explanation" | "vision";
  message: string;
  prediction: PredictionPayload | null;
  xai?: {
    highlightedRegions?: string[];
    confidenceDrivers?: string[];
    warningFlags?: string[];
  };
  images?: {
    original?: string | null; // data URL
    heatmap?: string | null;  // data URL
  };
  history?: Msg[];
};

function isDataUrl(value?: string | null) {
  return typeof value === "string" && value.startsWith("data:image/");
}

function buildExplanationPrompt(body: ChatBody) {
  const p = body.prediction;

  if (!p) {
    return `ตอบเป็นภาษาไทย 3-5 บรรทัด และแจ้งว่าไม่มีข้อมูลผลทำนายเพียงพอ`;
  }

  return `
คุณเป็นผู้ช่วยอธิบายผล Explainable AI สำหรับการจำแนกแมลง Culicoides

ผลทำนาย:
- species: ${p.species}
- genus: ${p.genus}
- confidence: ${(p.confidence * 100).toFixed(2)}%
- confidenceLevel: ${p.confidenceLevel}
- topK: ${p.topK?.map((x) => `${x.name} ${(x.probability * 100).toFixed(1)}%`).join(", ") || "-"}

ข้อมูล XAI:
- highlightedRegions: ${(body.xai?.highlightedRegions ?? []).join(", ") || "-"}
- confidenceDrivers: ${(body.xai?.confidenceDrivers ?? []).join(", ") || "-"}
- warningFlags: ${(body.xai?.warningFlags ?? []).join(", ") || "-"}

จงตอบเป็นภาษาไทย 3-5 บรรทัด โดยต้องมีเนื้อหาครบดังนี้:
1. ระบุว่าโมเดลทำนายว่าเป็นชนิดใดและมีความเชื่อมั่นเท่าใด
2. อธิบายลักษณะของปีกที่สังเกตได้จากภาพต้นฉบับ เช่น รูปร่างปีก ลวดลายปีก ความเข้มของบริเวณปีก หรือส่วนของปีกที่เด่น
3. อธิบายว่า heatmap หรือ Grad-CAM เน้นบริเวณใดของปีกหรือร่างกาย และบริเวณนั้นอาจสัมพันธ์กับการตัดสินใจของโมเดลอย่างไร
4. ถ้าความเชื่อมั่นต่ำหรือเป็น ood ให้เตือนว่าเป็นผลเบื้องต้น

ข้อกำหนด:
- ให้ความสำคัญกับ "ลักษณะของปีก" เป็นพิเศษ
- ถ้าเห็นลักษณะของปีกไม่ชัด ให้บอกว่าไม่สามารถสรุปรายละเอียดของปีกได้ชัดเจน
- ห้ามแต่งรายละเอียดทางสัณฐานวิทยาที่มองไม่เห็นจากภาพ
- ห้ามใช้ bullet
- ห้ามขึ้นเลขข้อ
- ห้ามยาวเกิน 5 บรรทัด
`;
}

function buildVisionPrompt(body: ChatBody) {
  const historyText =
    body.history?.map((m) => `${m.role === "user" ? "ผู้ใช้" : "ผู้ช่วย"}: ${m.content}`).join("\n") ||
    "ยังไม่มีประวัติการสนทนา";

  const p = body.prediction;

  return `
คุณคือ Vision Entomology AI Assistant สำหรับช่วยอธิบายลักษณะภาพแมลงและ heatmap

งานของคุณ:
- วิเคราะห์ภาพต้นฉบับร่วมกับภาพ heatmap
- ตอบคำถามเกี่ยวกับลักษณะของปีก รูปร่าง ลวดลาย และบริเวณที่ heatmap เน้น
- ใช้ผล prediction และ XAI ประกอบคำอธิบาย
- ถ้าไม่แน่ใจหรือภาพไม่พอ ให้บอกตรง ๆ
- ห้ามแต่งข้อมูลเกินจากภาพและข้อมูลที่ให้

ผลทำนายปัจจุบัน:
${p ? `
species: ${p.species}
genus: ${p.genus}
confidence: ${(p.confidence * 100).toFixed(2)}%
confidenceLevel: ${p.confidenceLevel}
topK: ${p.topK?.map((x) => `${x.name} ${(x.probability * 100).toFixed(1)}%`).join(", ") || "-"}
` : "ไม่มีผลทำนาย"}

ข้อมูล XAI:
highlightedRegions: ${(body.xai?.highlightedRegions ?? []).join(", ") || "-"}
confidenceDrivers: ${(body.xai?.confidenceDrivers ?? []).join(", ") || "-"}
warningFlags: ${(body.xai?.warningFlags ?? []).join(", ") || "-"}

ประวัติการสนทนา:
${historyText}

คำถามล่าสุดของผู้ใช้:
${body.message}

แนวทางการตอบ:
- ตอบเป็นภาษาไทย
- ถ้าผู้ใช้ถามเรื่องปีก ให้ตอบโดยอ้างอิงจากภาพต้นฉบับและ heatmap
- ถ้าผู้ใช้ถามว่า heatmap บอกอะไร ให้บอกว่าบริเวณใดถูกเน้นและอาจสัมพันธ์กับการตัดสินใจอย่างไร
- ถ้าผู้ใช้ถามเชิงเปรียบเทียบ ให้ตอบอย่างระมัดระวังตามข้อมูลที่มี
- ถ้าภาพไม่ชัด ให้บอกว่าภาพไม่ชัด
`;
}

function dataUrlToGeminiInlineData(dataUrl: string) {
  const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);
  if (!match) return null;

  return {
    mimeType: match[1],
    data: match[2],
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

  if (isDataUrl(body.images?.original)) {
    content.push({
      type: "input_image",
      image_url: body.images!.original,
      detail: "high",
    });
  }

  if (isDataUrl(body.images?.heatmap)) {
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

  if (isDataUrl(body.images?.original)) {
    const original = dataUrlToGeminiInlineData(body.images!.original!);
    if (original) {
      parts.push({
        inline_data: original,
      });
    }
  }

  if (isDataUrl(body.images?.heatmap)) {
    const heatmap = dataUrlToGeminiInlineData(body.images!.heatmap!);
    if (heatmap) {
      parts.push({
        inline_data: heatmap,
      });
    }
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