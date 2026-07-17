"use client";

import { Settings2 } from "lucide-react";

import type { Lang } from "@/lib/i18n";
import type { CulicoidesAnalysis } from "@/hooks/useCulicoidesAnalysis";
import { InspectorPanel } from "@/components/InspectorPanel";
import { HistoryPanel } from "@/components/HistoryPanel";
import { DEFAULT_AI_SYSTEM_PROMPT } from "@/lib/prompts";

interface Props {
  analysis: CulicoidesAnalysis;
  lang: Lang;
  t: Record<string, string>;
}

export function InspectorSection({ analysis, lang, t }: Props) {
  const {
    mlModel,
    aiModel,
    result,
    systemPrompt,
    setSystemPrompt,
    handleResetSystemPrompt,
    regenerateExplanation,
    isExplaining,
    historyItems,
  } = analysis;

  return (
    <>
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Settings2 className="h-5 w-5 text-accent" />
          Inspector
        </h1>
        <p className="text-sm text-muted-foreground">
          {lang === "th"
            ? "ข้อมูลทางเทคนิค, parameters, และ API logs"
            : "Technical details, parameters, and API logs"}
        </p>
      </div>

      <InspectorPanel
        selectedMlModel={mlModel}
        selectedAiModel={aiModel}
        result={result}
        labels={t as unknown as Record<string, string>}
        systemPrompt={systemPrompt}
        defaultSystemPrompt={DEFAULT_AI_SYSTEM_PROMPT}
        onSystemPromptChange={setSystemPrompt}
        onResetSystemPrompt={handleResetSystemPrompt}
        onApplySystemPrompt={regenerateExplanation}
        isApplyingSystemPrompt={isExplaining}
      />
      <HistoryPanel items={historyItems} />
    </>
  );
}
