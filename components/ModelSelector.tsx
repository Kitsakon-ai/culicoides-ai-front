import type { MLModel, AIModel } from "@/lib/types";
import { Check } from "lucide-react";

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
  return (
    <div>
      <p className="label-caps mb-2">{label}</p>
      <div className="grid gap-1">
        {models.map((model) => {
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
                className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border ${
                  active ? "border-accent bg-accent" : "border-muted-foreground/30"
                }`}
              >
                {active && <Check className="h-2.5 w-2.5 text-accent-foreground" />}
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-medium truncate">{model.name}</span>
                {isMLModel(model) && (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {model.accuracy}% · {model.latency}
                  </span>
                )}
                {!isMLModel(model) && (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {model.provider}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
