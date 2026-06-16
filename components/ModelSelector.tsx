"use client";

import type { MLModel, AIModel } from "@/lib/types";
import { AI_PROVIDER_ORDER, AI_PROVIDER_LABEL } from "@/lib/types";
import { Check } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ModelSelectorProps {
  label: string;
  models: (MLModel | AIModel)[];
  selectedId: string;
  onSelect: (id: string) => void;
}

function isMLModel(m: MLModel | AIModel): m is MLModel {
  return "accuracy" in m;
}

export function ModelSelector({ label, models, selectedId, onSelect }: ModelSelectorProps) {
  const mlModels = models.filter(isMLModel);
  const aiModels = models.filter((m): m is AIModel => !isMLModel(m));

  const grouped = AI_PROVIDER_ORDER
    .map((p) => ({ provider: p, items: aiModels.filter((m) => m.provider === p) }))
    .filter((g) => g.items.length > 0);

  return (
    <div>
      <p className="label-caps mb-2">{label}</p>

      {/* ML models — button list to show accuracy/latency */}
      {mlModels.length > 0 && (
        <div className="grid gap-1">
          {mlModels.map((model) => {
            const active = model.id === selectedId;
            return (
              <button
                key={model.id}
                onClick={() => onSelect(model.id)}
                className={`group flex items-center gap-2.5 rounded-md border px-3 py-2 text-left transition-all duration-150 ${
                  active
                    ? "border-accent bg-accent/10 text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                <div
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    active ? "border-accent bg-accent" : "border-muted-foreground/30"
                  }`}
                >
                  {active && <Check className="h-2.5 w-2.5 text-accent-foreground" />}
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-medium truncate">{model.name}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {model.accuracy}% · {model.latency}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* AI models — dropdown grouped by provider */}
      {aiModels.length > 0 && (
        <Select value={selectedId} onValueChange={onSelect}>
          <SelectTrigger className="w-full text-xs h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {grouped.map(({ provider, items }) => (
              <SelectGroup key={provider}>
                <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                  {AI_PROVIDER_LABEL[provider]}
                </SelectLabel>
                {items.map((model) => (
                  <SelectItem key={model.id} value={model.id} className="text-xs">
                    {model.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
