import { useState } from "react";
import type { PredictionResult } from "@/lib/types";

interface InspectorPanelProps {
  selectedMlModel: string;
  selectedAiModel: string;
  result: PredictionResult | null;
  labels: Record<string, string>;
}

export function InspectorPanel({ selectedMlModel, selectedAiModel, result, labels }: InspectorPanelProps) {
  const [tab, setTab] = useState<"params" | "log">("params");

  const params = {
    ml_model: selectedMlModel,
    ai_model: selectedAiModel,
    high_conf_threshold: 0.60,
    low_conf_threshold: 0.50,
    ood_detection: true,
    grad_cam: true,
    top_k: 3,
  };

  const apiLog = result
    ? {
        status: 200,
        timestamp: new Date().toISOString(),
        inference_ms: 124,
        species: result.species,
        confidence: result.confidence,
        ood: result.confidenceLevel === "ood",
      }
    : null;

  return (
    <div>
      <div className="flex items-center gap-1 mb-3 rounded-md border p-0.5">
        <button
          onClick={() => setTab("params")}
          className={`flex-1 rounded px-2 py-1 text-[11px] font-medium transition-all ${
            tab === "params" ? "bg-secondary text-foreground" : "text-muted-foreground"
          }`}
        >
          Parameters
        </button>
        <button
          onClick={() => setTab("log")}
          className={`flex-1 rounded px-2 py-1 text-[11px] font-medium transition-all ${
            tab === "log" ? "bg-secondary text-foreground" : "text-muted-foreground"
          }`}
        >
          {labels.apiLog}
        </button>
      </div>

      <div className="card-surface overflow-hidden">
        <pre className="overflow-auto p-4 text-[11px] leading-relaxed font-mono text-foreground">
          {JSON.stringify(tab === "params" ? params : apiLog ?? { status: "waiting" }, null, 2)}
        </pre>
      </div>
    </div>
  );
}
