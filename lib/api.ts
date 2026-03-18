import type { PredictionResult, HistoryItem } from "@/lib/types";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");

async function getErrorMessage(res: Response, fallback: string): Promise<string> {
  const contentType = res.headers.get("content-type") || "";

  try {
    if (contentType.includes("application/json")) {
      const data = await res.json();
      if (typeof data?.detail === "string") return data.detail;
      if (typeof data?.message === "string") return data.message;
      if (typeof data?.error === "string") return data.error;
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
    original?: string | null; // data URL
    heatmap?: string | null;  // data URL
  };
  history?: { role: "user" | "assistant"; content: string }[];
}): Promise<{ answer: string }> {
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
    cache: "no-store",
  });

  if (!res.ok) {
    const message = await getErrorMessage(res, "Chat failed");
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

export async function uploadImage(file: File): Promise<{ url: string; pathname: string }> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch("/api/upload", {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    throw new Error(await getErrorMessage(res, "Upload failed"));
  }

  return res.json();
}

export function dataUrlToFile(dataUrl: string, filename: string): File {
  const [meta, base64] = dataUrl.split(",");
  const mimeMatch = meta.match(/data:(.*?);base64/);
  const mime = mimeMatch?.[1] || "image/png";

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new File([bytes], filename, { type: mime });
}