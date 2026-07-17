"use client";

import { Zap } from "lucide-react";
import { AI_MODELS } from "@/lib/types";

const LATENCY_DATA: Record<string, { latency: string; note: string; min: number }> = {
  "gpt-5.6-terra": { latency: "~2-4s", note: "⚡ ใหม่ · reasoning", min: 2 },
  "gpt-5.6-sol": { latency: "~2-4s", note: "ใหม่ · reasoning", min: 2 },
  "gpt-5.6-luna": { latency: "~3-5s", note: "ใหม่ · reasoning", min: 3 },
  "gpt-4.1-mini": { latency: "3-5s", note: "⚡⚡ เร็วที่สุด", min: 3 },
  "gpt-4.1": { latency: "6-10s", note: "ช้า", min: 6 },
  "gemini-2.5-pro": { latency: "4-6s", note: "ปกติ", min: 4 },
  "gemini-2.5-flash": { latency: "2-4s", note: "⚡⚡⚡ สุดเร็ว", min: 2 },
  "gemini-2.0-flash": { latency: "2-4s", note: "⚡⚡⚡ สุดเร็ว", min: 2 },
  "claude-opus-4-8": { latency: "8-12s", note: "⚠️ ช้าสุด", min: 8 },
  "claude-sonnet-4-6": { latency: "5-8s", note: "ปกติ", min: 5 },
  "claude-haiku-4-5": { latency: "3-5s", note: "⚡⚡ เร็ว", min: 3 },
};

interface ModelLatencyTableProps {
  currentAiModel: string;
}

export function ModelLatencyTable({ currentAiModel }: ModelLatencyTableProps) {
  const rows = AI_MODELS.map((m) => ({
    ...m,
    ...(LATENCY_DATA[m.id] ?? { latency: "-", note: "-", min: 99 }),
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
        <span className="text-xs font-medium text-foreground">ความเร็ว (Latency)</span>
      </div>

      <div className="overflow-x-auto px-4 pb-4">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="py-2 pr-4 font-medium">โมเดล</th>
              <th className="py-2 pr-4 font-medium">ความเร็ว</th>
              <th className="py-2 font-medium">หมายเหตุ</th>
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
                  <td className="py-2.5 text-xs text-muted-foreground">{row.note}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
