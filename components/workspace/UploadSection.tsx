"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Microscope, Loader2, Play } from "lucide-react";

import type { Lang } from "@/lib/i18n";
import type { CulicoidesAnalysis } from "@/hooks/useCulicoidesAnalysis";
import { ImageUpload } from "@/components/ImageUpload";
import { ModelLatencyTable } from "@/components/ModelLatencyTable";

interface Props {
  analysis: CulicoidesAnalysis;
  lang: Lang;
  t: Record<string, string>;
}

export function UploadSection({ analysis, lang, t }: Props) {
  const {
    isAnalyzing,
    handleImageSelect,
    handleClearImage,
    result,
    imagePreview,
    mlModel,
    handleRunInference,
    aiModel,
  } = analysis;

  return (
    <>
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Microscope className="h-5 w-5 text-accent" />
          {t.upload}
        </h1>
        <p className="text-sm text-muted-foreground">{t.subtitle}</p>
      </div>

      <div className={`grid gap-4 ${isAnalyzing ? "md:grid-cols-2" : "grid-cols-1"}`}>
        <ImageUpload
          label={t.upload}
          hint={t.uploadHint}
          onImageSelect={handleImageSelect}
          onClear={handleClearImage}
          // มีผลแล้วให้โชว์ dropzone เปล่า อัปโหลดภาพใหม่ได้ทันทีเมื่อกลับมาหน้านี้
          // (ภาพต้นฉบับ + Grad-CAM ของผลเดิมแสดงอยู่หน้าผลลัพธ์แล้ว)
          preview={result ? null : imagePreview}
        />

        <AnimatePresence>
          {isAnalyzing && (
            <motion.div
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 16 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col justify-center rounded-xl border border-accent/40 bg-accent/5 p-5 space-y-4"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10">
                  <Loader2 className="h-5 w-5 animate-spin text-accent" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {lang === "th" ? "กำลังวิเคราะห์ภาพ" : "Analyzing image"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {lang === "th" ? "กรุณารอสักครู่..." : "Please wait..."}
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                {(mlModel === "ensemble"
                  ? [
                      lang === "th" ? "รัน EfficientNet-B0" : "Running EfficientNet-B0",
                      lang === "th" ? "รัน ResNet-50" : "Running ResNet-50",
                      lang === "th" ? "รัน DenseNet-121" : "Running DenseNet-121",
                      lang === "th" ? "เปรียบเทียบ & เลือกผลดีที่สุด" : "Comparing & selecting best",
                      lang === "th" ? "ขอคำอธิบายจาก AI" : "Requesting AI explanation",
                    ]
                  : [
                      lang === "th" ? "ส่งภาพไปยัง ML model" : "Sending to ML model",
                      lang === "th" ? "สร้าง Grad-CAM heatmap" : "Generating Grad-CAM",
                      lang === "th" ? "ขอคำอธิบายจาก AI" : "Requesting AI explanation",
                    ]
                ).map((step, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.12 }}
                    className="flex items-center gap-2.5 rounded-lg bg-background/60 px-3 py-2 text-xs text-muted-foreground"
                  >
                    <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent/60" />
                    {step}
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {imagePreview && !result && (
        <div className="flex justify-end md:hidden">
          <button
            onClick={handleRunInference}
            disabled={isAnalyzing}
            className="flex items-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-60"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t.analyzing}
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" />
                {t.runInference}
              </>
            )}
          </button>
        </div>
      )}

      <ModelLatencyTable currentAiModel={aiModel} />
    </>
  );
}
