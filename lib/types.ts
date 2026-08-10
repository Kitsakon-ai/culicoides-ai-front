// ฟอร์แมตที่ทั้งเบราว์เซอร์ (<img>/canvas) และ vision LLM ทุกเจ้ารองรับ
// dataset ของโปรเจกต์นี้เป็น TIFF ซึ่งไม่อยู่ในลิสต์ → ต้องแปลงเป็น PNG ก่อนใช้งานสองทางนั้น
export const LLM_SAFE_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export interface MLModel {
  id: string;
  name: string;
  type: string;
  accuracy: number;
  latency: string;
  description: string;
  // ฉบับภาษาอังกฤษ — ใช้เมื่อ UI สลับเป็น EN (ไม่ระบุ = ใช้ค่าไทยเดิม)
  nameEn?: string;
  descriptionEn?: string;
}

export interface AIModel {
  id: string;
  name: string;
  provider: string;
}

export type ModelComparisonEntry = {
  modelId: string;
  model: string;
  species: string;
  confidence: number;
  confidenceLevel: "high" | "low" | "ood";
  topK: { name: string; probability: number }[];
  isWinner: boolean;
};

export type PredictionResult = {
  species: string;
  genus: string;
  confidence: number;
  topK: { name: string; probability: number }[];
  confidenceLevel: "high" | "low" | "ood";
  taxonomy: Record<string, string>;
  gradcam?: string;
  heatmap?: string;
  explanation?: string;
  annotatedImage?: string | null;
  modelUsed?: string | null;
  provinces?: string[];
  modelComparison?: ModelComparisonEntry[];
  bestModel?: string;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  imageUrl?: string;
  imageError?: string;
  // ผู้ใช้ขอดูแผนที่ → แนบรายชื่อจังหวัดจากฐานข้อมูลมาให้แชตเรนเดอร์ <ThailandMap> จริง
  mapProvinces?: string[];
};

export type HistoryItem = {
  id: number;
  createdAt: string;
  filename?: string | null;
  species: string;
  genus: string;
  confidence: number;
  confidenceLevel: "high" | "low" | "ood";
  gradcam: boolean;
  modelUsed?: string | null;
};

// ตัวแรกของลิสต์ = ค่าเริ่มต้นของ workspace (useCulicoidesAnalysis อ่าน ML_MODELS[0].id)
export const ML_MODELS: MLModel[] = [
  {
    id: "ensemble",
    name: "Ensemble (เปรียบเทียบ 3 โมเดล)",
    nameEn: "Ensemble (3 models)",
    type: "Ensemble",
    accuracy: 95.0,
    latency: "~400ms",
    description: "รัน EfficientNet + ResNet + DenseNet พร้อมกัน แล้วเลือกผลที่ดีที่สุด",
    descriptionEn: "Runs EfficientNet + ResNet + DenseNet together, then picks the best result",
  },
  {
    id: "efficientnet_b0",
    name: "EfficientNet-B0",
    type: "CNN",
    accuracy: 92.5,
    latency: "~120ms",
    description: "Transfer learning จาก ImageNet, fine-tuned สำหรับ Culicoides (Macro F1 0.9245, ROC-AUC 1.0000)",
    descriptionEn: "Transfer learning from ImageNet, fine-tuned for Culicoides (Macro F1 0.9245, ROC-AUC 1.0000)",
  },
  {
    id: "resnet50",
    name: "ResNet-50",
    type: "CNN",
    accuracy: 95.0,
    latency: "~150ms",
    description: "Deep residual network — แม่นยำสูงสุดจากการทดสอบ (Macro F1 0.9495, ROC-AUC 0.9983)",
    descriptionEn: "Deep residual network — highest accuracy in testing (Macro F1 0.9495, ROC-AUC 0.9983)",
  },
  {
    id: "densenet121",
    name: "DenseNet-121",
    type: "CNN",
    accuracy: 87.5,
    latency: "~140ms",
    description: "Dense connections, ดีสำหรับ feature reuse (Macro F1 0.8719, ROC-AUC 0.9933)",
    descriptionEn: "Dense connections, good for feature reuse (Macro F1 0.8719, ROC-AUC 0.9933)",
  },
];

export const AI_PROVIDER_ORDER = ["openai", "gemini", "claude"] as const;
export const AI_PROVIDER_LABEL: Record<string, string> = {
  openai: "OpenAI",
  gemini: "Google Gemini",
  claude: "Anthropic Claude",
};

export const AI_MODELS: AIModel[] = [
  // OpenAI
  { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", provider: "openai" },
  { id: "gpt-5.6-sol",   name: "GPT-5.6 Sol",   provider: "openai" },
  { id: "gpt-5.6-luna",  name: "GPT-5.6 Luna",  provider: "openai" },
  { id: "gpt-4.1",      name: "GPT-4.1",       provider: "openai" },
  { id: "gpt-4.1-mini", name: "GPT-4.1 Mini",   provider: "openai" },
  // Google Gemini — ปิดไว้ชั่วคราว (ยังเรียกใช้ไม่ได้) เอากลับมาโดยเอาคอมเมนต์ออก
  // โค้ดฝั่ง backend (provider "gemini" ใน /api/chat, /api/annotate) ยังอยู่ครบ
  // { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro (Preview)", provider: "gemini" },
  // { id: "gemini-3.5-flash",       name: "Gemini 3.5 Flash",         provider: "gemini" },
  // { id: "gemini-3.1-flash-lite",  name: "Gemini 3.1 Flash-Lite",    provider: "gemini" },
  // Anthropic Claude
  { id: "claude-opus-4-8",   name: "Claude Opus 4.8",   provider: "claude" },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "claude" },
  { id: "claude-haiku-4-5",  name: "Claude Haiku 4.5",  provider: "claude" },
];

export const SPECIES_TO_GENUS: Record<string, string> = {
  guttifer: "Culicoides",
  peregrinus: "Culicoides",
};

export function buildTaxonomy(species: string): Record<string, string> {
  return {
    Domain: "Eukaryota",
    Kingdom: "Animalia",
    Phylum: "Arthropoda",
    Class: "Insecta",
    Order: "Diptera",
    Suborder: "Nematocera",
    Family: "Ceratopogonidae",
    Genus: SPECIES_TO_GENUS[species] ?? "Unknown",
    Species: species,
  };
}