import { motion } from "framer-motion";
import type { PredictionResult } from "@/lib/types";
import { CheckCircle, AlertTriangle, XCircle } from "lucide-react";

interface ResultsPanelProps {
  result: PredictionResult;
  labels: Record<string, string>;
}

export function ResultsPanel({ result, labels }: ResultsPanelProps) {
  const statusConfig = {
    high: { icon: CheckCircle, color: "text-success", bg: "bg-success/10 border-success/20", label: labels.confidenceHigh },
    low: { icon: AlertTriangle, color: "text-warning", bg: "bg-warning/10 border-warning/20", label: labels.confidenceLow },
    ood: { icon: XCircle, color: "text-destructive", bg: "bg-destructive/10 border-destructive/20", label: labels.notSandfly },
  };
  const status = statusConfig[result.confidenceLevel];
  const StatusIcon = status.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
      className="space-y-5"
    >
      {/* Status badge */}
      <div className={`flex items-center gap-2 rounded-md border px-3 py-2 ${status.bg}`}>
        <StatusIcon className={`h-4 w-4 ${status.color}`} />
        <span className={`text-sm font-medium ${status.color}`}>{status.label}</span>
      </div>

      {/* Metrics */}
      <div className="card-surface result-flash overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="border-b">
            <tr>
              <th className="p-3 text-xs font-medium text-muted-foreground">{labels.species}</th>
              <th className="p-3 text-xs font-medium text-muted-foreground">{labels.genus}</th>
              <th className="p-3 text-xs font-medium text-muted-foreground">{labels.confidence}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="p-3 font-mono text-sm font-medium">{result.species}</td>
              <td className="p-3 font-mono text-sm">{result.genus}</td>
              <td className="tabular p-3 font-mono text-sm font-semibold text-accent">
                {(result.confidence * 100).toFixed(2)}%
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Top-K */}
      <div>
        <p className="label-caps mb-3">{labels.topK}</p>
        <div className="space-y-2.5">
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
      </div>
    </motion.div>
  );
}
