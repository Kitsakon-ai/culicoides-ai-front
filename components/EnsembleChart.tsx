"use client";

import { Trophy } from "lucide-react";
import type { ModelComparisonEntry } from "@/lib/types";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

interface EnsembleChartProps {
  comparison: ModelComparisonEntry[];
}

const MODEL_COLORS: Record<string, string> = {
  efficientnet_b0: "#3b82f6",
  resnet50:        "#f97316",
  densenet121:     "#22c55e",
};

const LEVEL_LABEL: Record<string, string> = {
  high: "สูง",
  low:  "ต่ำ",
  ood:  "OOD",
};

const LEVEL_COLOR: Record<string, string> = {
  high: "text-green-500",
  low:  "text-yellow-500",
  ood:  "text-red-500",
};

export function EnsembleChart({ comparison }: EnsembleChartProps) {
  // Build topK chart data: rows = species, cols = model confidence
  const allSpecies = [
    ...new Set(comparison.flatMap((m) => m.topK.map((k) => k.name))),
  ];

  const chartData = allSpecies.map((sp) => {
    const row: Record<string, string | number> = { species: sp };
    comparison.forEach((m) => {
      const found = m.topK.find((k) => k.name === sp);
      row[m.modelId] = found ? parseFloat((found.probability * 100).toFixed(1)) : 0;
    });
    return row;
  });

  return (
    <div className="card-surface space-y-5 p-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Trophy className="h-4 w-4 text-accent" />
        <span className="text-sm font-semibold text-foreground">
          เปรียบเทียบ 3 โมเดล
        </span>
        <span className="ml-auto rounded border border-accent/30 bg-accent/5 px-2 py-0.5 font-mono text-[10px] text-accent">
          Ensemble
        </span>
      </div>

      {/* Summary table */}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-left text-xs">
          <thead className="border-b bg-muted/30">
            <tr>
              <th className="px-3 py-2 font-medium text-muted-foreground">โมเดล</th>
              <th className="px-3 py-2 font-medium text-muted-foreground">ทำนาย</th>
              <th className="px-3 py-2 font-medium text-muted-foreground">ความเชื่อมั่น</th>
              <th className="px-3 py-2 font-medium text-muted-foreground">สถานะ</th>
              <th className="px-3 py-2 font-medium text-muted-foreground">ผล</th>
            </tr>
          </thead>
          <tbody>
            {comparison.map((m) => (
              <tr
                key={m.modelId}
                className={`border-b last:border-0 transition-colors ${
                  m.isWinner ? "bg-accent/5" : ""
                }`}
              >
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: MODEL_COLORS[m.modelId] ?? "#94a3b8" }}
                    />
                    <span className="font-medium">{m.model}</span>
                  </div>
                </td>
                <td className="px-3 py-2 font-mono italic">{m.species}</td>
                <td className="px-3 py-2 font-mono font-semibold text-accent">
                  {(m.confidence * 100).toFixed(1)}%
                </td>
                <td className={`px-3 py-2 font-medium ${LEVEL_COLOR[m.confidenceLevel]}`}>
                  {LEVEL_LABEL[m.confidenceLevel]}
                </td>
                <td className="px-3 py-2">
                  {m.isWinner ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent">
                      <Trophy className="h-2.5 w-2.5" />
                      ดีที่สุด
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Bar chart */}
      <div>
        <p className="mb-3 text-xs font-medium text-muted-foreground">
          ความน่าจะเป็นแต่ละชนิด (%)
        </p>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5} />
            <XAxis
              dataKey="species"
              tick={{ fontSize: 10, fontStyle: "italic", fill: "var(--muted-foreground)" }}
              tickFormatter={(v) => `C. ${v}`}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip
              formatter={(val, name) => [`${val}%`, name as string]}
              labelFormatter={(l) => `C. ${l}`}
              contentStyle={{
                fontSize: 11,
                borderRadius: 6,
                background: "var(--popover)",
                border: "1px solid var(--border)",
                color: "var(--popover-foreground)",
              }}
            />
            <Legend
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            />
            <ReferenceLine y={70} stroke="#3b82f6" strokeDasharray="4 3" strokeOpacity={0.5} />
            {comparison.map((m) => (
              <Bar
                key={m.modelId}
                dataKey={m.modelId}
                name={m.model}
                fill={MODEL_COLORS[m.modelId] ?? "#94a3b8"}
                radius={[3, 3, 0, 0]}
                maxBarSize={32}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
        <p className="mt-1 text-center text-[10px] text-muted-foreground">
          เส้นประน้ำเงิน = เกณฑ์ 70%
        </p>
      </div>
    </div>
  );
}
