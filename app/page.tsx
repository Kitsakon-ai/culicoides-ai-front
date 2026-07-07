"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  Play,
  Loader2,
  Upload,
  BarChart3,
  MessageSquare,
  Settings2,
  Bug,
  ChevronRight,
  Microscope,
  Map,
  Layers,
  Printer,
  CheckCircle,
  AlertTriangle,
  XCircle,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import { TEXT, type Lang } from "@/lib/i18n";
import {
  ML_MODELS,
  AI_MODELS,
  AI_PROVIDER_ORDER,
  AI_PROVIDER_LABEL,
  type PredictionResult,
  type ChatMessage,
  type HistoryItem,
} from "@/lib/types";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { LanguageToggle } from "@/components/LanguageToggle";
import { ModelSelector } from "@/components/ModelSelector";
import { ImageUpload } from "@/components/ImageUpload";
import { GradCamOverlay } from "@/components/GradCamOverlay";
import { GradCamCompare } from "@/components/GradCamCompare";
import { ResultsPanel } from "@/components/ResultsPanel";
import { TaxonomyTree } from "@/components/TaxonomyTree";
import { ExplanationBlock } from "@/components/ExplanationBlock";
import { ChatPanel } from "@/components/ChatPanel";
import { InspectorPanel } from "@/components/InspectorPanel";
import { HistoryPanel } from "@/components/HistoryPanel";
import { ThailandMap } from "@/components/ThailandMap";
import { EnsembleChart } from "@/components/EnsembleChart";
import { ModelLatencyTable } from "@/components/ModelLatencyTable";

import {
  predictImage,
  chatWithPrediction,
  getHistory,
  uploadImage,
  dataUrlToFile,
  getProvinces,
} from "@/lib/api";
import { drawAnnotatedWing } from "@/lib/annotate";
import { DEFAULT_AI_SYSTEM_PROMPT } from "@/lib/prompts";

type NavSection = "upload" | "results" | "chat" | "inspector";

