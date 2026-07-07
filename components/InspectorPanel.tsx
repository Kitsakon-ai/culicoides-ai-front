"use client";

import { useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import type { PredictionResult } from "@/lib/types";

interface InspectorPanelProps {
  selectedMlModel: string;
  selectedAiModel: string;
  result: PredictionResult | null;
  labels: Record<string, string>;
  systemPrompt: string;
  defaultSystemPrompt: string;
  onSystemPromptChange: (value: string) => void;
  onResetSystemPrompt: () => void;
  onApplySystemPrompt: () => void;
  isApplyingSystemPrompt: boolean;
}

export function InspectorPanel({
  selectedMlModel,
  selectedAiModel,
  result,
  labels,
  systemPrompt,
  defaultSystemPrompt,
  onSystemPromptChange,
  onResetSystemPrompt,
  onApplySystemPrompt,
  isApplyingSystemPrompt,
}: InspectorPanelProps) {
  const [tab, setTab] = useState<"params" | "log" | "prompt">("params");

  const params = {
    ml_model: selectedMlModel,
    ai_model: selectedAiModel,
    high_conf_threshold: 0.60,
    low_conf_threshold: 0.50,
    ood_detection: true,
    grad_cam: true,
    top_k: 3,
    prompt_modified: systemPrompt.trim() !== defaultSystemPrompt.trim(),
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

  const isModified = systemPrompt.trim() !== defaultSystemPrompt.trim();

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
          onClick={() => setTab("prompt")}
          className={`flex-1 rounded px-2 py-1 text-[11px] font-medium transition-all ${
            tab === "prompt" ? "bg-secondary text-foreground" : "text-muted-foreground"
          }`}
        >
          {labels.promptTab}
          {isModified && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-500 align-middle" />}
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

      {tab === "prompt" ? (
        <div className="card-surface space-y-2 p-3">
          <p className="text-[11px] leading-relaxed text-muted-foreground">{labels.promptHint}</p>

          <textarea
            value={systemPrompt}
            onChange={(e) => onSystemPromptChange(e.target.value)}
            rows={10}
            className="w-full resize-y rounded-md border bg-background p-2 text-[11px] leading-relaxed font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />

          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              onClick={onResetSystemPrompt}
              disabled={!isModified}
              className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RotateCcw className="h-3 w-3" />
              {labels.resetPrompt}
            </button>

            <button
              onClick={onApplySystemPrompt}
              disabled={!result || isApplyingSystemPrompt}
              title={!result ? labels.applyPromptNoResult : undefined}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isApplyingSystemPrompt && <Loader2 className="h-3 w-3 animate-spin" />}
              {isApplyingSystemPrompt ? labels.applyingPrompt : labels.applyPrompt}
            </button>
          </div>
        </div>
      ) : (
        <div className="card-surface overflow-hidden">
          <pre className="overflow-auto p-4 text-[11px] leading-relaxed font-mono text-foreground">
            {JSON.stringify(tab === "params" ? params : apiLog ?? { status: "waiting" }, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
