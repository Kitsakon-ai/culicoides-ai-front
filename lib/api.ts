import type { PredictionResult, HistoryItem, ChatMessage } from "@/lib/types";

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

export type ChatPredictionInput = Pick<
  PredictionResult,
  "species" | "genus" | "confidence" | "confidenceLevel" | "topK" | "explanation"
>;

export function resolveAiProvider(aiModel: string): "openai" | "claude" | "gemini" {
  if (aiModel.startsWith("gpt")) return "openai";
  if (aiModel.startsWith("claude")) return "claude";
  return "gemini";
}

export type ChatWithPredictionParams = {
  message: string;
  ai_model: string;
  systemPrompt?: string;
  prediction?: ChatPredictionInput | null;
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
  history?: ChatMessage[];
};

export type ChatWithPredictionResponse = {
  answer: string;
  imageUrl?: string;
  imageError?: string;
  fallback?: boolean;
  providerUsed?: string;
  modelUsed?: string;
};

export async function chatWithPrediction(
  payload: ChatWithPredictionParams,
  onToken?: (chunk: string) => void
): Promise<ChatWithPredictionResponse> {
  const provider = resolveAiProvider(payload.ai_model);

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

  const contentType = res.headers.get("content-type") || "";

  // Image-generation requests still return JSON ({ answer, imageUrl, ... }).
  if (contentType.includes("application/json") || !res.body) {
    return res.json();
  }

  // Streamed text/plain — read incrementally and forward each chunk to onToken.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let answer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    if (chunk) {
      answer += chunk;
      onToken?.(chunk);
    }
  }
  answer += decoder.decode(); // flush any trailing multi-byte character

  return { answer };
}

export async function getHistory(limit = 20): Promise<{ items: HistoryItem[] }> {
  const res = await fetch(`/api/predictions?limit=${limit}`, {
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error("Failed to fetch history");
  }

  return res.json();
}

export async function uploadImage(
  file: File
): Promise<{ url: string; pathname: string }> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch("/api/upload", {
    method: "POST",
    body: formData,
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(await getErrorMessage(res, "Upload failed"));
  }

  return res.json();
}

export async function getProvinces(
  species: string,
  aiModel: string
): Promise<{ provinces: string[] }> {
  const res = await fetch("/api/provinces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ species, ai_model: aiModel }),
    cache: "no-store",
  });

  if (!res.ok) return { provinces: [] };
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