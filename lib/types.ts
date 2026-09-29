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
//
// ===== ที่มาของตัวเลข accuracy / latency (วัดจริง อย่าแก้มั่ว) =====
//
// accuracy : วัดบน test set ที่กันไว้ 40 ภาพ (4 ชนิด ชนิดละ 10) ของชุดครอป
//            ทั้ง 3 สถาปัตยกรรมได้ 40/40 เท่ากันหมด -> เลือกโมเดลไม่มีผลต่อความแม่น
//            มีผลแค่ความเร็ว ตัวเลือกพวกนี้จึงมีไว้ "เทียบให้ดู" ไม่ใช่ "เลือกให้แม่นขึ้น"
//            ตัวเลขนี้วัดเส้นทางจริง (ภาพเต็ม -> ครอปอัตโนมัติ -> จำแนก) ไม่ใช่ป้อนภาพครอปให้
//
//            100% บน n=40 เป็นตัวเลขที่เล็กเกินกว่าจะเชื่อเต็มร้อย
//            ตัวเลขที่ควรอ้างในเล่มคือ 5-fold CV ของ EfficientNet-B0: 97.75% ± 1.22% (n=400)
//
// latency  : วัดบน CPU 2 thread (ใกล้เคียงโฮสต์ฟรีที่ deploy จริง) ไม่ใช่ GPU
//            เป็นเวลา "ต่อภาพ" ของเส้นทางเต็ม = หาปีก ~12ms + จำแนกปีกละ N ms x 2 ปีก
//            (ภาพสไลด์ในชุดข้อมูลมีปีกเฉลี่ย 2 ตัวต่อภาพ)
//            เวลาจำแนกต่อปีก: EfficientNet 18ms · DenseNet 56ms · ResNet 61ms
//            ยังไม่รวมเวลาเน็ตกับเวลาปลุกเครื่องที่หลับอยู่ (โฮสต์ฟรีปลุกครั้งแรก ~30-60s)
export const ML_MODELS: MLModel[] = [
  {
    id: "ensemble",
    name: "Ensemble (3 โมเดลโหวต)",
    nameEn: "Ensemble (3-model vote)",
    type: "Ensemble",
    accuracy: 100,
    latency: "~280ms",
    description:
      "รัน EfficientNet + ResNet + DenseNet ทั้งสามตัวแล้วเฉลี่ยความน่าจะเป็น " +
      "แม่นเท่าตัวเดียว (40/40) แต่ช้ากว่า 6 เท่า — ใช้ตอนอยากเห็นว่าสามโมเดลเห็นตรงกันไหม",
    descriptionEn:
      "Runs EfficientNet + ResNet + DenseNet and averages their probabilities. " +
      "Same accuracy as a single model (40/40) but 6x slower — use it to see whether the three agree.",
  },
  {
    id: "efficientnet_b0",
    name: "EfficientNet-B0",
    type: "CNN",
    accuracy: 100,
    latency: "~50ms",
    description:
      "ค่าเริ่มต้นของระบบ — เร็วที่สุดและไฟล์เล็กที่สุด (15.6 MB) โดยแม่นเท่าอีกสองตัว " +
      "ทดสอบซ้ำแบบ 5-fold cross-validation บน 400 ภาพได้ 97.75% ± 1.22%",
    descriptionEn:
      "System default — fastest and smallest (15.6 MB) at the same accuracy as the others. " +
      "5-fold cross-validation over 400 images: 97.75% ± 1.22%.",
  },
  {
    id: "densenet121",
    name: "DenseNet-121",
    type: "CNN",
    accuracy: 100,
    latency: "~120ms",
    description:
      "Dense connections ใช้ feature ซ้ำได้ดี ไฟล์ 28.4 MB — แม่นเท่า EfficientNet แต่ช้ากว่า 3 เท่า",
    descriptionEn:
      "Dense connections reuse features well, 28.4 MB — same accuracy as EfficientNet but 3x slower.",
  },
  {
    id: "resnet50",
    name: "ResNet-50",
    type: "CNN",
    accuracy: 100,
    latency: "~135ms",
    description:
      "Deep residual network ไฟล์ 92.5 MB ใหญ่กว่า EfficientNet 5.8 เท่าและช้ากว่า 3.4 เท่า " +
      "โดยไม่ได้ความแม่นเพิ่ม — ถ้าพื้นที่โฮสต์จำกัดให้ตัดตัวนี้ก่อน",
    descriptionEn:
      "Deep residual network, 92.5 MB — 5.8x larger and 3.4x slower than EfficientNet with no accuracy gain. " +
      "Drop this one first if host storage is tight.",
  },
];

/** ค่าพิเศษของ ai_model = ปิดการใช้ LLM ทั้งหมด (คำอธิบาย, annotate, จังหวัดสำรอง)
 *  ใช้ตอนต้องการผลจำแนกอย่างเดียว เช่นตรวจภาพจำนวนมาก จะได้ไม่เสียโทเคน */
export const AI_OFF = "off";

export const AI_PROVIDER_ORDER = ["openai", "gemini", "claude", "none"] as const;
export const AI_PROVIDER_LABEL: Record<string, string> = {
  none: "ไม่ใช้ AI / No AI",
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
  // Google Gemini
  { id: "gemini-3.1-pro-preview",  name: "Gemini 3.1 Pro ",     provider: "gemini" },
  { id: "gemini-3.6-flash",        name: "Gemini 3.6 Flash",             provider: "gemini" },
  // ไม่ใส่ gemini-3.5-flash: ฝั่ง Google คืน 503 (คิวเต็ม) บ่อยจนใช้เดโม่ไม่ได้
  // และ 3.6 Flash แทนที่ได้หมด — ใหม่กว่าและถูกกว่าทั้งสองทาง
  // ($0.75/$3.75 เทียบกับ $1.50/$9.00 ต่อ 1M token)
  //
  // ตระกูล Flash กับ Flash-Lite ของ Google มีโควตาฟรีต่อวัน ใช้ทดสอบได้โดยไม่เสียเงิน
  // ส่วน 3.1 Pro Preview เป็นแบบจ่ายเงินอย่างเดียว
  { id: "gemini-3.5-flash-lite",   name: "Gemini 3.5 Flash-Lite", provider: "gemini" },
  // ถูกที่สุดฝั่ง Google ($0.25/$1.50 ต่อ 1M token) — ถูกกว่า Gemini 3.1 Pro ราว 8 เท่า
  // ถูกที่สุดในลิสต์ทั้งหมดคือ GPT-5.6 Luna ($0.20/$1.20) ไม่ใช่ตัวนี้
  // ตารางราคาฉบับเต็มอยู่ใน components/ModelLatencyTable.tsx
  { id: "gemini-3.1-flash-lite",   name: "Gemini 3.1 Flash-Lite",        provider: "gemini" },
  // Anthropic Claude
  { id: "claude-opus-4-8",   name: "Claude Opus 4.8",   provider: "claude" },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "claude" },
  { id: "claude-haiku-4-5",  name: "Claude Haiku 4.5",  provider: "claude" },
  // ปิด AI — จำแนกอย่างเดียว ไม่เรียก LLM เลยสักงาน
  // *** ต้องอยู่ท้ายสุดเสมอ *** เพราะ AI_MODELS[0] ถูกใช้เป็นค่าเริ่มต้นของทั้งระบบ
  { id: AI_OFF, name: "ปิด AI · AI off", provider: "none" },
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