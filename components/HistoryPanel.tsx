"use client";

import type { HistoryItem } from "@/lib/types";

type Props = {
  items: HistoryItem[];
};

export function HistoryPanel({ items }: Props) {
  return (
    <div className="card-surface p-4">
      <h3 className="mb-4 text-base font-semibold">Prediction History</h3>

      <div className="space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No history yet.</p>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="rounded-lg border p-3 text-sm"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="font-medium">{item.species}</div>
                  <div className="text-muted-foreground">
                    {item.filename || "unknown file"}
                  </div>
                </div>
                <div className="text-right">
                  <div>{(item.confidence * 100).toFixed(2)}%</div>
                  <div className="text-muted-foreground">{item.confidenceLevel}</div>
                </div>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {item.createdAt}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}