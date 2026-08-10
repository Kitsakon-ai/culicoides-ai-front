import type { PredictionResult, HistoryItem, ChatMessage } from "@/lib/types";
import type { Lang } from "@/lib/i18n";
import { perfCall, perfJson, bodyBytes } from "@/lib/perf";

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
  return perfCall(`predict [${mlModel}]`, async (perf) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("ml_model", mlModel);
    perf.req(bodyBytes(formData));
    perf.note(`${file.name} ${file.type || "?"}`);

    const res = await fetch("/api/predict", {
      method: "POST",
      body: formData,
      cache: "no-store",
    });
    perf.lap("ttfb");

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

    const data = await perfJson<PredictionResult>(res, perf);
    perf.note(`${data.species} ${(data.confidence * 100).toFixed(1)}% (${data.confidenceLevel})`);
    return data;
  });
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
  // ภาษาที่เลือกใน UI — backend ใช้เลือกชุด prompt (ไม่ส่ง = ไทย)
  lang?: Lang;
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
  mapProvinces?: string[];
  fallback?: boolean;
  providerUsed?: string;
  modelUsed?: string;
};

export async function chatWithPrediction(
  payload: ChatWithPredictionParams,
  onToken?: (chunk: string) => void
): Promise<ChatWithPredictionResponse> {
  const provider = resolveAiProvider(payload.ai_model);
  const mode = payload.mode ?? "explanation";

  return perfCall(`chat:${mode} [${payload.ai_model}]`, async (perf) => {
    const body = JSON.stringify({ ...payload, provider });
    perf.req(bodyBytes(body));
    perf.note(`lang=${payload.lang ?? "th"}`);

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body,
      cache: "no-store",
    });
    // ttfb = เวลาที่ backend ใช้ก่อนเริ่มตอบ (โหลด knowledge base + ต่อ LLM)
    perf.lap("ttfb");

    if (!res.ok) {
      const message = await getErrorMessage(res, "Chat failed");
      throw new Error(message);
    }

    const contentType = res.headers.get("content-type") || "";

    // Image-generation requests still return JSON ({ answer, imageUrl, ... }).
    if (contentType.includes("application/json") || !res.body) {
      const data = await perfJson<ChatWithPredictionResponse>(res, perf);
      perf.note(
        data.imageUrl
          ? "image generated"
          : data.imageError
          ? `image FAILED: ${data.imageError}`
          : data.mapProvinces
          ? `map · ${data.mapProvinces.length} provinces`
          : "text only"
      );
      return data;
    }

    // Streamed text/plain — read incrementally and forward each chunk to onToken.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let answer = "";
    let chunks = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      if (chunk) {
        // ttft = token แรกโผล่บนจอ (ตัวเลขที่ผู้ใช้รู้สึกว่า "เริ่มตอบแล้ว")
        if (chunks === 0) perf.lap("ttft");
        chunks++;
        answer += chunk;
        onToken?.(chunk);
      }
    }
    answer += decoder.decode(); // flush any trailing multi-byte character

    perf.res(new Blob([answer]).size);
    perf.server(res.headers.get("server-timing"));
    perf.note(`${answer.length} chars / ${chunks} chunks`);
    return { answer };
  });
}

export async function getHistory(limit = 20): Promise<{ items: HistoryItem[] }> {
  return perfCall("history", async (perf) => {
    const res = await fetch(`/api/predictions?limit=${limit}`, {
      cache: "no-store",
    });
    perf.lap("ttfb");

    if (!res.ok) {
      throw new Error("Failed to fetch history");
    }

    return perfJson<{ items: HistoryItem[] }>(res, perf);
  });
}

export async function uploadImage(
  file: File
): Promise<{ url: string; pathname: string }> {
  return perfCall(`upload [${file.name}]`, async (perf) => {
    const formData = new FormData();
    formData.append("file", file);
    perf.req(bodyBytes(formData));
    // ขนาดนี้เทียบกับลิมิต request body ของ Vercel ที่ 4.5 MB ได้เลย
    perf.note(`${file.type || "?"} ${(file.size / 1024 / 1024).toFixed(2)} MB`);

    const res = await fetch("/api/upload", {
      method: "POST",
      body: formData,
      cache: "no-store",
    });
    perf.lap("ttfb");

    if (!res.ok) {
      throw new Error(await getErrorMessage(res, "Upload failed"));
    }

    return perfJson<{ url: string; pathname: string }>(res, perf);
  });
}

export async function getProvinces(
  species: string,
  aiModel: string
): Promise<{ provinces: string[] }> {
  return perfCall(`provinces [${species}]`, async (perf) => {
    const body = JSON.stringify({ species, ai_model: aiModel });
    perf.req(bodyBytes(body));

    const res = await fetch("/api/provinces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      cache: "no-store",
    });
    perf.lap("ttfb");

    if (!res.ok) return { provinces: [] };
    const data = await perfJson<{ provinces: string[] }>(res, perf);
    perf.note(`${data.provinces.length} จังหวัด`);
    return data;
  });
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