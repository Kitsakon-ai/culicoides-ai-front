"use client";

import { Zap } from "lucide-react";
import { AI_MODELS } from "@/lib/types";
import type { Lang } from "@/lib/i18n";

type Note = Record<Lang, string>;
const NOTE = {
  newReasoningFast: { th: "⚡ ใหม่ · reasoning", en: "⚡ New · reasoning" },
  newReasoning: { th: "ใหม่ · reasoning", en: "New · reasoning" },
  fastest: { th: "⚡⚡ เร็วที่สุด", en: "⚡⚡ Fastest" },
  fast: { th: "⚡⚡ เร็ว", en: "⚡⚡ Fast" },
  veryFast: { th: "⚡⚡⚡ สุดเร็ว", en: "⚡⚡⚡ Very fast" },
  veryFastCheap: { th: "⚡⚡⚡ สุดเร็ว · ประหยัด", en: "⚡⚡⚡ Very fast · cheap" },
  normal: { th: "ปกติ", en: "Normal" },
  slow: { th: "ช้า", en: "Slow" },
  slowest: { th: "⚠️ ช้าสุด", en: "⚠️ Slowest" },
} satisfies Record<string, Note>;

const LATENCY_DATA: Record<string, { latency: string; note: Note; min: number }> = {
  "gpt-5.6-terra": { latency: "2-4s", note: NOTE.newReasoningFast, min: 2 },
  "gpt-5.6-sol": { latency: "2-4s", note: NOTE.newReasoning, min: 2 },
  "gpt-5.6-luna": { latency: "3-5s", note: NOTE.newReasoning, min: 3 },
  "gpt-4.1-mini": { latency: "3-5s", note: NOTE.fastest, min: 3 },
  "gpt-4.1": { latency: "6-10s", note: NOTE.slow, min: 6 },
  "gemini-3.1-pro-preview": { latency: "4-6s", note: NOTE.normal, min: 4 },
  "gemini-3.5-flash-lite": { latency: "1-3s", note: NOTE.veryFastCheap, min: 1 },
  "gemini-3.6-flash": { latency: "2-4s", note: NOTE.veryFast, min: 2 },
  "gemini-3.1-flash-lite": { latency: "1-3s", note: NOTE.veryFastCheap, min: 1 },
  "claude-opus-4-8": { latency: "8-12s", note: NOTE.slowest, min: 8 },
  "claude-sonnet-4-6": { latency: "5-8s", note: NOTE.normal, min: 5 },
  "claude-haiku-4-5": { latency: "3-5s", note: NOTE.fast, min: 3 },
};

const TEXT = {
  th: { title: "ความเร็ว (Latency)", model: "โมเดล", speed: "ความเร็ว", note: "หมายเหตุ" },
  en: { title: "Latency", model: "Model", speed: "Speed", note: "Notes" },
};

interface ModelLatencyTableProps {
  currentAiModel: string;
  lang: Lang;
}

export function ModelLatencyTable({ currentAiModel, lang }: ModelLatencyTableProps) {
  const t = TEXT[lang];
  const fallbackNote: Note = { th: "-", en: "-" };

  const rows = AI_MODELS.map((m) => ({
    ...m,
    ...(LATENCY_DATA[m.id] ?? { latency: "-", note: fallbackNote, min: 99 }),
  })).sort((a, b) => {
    if (a.id === currentAiModel) return -1;
    if (b.id === currentAiModel) return 1;
    return a.min - b.min;
  });

  return (
    <div className="card-surface overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/10">
          <Zap className="h-3.5 w-3.5 text-accent" />
        </div>
        <span className="text-xs font-medium text-foreground">{t.title}</span>
      </div>

      <div className="overflow-x-auto px-4 pb-4">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="py-2 pr-4 font-medium">{t.model}</th>
              <th className="py-2 pr-4 font-medium">{t.speed}</th>
              <th className="py-2 font-medium">{t.note}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isCurrent = row.id === currentAiModel;
              return (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="py-2.5 pr-4 text-foreground">
                    <span className={isCurrent ? "font-semibold" : ""}>{row.name}</span>
                    {isCurrent && (
                      <span className="ml-1.5 text-xs text-muted-foreground">(current)</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 font-mono text-xs text-muted-foreground">
                    {row.latency}
                  </td>
                  <td className="py-2.5 text-xs text-muted-foreground">{row.note[lang]}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
