"use client";

import { motion } from "framer-motion";
import {
  Bug,
  BarChart3,
  RotateCcw,
  Printer,
  Loader2,
  Layers,
  Map,
  Upload,
  SearchX,
  CheckCircle,
  AlertTriangle,
  XCircle,
} from "lucide-react";

import type { Lang } from "@/lib/i18n";
import type { CulicoidesAnalysis } from "@/hooks/useCulicoidesAnalysis";
import { GradCamCompare } from "@/components/GradCamCompare";
import { ResultsPanel } from "@/components/ResultsPanel";
import { TaxonomyTree } from "@/components/TaxonomyTree";
import { ExplanationBlock } from "@/components/ExplanationBlock";
import { ThailandMap } from "@/components/ThailandMap";
import { EnsembleChart } from "@/components/EnsembleChart";

interface Props {
  analysis: CulicoidesAnalysis;
  lang: Lang;
  t: Record<string, string>;
}

export function ResultsSection({ analysis, lang, t }: Props) {
  const {
    result,
    mlModel,
    selectedAiName,
    selectedMlName,
    handleClearImage,
    isAnalyzing,
    imagePreview,
    provinces,
    isMapLoading,
    isExplaining,
    setActiveNav,
  } = analysis;

  const isOod = result?.confidenceLevel === "ood";

  const heroStatusByLevel = {
    high: {
      icon: CheckCircle,
      ring: "stroke-success",
      text: "text-success",
      badge: "border-success/30 bg-success/10",
      label: t.confidenceHigh,
    },
    low: {
      icon: AlertTriangle,
      ring: "stroke-warning",
      text: "text-warning",
      badge: "border-warning/30 bg-warning/10",
      label: t.confidenceLow,
    },
    ood: {
      icon: XCircle,
      ring: "stroke-destructive",
      text: "text-destructive",
      badge: "border-destructive/30 bg-destructive/10",
      label: t.notSandfly,
    },
  } as const;

  return (
    <>
      {/* Print-only report header */}
      {result && !isOod && (
        <div className="hidden print:block print:mb-6">
          <div className="flex items-center gap-2 text-lg font-bold">
            <Bug className="h-5 w-5" />
            Culicoides AI — รายงานผลการวิเคราะห์
          </div>
          <p className="mt-1 text-xs text-gray-500">
            สร้างเมื่อ {new Date().toLocaleString("th-TH")} · โมเดล ML: {mlModel} · โมเดล AI: {selectedAiName}
          </p>
          <hr className="mt-3 border-gray-300" />
        </div>
      )}

      {!isOod && (
      <div className="flex items-start justify-between gap-3 print:hidden">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-accent" />
            {lang === "th" ? "ผลการวิเคราะห์" : "Analysis Results"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {lang === "th"
              ? "ผลลัพธ์จากการวิเคราะห์ภาพด้วย ML model"
              : "Results from ML model image analysis"}
          </p>
        </div>

        {result && (
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={handleClearImage}
              className="flex items-center gap-1.5 rounded-md border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {lang === "th" ? "อัปโหลดใหม่" : "Re-upload"}
            </button>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 rounded-md border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
            >
              <Printer className="h-3.5 w-3.5" />
              {lang === "th" ? "พิมพ์ / บันทึก PDF" : "Print / Save as PDF"}
            </button>
          </div>
        )}
      </div>
      )}

      {result && isAnalyzing && (
        <div className="flex items-center gap-2.5 rounded-lg border border-accent/40 bg-accent/5 px-4 py-3 text-sm font-medium text-accent print:hidden">
          <Loader2 className="h-4 w-4 animate-spin" />
          {lang === "th"
            ? `กำลังวิเคราะห์รูปเดิมใหม่ด้วย ${selectedMlName}...`
            : `Re-analyzing image with ${selectedMlName}...`}
        </div>
      )}

      {result ? (
        isOod ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
            className="card-surface flex min-h-[60vh] flex-col items-center justify-center gap-6 p-8 text-center"
          >
            <div className="relative flex h-24 w-24 items-center justify-center">
              <span className="absolute h-full w-full rounded-full bg-warning/10" />
              <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-warning/10 ring-1 ring-warning/25">
                <SearchX className="h-9 w-9 text-warning" />
              </div>
            </div>

            <div className="space-y-2">
              <h2 className="text-2xl font-semibold text-foreground">
                {lang === "th" ? "ไม่น่าจะใช่ Culicoides" : "Probably not a Culicoides"}
              </h2>
              <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
                {lang === "th"
                  ? "โมเดลไม่มั่นใจว่าภาพนี้เป็นปีกริ้น Culicoides จึงไม่แสดงผลการจำแนก — ลองอัปโหลดภาพปีกที่ชัดและเต็มเฟรมขึ้น"
                  : "The model isn't confident this is a Culicoides wing, so no identification is shown — try a clearer, well-framed wing image."}
              </p>
              {result && (
                <p className="text-xs text-muted-foreground/70">
                  {lang === "th" ? "ความเชื่อมั่น" : "Confidence"} {(result.confidence * 100).toFixed(1)}%
                </p>
              )}
            </div>

            {imagePreview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imagePreview}
                alt="uploaded"
                className="max-h-40 rounded-lg border border-border/60 object-contain opacity-80"
              />
            )}

            <button
              onClick={handleClearImage}
              className="mt-1 flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90"
            >
              <Upload className="h-4 w-4" />
              {lang === "th" ? "อัปโหลดภาพใหม่" : "Upload a new image"}
            </button>
          </motion.div>
        ) : (
        <>
          {(() => {
            const status = heroStatusByLevel[result.confidenceLevel];
            const StatusIcon = status.icon;
            const circumference = 2 * Math.PI * 42;

            return (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
                className="relative overflow-hidden rounded-xl border bg-card p-6"
              >
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-accent/10 via-transparent to-transparent" />

                <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-2.5">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${status.badge} ${status.text}`}
                    >
                      <StatusIcon className="h-3.5 w-3.5" />
                      {status.label}
                    </span>
                    <h2 className="text-2xl font-semibold italic text-foreground sm:text-3xl">
                      Culicoides {result.species}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {t.genus}:{" "}
                      <span className="font-medium not-italic text-foreground">
                        {result.genus}
                      </span>
                      {result.modelUsed && (
                        <>
                          {" "}
                          ·{" "}
                          <span className="font-mono text-xs">{result.modelUsed}</span>
                        </>
                      )}
                    </p>
                  </div>

                  <div className="relative flex h-28 w-28 shrink-0 items-center justify-center self-center">
                    <svg viewBox="0 0 100 100" className="h-28 w-28 -rotate-90">
                      <circle
                        cx="50"
                        cy="50"
                        r="42"
                        strokeWidth="8"
                        className="fill-none stroke-secondary"
                      />
                      <motion.circle
                        cx="50"
                        cy="50"
                        r="42"
                        strokeWidth="8"
                        strokeLinecap="round"
                        className={`fill-none ${status.ring}`}
                        style={{ strokeDasharray: circumference }}
                        initial={{ strokeDashoffset: circumference }}
                        animate={{
                          strokeDashoffset:
                            circumference * (1 - result.confidence),
                        }}
                        transition={{ duration: 0.8, ease: [0.2, 0, 0, 1] }}
                      />
                    </svg>
                    <div className="absolute flex flex-col items-center">
                      <span className="tabular text-xl font-bold text-foreground">
                        {(result.confidence * 100).toFixed(0)}%
                      </span>
                      <span className="text-[9px] uppercase tracking-wide text-muted-foreground">
                        {t.confidence}
                      </span>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })()}

          <ResultsPanel
            result={result}
            labels={t as unknown as Record<string, string>}
          />

          {imagePreview && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/10">
                  <Layers className="h-3.5 w-3.5 text-accent" />
                </div>
                <span className="text-sm font-medium text-foreground">
                  {lang === "th"
                    ? "เปรียบเทียบภาพ — Grad-CAM++"
                    : "Image Comparison — Grad-CAM++"}
                </span>
              </div>
              <GradCamCompare
                original={imagePreview}
                heatmap={result?.heatmap}
                gradcam={result?.gradcam}
              />
            </div>
          )}

          {result.modelComparison && result.modelComparison.length > 0 && (
            <div>
              <EnsembleChart
                comparison={result.modelComparison}
              />
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-1">
            <TaxonomyTree taxonomy={result.taxonomy} label={t.taxonomy} />

            <ExplanationBlock
              text={result?.explanation ?? ""}
              label=""
              aiModel={selectedAiName}
              isLoading={isExplaining}
              annotatedImage={result?.annotatedImage}
            />

            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/10">
                  <Map className="h-3.5 w-3.5 text-accent" />
                </div>
                <span className="text-sm font-medium text-foreground">
                  {lang === "th" ? "แผนที่การกระจายตัว" : "Distribution Map"}
                </span>
              </div>
              <ThailandMap
                highlightedProvinces={provinces}
                species={result.species}
                isLoading={isMapLoading}
              />
            </div>
          </div>
        </>
        )
      ) : (
        <div className="card-surface flex min-h-[58vh] flex-col items-center justify-center gap-3">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/10">
            <BarChart3 className="h-8 w-8 text-accent/60" />
          </div>
          <p className="max-w-xs text-center text-sm text-muted-foreground">
            {lang === "th"
              ? "ยังไม่มีผลการวิเคราะห์ กรุณาอัปโหลดภาพก่อน"
              : "No results yet. Please upload an image first."}
          </p>
          <button
            onClick={() => setActiveNav("upload")}
            className="mt-1 flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-xs font-medium text-accent-foreground transition-colors hover:bg-accent/90"
          >
            <Upload className="h-3.5 w-3.5" />
            {lang === "th" ? "ไปอัปโหลดภาพ" : "Go to Upload"}
          </button>
        </div>
      )}
    </>
  );
}
