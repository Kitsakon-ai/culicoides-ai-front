export interface MLModel {
  id: string;
  name: string;
  type: string;
  accuracy: number;
  latency: string;
  description: string;
}

export interface AIModel {
  id: string;
  name: string;
  provider: string;
}

export type PredictionResult = {
  species: string;
  genus: string;
  confidence: number;
  topK: { name: string; probability: number }[];
  confidenceLevel: "high" | "low" | "ood";
  taxonomy: {
    kingdom: string;
    phylum: string;
    class: string;
    order: string;
    family: string;
    genus: string;
    species: string;
  };
  gradcam?: string;
  explanation?: string;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
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

export const ML_MODELS: MLModel[] = [
  {
    id: "efficientnet_b0",
    name: "EfficientNet-B0",
    type: "CNN",
    accuracy: 94.2,
    latency: "~120ms",
    description: "Transfer learning จาก ImageNet, fine-tuned สำหรับ Culicoides",
  },
  {
    id: "resnet50",
    name: "ResNet-50",
    type: "CNN",
    accuracy: 91.8,
    latency: "~150ms",
    description: "Deep residual network, baseline comparison",
  },
  {
    id: "densenet121",
    name: "DenseNet-121",
    type: "CNN",
    accuracy: 92.5,
    latency: "~140ms",
    description: "Dense connections, ดีสำหรับ feature reuse",
  },
];

export const AI_MODELS = [
  { id: "gpt-4.1-mini", name: "GPT-4.1 Mini", provider: "openai" },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "gemini" },
];

export const SPECIES_TO_GENUS: Record<string, string> = {
  guttifer: "Phlebotomus",
  peregrinus: "Sergentomyia",
};

export function buildTaxonomy(species: string): Record<string, string> {
  return {
    Domain: "Eukaryota",
    Kingdom: "Animalia",
    Phylum: "Arthropoda",
    Class: "Insecta",
    Order: "Diptera",
    Suborder: "Nematocera",
    Family: "Psychodidae",
    Subfamily: "Phlebotominae",
    Genus: SPECIES_TO_GENUS[species] ?? "Unknown",
    Species: species,
  };
}
