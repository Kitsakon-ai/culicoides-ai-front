"use client";

import { motion } from "framer-motion";
import { Image as ImageIcon, Flame, Layers } from "lucide-react";

interface GradCamCompareProps {
  original: string;
  heatmap?: string | null;
  gradcam?: string | null;
}

export function GradCamCompare({ original, heatmap, gradcam }: GradCamCompareProps) {
  const items = [
    { key: "original", label: "ภาพต้นฉบับ", icon: ImageIcon, src: original },
    { key: "heatmap", label: "Heatmap", icon: Flame, src: heatmap },
    { key: "gradcam", label: "Grad-CAM++", icon: Layers, src: gradcam },
  ].filter((item): item is { key: string; label: string; icon: typeof ImageIcon; src: string } =>
    Boolean(item.src)
  );

  return (
    <div className="space-y-3">
      <div
        className={`grid gap-3 ${
          items.length >= 3
            ? "sm:grid-cols-3"
            : items.length === 2
            ? "sm:grid-cols-2"
            : "grid-cols-1"
        }`}
      >
        {items.map((item, i) => (
          <motion.div
            key={item.key}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: i * 0.08 }}
            className="card-surface overflow-hidden"
          >
            <div className="flex items-center gap-1.5 px-3 py-2">
              <item.icon className="h-3.5 w-3.5 text-accent" />
              <span className="text-xs font-medium text-foreground">{item.label}</span>
            </div>
            <div
              className="flex items-center justify-center bg-muted/20"
              style={{ height: 220 }}
            >
              <img src={item.src} alt={item.label} className="h-full w-full object-contain" />
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
