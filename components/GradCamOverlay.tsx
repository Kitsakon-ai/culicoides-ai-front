"use client";

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { RotateCcw } from "lucide-react";

interface GradCamOverlayProps {
  imageSrc: string;
  visible: boolean;
  label?: string;
  onClear?: () => void;
}

function drawHeatmap(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const spots = [
    { x: w * 0.45, y: h * 0.4, r: w * 0.22, intensity: 0.85 },
    { x: w * 0.55, y: h * 0.5, r: w * 0.18, intensity: 0.7 },
    { x: w * 0.35, y: h * 0.55, r: w * 0.12, intensity: 0.5 },
    { x: w * 0.6, y: h * 0.35, r: w * 0.1, intensity: 0.4 },
  ];

  const imageData = ctx.createImageData(w, h);
  const data = imageData.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let val = 0;
      for (const spot of spots) {
        const dx = x - spot.x;
        const dy = y - spot.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const falloff = Math.max(0, 1 - dist / spot.r);
        val += falloff * falloff * spot.intensity;
      }
      val = Math.min(1, val);

      let r = 0, g = 0, b = 0;
      if (val < 0.25) {
        b = 255;
        g = Math.round(val * 4 * 255);
      } else if (val < 0.5) {
        g = 255;
        b = Math.round((1 - (val - 0.25) * 4) * 255);
      } else if (val < 0.75) {
        g = 255;
        r = Math.round((val - 0.5) * 4 * 255);
      } else {
        r = 255;
        g = Math.round((1 - (val - 0.75) * 4) * 255);
      }

      const idx = (y * w + x) * 4;
      const alpha = Math.round(val * 160);
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = alpha;
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

export function GradCamOverlay({ imageSrc, visible, label = "Grad-CAM", onClear }: GradCamOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!visible) return;
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;

    const render = () => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (ctx) drawHeatmap(ctx, w, h);
    };

    if (img.complete) {
      render();
    } else {
      img.onload = render;
    }
  }, [visible, imageSrc]);

  return (
    <div className="relative">
      <div className="card-surface overflow-hidden">
        <div className="relative" style={{ maxHeight: 360 }}>
          <img
            ref={imgRef}
            src={imageSrc}
            alt="Uploaded insect"
            className="w-full object-contain"
            style={{ maxHeight: 360 }}
          />
          {visible && (
            <motion.canvas
              ref={canvasRef}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6 }}
              className="absolute inset-0 h-full w-full object-contain mix-blend-normal pointer-events-none"
              style={{ maxHeight: 360 }}
            />
          )}
        </div>
      </div>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute left-2 top-2 flex items-center gap-1.5 rounded-md border bg-background/80 px-2 py-1 text-[10px] font-medium text-foreground backdrop-blur-sm"
        >
          <span className="inline-block h-2 w-2 rounded-full bg-destructive" />
          {label}
        </motion.div>
      )}
      {onClear && (
        <button
          onClick={onClear}
          className="absolute right-2 top-2 flex items-center gap-1 rounded-md border bg-background/80 px-2.5 py-1 text-[10px] font-medium text-foreground transition-colors hover:bg-secondary backdrop-blur-sm"
        >
          <RotateCcw className="h-3 w-3" />
          <span className="hidden sm:inline">Re-upload</span>
        </button>
      )}
    </div>
  );
}
