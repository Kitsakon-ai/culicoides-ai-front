import type { PredictionResult, HistoryItem } from "@/lib/types";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "");

async function getErrorMessage(res: Response, fallback: string): Promise<string> {
  const contentType = res.headers.get("content-type") || "";

  try {
    if (contentType.includes("application/json")) {
      const data = await res.json();
      if (typeof data?.detail === "string") return data.detail;
      if (typeof data?.message === "string") return data.message;
      return JSON.stringify(data);
    }

    const text = await res.text();
    return text || fallback;
  } catch {
    return fallback;
  }
}

export async function predictImage(
  file: File,
  mlModel: string
): Promise<PredictionResult> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("ml_model", mlModel);

  const res = await fetch("/api/predict", {
    method: "POST",
    body: formData,
    cache: "no-store",
  });

  if (!res.ok) {
    const message = await getErrorMessage(res, "Prediction failed");

    if (
      message.includes("insufficient_quota") ||
      message.toLowerCase().includes("quota")
    ) {
      throw new Error("โควต้าการใช้งานเต็มแล้ว กรุณาลองใหม่ภายหลัง");
    }

    throw new Error(message);
  }

  return res.json();
}

export async function explainPrediction(payload: {
  species: string;
  confidence: number;
  topK: { name: string; probability: number }[];
}): Promise<{ explanation: string }> {
  const res = await fetch(`${API_URL}/explain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(await getErrorMessage(res, "Explain failed"));
  }

  return res.json();
}

export async function chatWithPrediction(payload: {
  message: string;
  ai_model: string;
  prediction: any;
  mode?: "explanation" | "vision";
  xai?: {
    highlightedRegions?: string[];
    confidenceDrivers?: string[];
    warningFlags?: string[];
  };
  images?: {
    original?: string | null;
    heatmap?: string | null;
  };
  history?: { role: "user" | "assistant"; content: string }[];
}) {
  const provider = payload.ai_model.startsWith("gpt") ? "openai" : "gemini";

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...payload,
      provider,
    }),
  });

  if (!res.ok) {
    let message = "Chat failed";
    try {
      const data = await res.json();
      message = data.error || message;
    } catch {}
    throw new Error(message);
  }

  return res.json();
}

export async function getHistory(limit = 20): Promise<{ items: HistoryItem[] }> {
  const res = await fetch(`/api/predictions?limit=${limit}`);

  if (!res.ok) {
    throw new Error("Failed to fetch history");
  }

  return res.json();
}