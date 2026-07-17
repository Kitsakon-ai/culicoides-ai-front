import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { ModelComparisonEntry } from "@/lib/types";

export const runtime = "nodejs";
// ปลุก HF Space + inference (ensemble = 3 เรียก) อาจนาน — Vercel Pro รองรับถึง 300s
export const maxDuration = 60;

const API_URL = (process.env.FASTAPI_URL || "https://kitsakon-culiciodes.hf.space/").replace(/\/+$/, "");
// https://kitsakon-culiciodes.hf.space/ http://127.0.0.1:3001

const MODEL_LABELS: Record<string, string> = {
  efficientnet_b0: "EfficientNet-B0",
  resnet50: "ResNet-50",
  densenet121: "DenseNet-121",
};

const ENSEMBLE_MODELS = ["efficientnet_b0", "resnet50", "densenet121"] as const;

async function callFastAPI(file: File, mlModel: string) {
  const form = new FormData();
  form.append("file", file);
  form.append("ml_model", mlModel);
  const res = await fetch(`${API_URL}/predict-with-gradcam`, {
    method: "POST",
    body: form,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${mlModel} failed: ${res.status}`);
  return res.json();
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const mlModel = (formData.get("ml_model") as string) || "efficientnet_b0";

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    // ── Ensemble mode ──────────────────────────────────────────
    if (mlModel === "ensemble") {
      const settled = await Promise.allSettled(
        ENSEMBLE_MODELS.map((m) =>
          callFastAPI(file, m).then((data) => ({ modelId: m as string, data }))
        )
      );

      const successes = settled
        .filter((r): r is PromiseFulfilledResult<{ modelId: string; data: any }> =>
          r.status === "fulfilled"
        )
        .map((r) => (r as PromiseFulfilledResult<{ modelId: string; data: any }>).value);

      if (successes.length === 0) {
        return NextResponse.json({ error: "All models failed" }, { status: 500 });
      }

      // Pick winner: prefer non-OOD, then highest confidence
      const nonOOD = successes.filter((r) => r.data.confidenceLevel !== "ood");
      const candidates = nonOOD.length > 0 ? nonOOD : successes;
      const winner = candidates.reduce((a, b) =>
        a.data.confidence >= b.data.confidence ? a : b
      );

      const modelComparison: ModelComparisonEntry[] = successes.map((r) => ({
        modelId: r.modelId,
        model: MODEL_LABELS[r.modelId] ?? r.modelId,
        species: r.data.species,
        confidence: r.data.confidence,
        confidenceLevel: r.data.confidenceLevel,
        topK: r.data.topK ?? [],
        isWinner: r.modelId === winner.modelId,
      }));

      await prisma.prediction.create({
        data: {
          filename: file.name,
          species: winner.data.species,
          genus: winner.data.genus,
          confidence: winner.data.confidence,
          confidenceLevel: winner.data.confidenceLevel,
          gradcam: Boolean(winner.data.gradcam),
          modelUsed: "ensemble",
        },
      });

      return NextResponse.json({
        ...winner.data,
        modelUsed: "ensemble",
        bestModel: winner.modelId,
        modelComparison,
      });
    }

    // ── Single model mode ──────────────────────────────────────
    const forwardForm = new FormData();
    forwardForm.append("file", file);
    forwardForm.append("ml_model", mlModel);

    const fastapiRes = await fetch(`${API_URL}/predict-with-gradcam`, {
      method: "POST",
      body: forwardForm,
      cache: "no-store",
    });

    if (!fastapiRes.ok) {
      const text = await fastapiRes.text();
      return NextResponse.json(
        { error: text || "Prediction failed from ML API" },
        { status: fastapiRes.status }
      );
    }

    const data = await fastapiRes.json();

    await prisma.prediction.create({
      data: {
        filename: file.name,
        species: data.species,
        genus: data.genus,
        confidence: data.confidence,
        confidenceLevel: data.confidenceLevel,
        gradcam: Boolean(data.gradcam),
        modelUsed: mlModel,
      },
    });

    return NextResponse.json(data);
  } catch (error) {
    console.error("POST /api/predict error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
