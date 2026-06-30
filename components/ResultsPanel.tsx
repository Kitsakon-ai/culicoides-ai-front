import { motion } from "framer-motion";
import { Cpu } from "lucide-react";
import type { PredictionResult } from "@/lib/types";

interface ResultsPanelProps {
  result: PredictionResult;
  labels: Record<string, string>;
}

export function ResultsPanel({ result, labels }: ResultsPanelProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
      className="card-surface result-flash overflow-hidden"
    >
      <div className="flex items-center gap-2 px-4 py-2.5">
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/10">
          <Cpu className="h-3.5 w-3.5 text-accent" />
        </div>
        <span className="text-xs font-medium text-foreground">{labels.topK}</span>
      </div>

      <div className="space-y-2.5 p-4">
        {result.topK.map((item, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="w-24 truncate text-xs font-mono text-foreground">{item.name}</span>
            <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${item.probability * 100}%` }}
                transition={{ duration: 0.5, delay: i * 0.1, ease: [0.2, 0, 0, 1] }}
                className={`absolute inset-y-0 left-0 rounded-full ${
                  i === 0 ? "bg-accent" : "bg-muted-foreground/30"
                }`}
              />
            </div>
            <span className="tabular w-14 text-right font-mono text-xs text-muted-foreground">
              {(item.probability * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
