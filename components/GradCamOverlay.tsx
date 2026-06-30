"use client";

import { motion } from "framer-motion";
import { RotateCcw, Layers } from "lucide-react";

interface GradCamOverlayProps {
  imageSrc: string;
  visible: boolean;
  label?: string;
  onClear?: () => void;
}

export function GradCamOverlay({ imageSrc, label = "Grad-CAM++", onClear }: GradCamOverlayProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
      className="card-surface overflow-hidden"
    >
      <div className="flex items-center gap-2 px-4 py-2.5">
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/10">
          <Layers className="h-3.5 w-3.5 text-accent" />
        </div>
        <span className="text-xs font-medium text-foreground">{label}</span>

        {onClear && (
          <button
            onClick={onClear}
            className="ml-auto flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Re-upload
          </button>
        )}
      </div>

      <div className="flex min-h-[58vh] items-center justify-center bg-muted/20 p-4">
        <img
          src={imageSrc}
          alt="Grad-CAM++ result"
          className="max-h-[80vh] w-auto max-w-full rounded-md object-contain shadow-sm"
        />
      </div>
    </motion.div>
  );
}