export default function Index() {
  const [lang, setLang] = useState<Lang>("th");
  const t = TEXT[lang];

  const [mlModel, setMlModel] = useState(ML_MODELS[0].id);
  const [aiModel, setAiModel] = useState(AI_MODELS[0].id);
  const [imagePreview, setImagePreview] = useState<string | null>(null); // data URL
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [result, setResult] = useState<PredictionResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [activeNav, setActiveNav] = useState<NavSection>("upload");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [provinces, setProvinces] = useState<string[]>([]);
  const [isMapLoading, setIsMapLoading] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_AI_SYSTEM_PROMPT);
  const explanationRequestId = useRef(0);

  const handleImageSelect = useCallback((file: File, preview: string) => {
    setImageFile(file);
    setImagePreview(preview);
    setResult(null);
    setChatMessages([]);
  }, []);

  const handleClearImage = useCallback(() => {
    setImageFile(null);
    setImagePreview(null);
    setResult(null);
    setChatMessages([]);
    setProvinces([]);
    setActiveNav("upload");
  }, []);

  const handleRunInference = useCallback(async () => {
    if (!imageFile) return;

    try {
      setIsAnalyzing(true);

      const data = await predictImage(imageFile, mlModel);

      const originalUpload = await uploadImage(imageFile);

      const heatmapUpload = data.gradcam
        ? await uploadImage(dataUrlToFile(data.gradcam, "gradcam.png"))
        : null;

      const explainRes = await chatWithPrediction({
        message:
          "ช่วยอธิบายผล Explainable AI โดยเน้นลักษณะของปีกจากภาพต้นฉบับร่วมกับ heatmap ตอบ 3-5 บรรทัด",
        ai_model: aiModel,
        mode: "explanation",
        prediction: data,
        systemPrompt,
        xai: {
          highlightedRegions: ["กลางปีก", "ขอบปีก", "ลำตัว"],
          confidenceDrivers: [
            "Grad-CAM เน้นบริเวณปีกเป็นหลัก",
            "ลักษณะบริเวณปีกสอดคล้องกับชนิดที่ทำนาย",
          ],
          warningFlags:
            data.confidenceLevel === "low" || data.confidenceLevel === "ood"
              ? ["ผลยังเป็นเบื้องต้น"]
              : [],
        },
        images: {
          original: originalUpload.url,
          heatmap: heatmapUpload?.url ?? null,
        },
      });

      let annotatedImage: string | null = null;
      try {
        const annotateRes = await fetch("/api/annotate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageUrl: originalUpload.url,
            aiModel,
          }),
        });
        const { features } = await annotateRes.json();
        annotatedImage = await drawAnnotatedWing(
          imagePreview!,
          null,
          data.species,
          data.confidence,
          features,
        );
      } catch {
        // annotation is optional — silently skip on failure
      }

      setResult({
        ...data,
        explanation: explainRes.answer,
        annotatedImage,
      });

      setChatMessages([{ role: "assistant", content: explainRes.answer }]);
      setActiveNav("results");

      const history = await getHistory(20);
      setHistoryItems(history.items);

      // โหลดแผนที่การกระจายตัวใน background
      setIsMapLoading(true);
      getProvinces(data.species, aiModel)
        .then((res) => setProvinces(res.provinces))
        .catch(() => setProvinces([]))
        .finally(() => setIsMapLoading(false));
    } catch (error: any) {
      console.error(error);
      alert(error.message || "เกิดข้อผิดพลาด");
    } finally {
      setIsAnalyzing(false);
    }
  }, [imageFile, mlModel, aiModel, systemPrompt]);

  const [isExplaining, setIsExplaining] = useState(false);

  // สร้างคำอธิบายใหม่โดยใช้ผลทำนาย/ภาพ/taxonomy เดิม แต่ ai_model หรือ systemPrompt อาจเปลี่ยนไป
  const regenerateExplanation = useCallback(async () => {
    if (!result || !imageFile) return;

    const requestId = ++explanationRequestId.current;

    try {
      setIsExplaining(true);

      const originalUpload = await uploadImage(imageFile);
      const heatmapUpload = result.gradcam
        ? await uploadImage(dataUrlToFile(result.gradcam, "gradcam.png"))
        : null;

      const explainRes = await chatWithPrediction({
        message:
          "ช่วยอธิบายผล Explainable AI โดยเน้นลักษณะของปีกจากภาพต้นฉบับร่วมกับ heatmap ตอบ 3-5 บรรทัด",
        ai_model: aiModel,
        mode: "explanation",
        prediction: result,
        systemPrompt,
        xai: {
          highlightedRegions: ["กลางปีก", "ขอบปีก", "ลำตัว"],
          confidenceDrivers: [
            "Grad-CAM เน้นบริเวณปีกเป็นหลัก",
            "ลักษณะบริเวณปีกสอดคล้องกับชนิดที่ทำนาย",
          ],
          warningFlags:
            result.confidenceLevel === "low" || result.confidenceLevel === "ood"
              ? ["ผลยังเป็นเบื้องต้น"]
              : [],
        },
        images: {
          original: originalUpload.url,
          heatmap: heatmapUpload?.url ?? null,
        },
      });

      if (explanationRequestId.current !== requestId) return;

      let annotatedImage: string | null = null;
      try {
        if (imagePreview) {
          const annotateRes = await fetch("/api/annotate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              imageUrl: originalUpload.url,
              aiModel,
            }),
          });
          const { features } = await annotateRes.json();
          annotatedImage = await drawAnnotatedWing(
            imagePreview,
            null,
            result.species,
            result.confidence,
            features,
          );
        }
      } catch { /* optional */ }

      if (explanationRequestId.current !== requestId) return;

      setResult((prev) =>
        prev ? { ...prev, explanation: explainRes.answer, annotatedImage } : prev
      );

      // ข้อความแรกในแชต (คำอธิบายที่ทักมาอัตโนมัติ) อัปเดตตาม — ส่วนบทสนทนาถัดจากนั้นคงเดิม
      setChatMessages((prev) => {
        if (prev.length === 0 || prev[0].role !== "assistant") return prev;
        const updated = [...prev];
        updated[0] = { ...updated[0], content: explainRes.answer };
        return updated;
      });
    } catch (error) {
      console.error(error);
    } finally {
      if (explanationRequestId.current === requestId) setIsExplaining(false);
    }
  }, [result, imageFile, aiModel, systemPrompt, imagePreview]);

  // เปลี่ยนโมเดล AI แล้วให้สร้างคำอธิบายใหม่อัตโนมัติ
  useEffect(() => {
    regenerateExplanation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiModel]);

  const handleResetSystemPrompt = useCallback(() => {
    setSystemPrompt(DEFAULT_AI_SYSTEM_PROMPT);
  }, []);

  const handleChatSend = useCallback(
    async (message: string) => {
      const nextUserMessage = { role: "user" as const, content: message };
      setChatMessages((prev) => [...prev, nextUserMessage]);
      setIsChatLoading(true);

      try {
        const originalUpload = imageFile
          ? await uploadImage(imageFile)
          : null;

        const heatmapUpload =
          result?.gradcam
            ? await uploadImage(dataUrlToFile(result.gradcam, "gradcam.png"))
            : null;

        const res = await chatWithPrediction({
          message,
          ai_model: aiModel,
          mode: "vision",
          prediction: result,
          history: [...chatMessages, nextUserMessage],
          xai: {
            highlightedRegions: ["wing", "body"],
            confidenceDrivers: [
              "Grad-CAM เน้นบริเวณปีก",
              "โมเดลให้คะแนนชนิดนี้สูงสุดใน top-k",
            ],
            warningFlags:
              result?.confidenceLevel === "low" || result?.confidenceLevel === "ood"
                ? ["ผลยังเป็นเบื้องต้น"]
                : [],
          },
          images: {
            original: originalUpload?.url ?? null,
            heatmap: heatmapUpload?.url ?? null,
          },
        });

        setChatMessages((prev) => [
          ...prev,
          { role: "assistant", content: res.answer, imageUrl: res.imageUrl },
        ]);
      } catch (error) {
        console.error(error);
        setChatMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: lang === "th" ? "เกิดข้อผิดพลาดในการแชท" : "Chat error",
          },
        ]);
      } finally {
        setIsChatLoading(false);
      }
    },
    [aiModel, result, chatMessages, imageFile, lang]
  );

  const selectedAiName = AI_MODELS.find((m) => m.id === aiModel)?.name ?? "";

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

  const navItems: { id: NavSection; label: string; icon: React.ElementType }[] = [
    { id: "upload", label: lang === "th" ? "อัปโหลด" : "Upload", icon: Upload },
    { id: "results", label: lang === "th" ? "ผลลัพธ์" : "Results", icon: BarChart3 },
    { id: "chat", label: lang === "th" ? "แชท AI" : "AI Chat", icon: MessageSquare },
    { id: "inspector", label: "Inspector", icon: Settings2 },
  ];

  useEffect(() => {
    getHistory(20)
      .then((res) => setHistoryItems(res.items))
      .catch((err) => console.error(err));
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-background print:h-auto print:overflow-visible">
      <aside
        className={`hidden md:flex md:flex-col flex-shrink-0 border-r bg-background transition-all duration-200 print:hidden ${sidebarOpen ? "w-60" : "w-0 overflow-hidden"
          }`}
      >
        <div className="flex h-14 items-center gap-2.5 border-b px-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-accent-foreground">
            <Bug className="h-4 w-4" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-foreground">Culicoides AI</span>
            <span className="text-[10px] text-muted-foreground">Research</span>
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          <p className="label-caps mb-2 px-3">Workspace</p>
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveNav(item.id)}
              className={`next-nav-item w-full ${activeNav === item.id ? "next-nav-item-active" : ""
                }`}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="border-t p-3 space-y-4">
          <ModelSelector
            label={t.selectMl}
            models={ML_MODELS}
            selectedId={mlModel}
            onSelect={setMlModel}
          />
          <ModelSelector
            label={t.selectAi}
            models={AI_MODELS}
            selectedId={aiModel}
            onSelect={setAiModel}
          />
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 flex-shrink-0 items-center justify-between px-4 md:px-6 print:hidden">
          <div className="flex items-center gap-2">
            <button
              className="md:hidden flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:text-foreground"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              <Bug className="h-4 w-4" />
            </button>

            <div className="flex items-center gap-1.5 text-sm">
              <span className="text-muted-foreground">Culicoides AI</span>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
              <span className="font-medium text-foreground">
                {navItems.find((n) => n.id === activeNav)?.label}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <LanguageToggle lang={lang} onChange={setLang} />

            {imagePreview && !result && (
              <button
                onClick={handleRunInference}
                disabled={isAnalyzing}
                className="hidden md:flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-60"
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
            )}
          </div>
        </header>
        <div className="flex md:hidden border-b overflow-x-auto print:hidden">
          <div className="md:hidden border-b px-4 py-3 space-y-3 bg-background">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                {t.selectMl}
              </label>
              <select
                value={mlModel}
                onChange={(e) => setMlModel(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {ML_MODELS.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                {t.selectAi}
              </label>
              <Select value={aiModel} onValueChange={setAiModel}>
                <SelectTrigger className="w-full text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AI_PROVIDER_ORDER.map((provider) => {
                    const items = AI_MODELS.filter((m) => m.provider === provider);
                    if (!items.length) return null;
                    return (
                      <SelectGroup key={provider}>
                        <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                          {AI_PROVIDER_LABEL[provider]}
                        </SelectLabel>
                        {items.map((m) => (
                          <SelectItem key={m.id} value={m.id} className="text-sm">
                            {m.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="flex md:hidden border-b overflow-x-auto print:hidden">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveNav(item.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors border-b-2 whitespace-nowrap ${activeNav === item.id
                ? "border-accent text-foreground"
                : "border-transparent text-muted-foreground"
                }`}
            >
              <item.icon className="h-3.5 w-3.5" />
              {item.label}
            </button>
          ))}
        </div>

        <main className="flex-1 overflow-y-auto print:overflow-visible">
          <div className="mx-auto max-w-7xl p-4 md:p-8 print:max-w-none print:p-0">
            <AnimatePresence mode="wait">
              {activeNav === "upload" && (
                <motion.div
                  key="upload"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-6"
                >
                  <div className="space-y-1">
                    <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
                      <Microscope className="h-5 w-5 text-accent" />
                      {t.upload}
                    </h1>
                    <p className="text-sm text-muted-foreground">{t.subtitle}</p>
                  </div>

                  <div className={`grid gap-4 ${isAnalyzing ? "md:grid-cols-2" : "grid-cols-1"}`}>
                    {imagePreview && result ? (
                      <GradCamOverlay
                        imageSrc={(result?.gradcam ?? imagePreview)!}
                        visible={true}
                        label="Grad-CAM++"
                        onClear={handleClearImage}
                      />
                    ) : (
                      <ImageUpload
                        label={t.upload}
                        hint={t.uploadHint}
                        onImageSelect={handleImageSelect}
                        onClear={handleClearImage}
                        preview={imagePreview}
                      />
                    )}

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
                </motion.div>
              )}

              {activeNav === "results" && (
                <motion.div
                  key="results"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-8"
                >
                  {/* Print-only report header */}
                  {result && (
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
                      <button
                        onClick={() => window.print()}
                        className="flex shrink-0 items-center gap-1.5 rounded-md border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
                      >
                        <Printer className="h-3.5 w-3.5" />
                        {lang === "th" ? "พิมพ์ / บันทึก PDF" : "Print / Save as PDF"}
                      </button>
                    )}
                  </div>

                  {result ? (
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
                            bestModel={result.bestModel ?? ""}
                          />
                        </div>
                      )}

                      <div className="grid gap-6 lg:grid-cols-1">
                        <TaxonomyTree taxonomy={result.taxonomy} label={t.taxonomy} />

                        <ExplanationBlock
                          text={
                            result?.explanation ||
                            (lang === "th" ? "ยังไม่มีคำอธิบายจาก AI" : "No AI explanation yet.")
                          }
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
                </motion.div>
              )}

              {activeNav === "chat" && (
                <motion.div
                  key="chat"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-6"
                >
                  <div className="space-y-1">
                    <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
                      <MessageSquare className="h-5 w-5 text-accent" />
                      {t.chat}
                    </h1>
                    <p className="text-sm text-muted-foreground">
                      {lang === "th"
                        ? `ใช้ ${selectedAiName} เพื่อตอบคำถามเกี่ยวกับผลการวิเคราะห์`
                        : `Using ${selectedAiName} to answer questions about analysis results`}
                    </p>
                  </div>

                  <ChatPanel
                    messages={chatMessages}
                    onSend={handleChatSend}
                    onClear={() => setChatMessages([])}
                    labels={t as unknown as Record<string, string>}
                    isLoading={isChatLoading}
                  />
                </motion.div>
              )}

              {activeNav === "inspector" && (
                <motion.div
                  key="inspector"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-6"
                >
                  <div className="space-y-1">
                    <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
                      <Settings2 className="h-5 w-5 text-accent" />
                      Inspector
                    </h1>
                    <p className="text-sm text-muted-foreground">
                      {lang === "th"
                        ? "ข้อมูลทางเทคนิค, parameters, และ API logs"
                        : "Technical details, parameters, and API logs"}
                    </p>
                  </div>

                  <InspectorPanel
                    selectedMlModel={mlModel}
                    selectedAiModel={aiModel}
                    result={result}
                    labels={t as unknown as Record<string, string>}
                    systemPrompt={systemPrompt}
                    defaultSystemPrompt={DEFAULT_AI_SYSTEM_PROMPT}
                    onSystemPromptChange={setSystemPrompt}
                    onResetSystemPrompt={handleResetSystemPrompt}
                    onApplySystemPrompt={regenerateExplanation}
                    isApplyingSystemPrompt={isExplaining}
                  />
                  <HistoryPanel items={historyItems} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </main>
      </div>

    </div>
  );
}