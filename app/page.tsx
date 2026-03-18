"use client";

import { useState, useCallback, useEffect } from "react";
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
  Cpu,
  Sparkles,
  GitBranch,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import { TEXT, type Lang } from "@/lib/i18n";
import {
  ML_MODELS,
  AI_MODELS,
  type PredictionResult,
  type ChatMessage,
  type HistoryItem,
} from "@/lib/types";

import { LanguageToggle } from "@/components/LanguageToggle";
import { ModelSelector } from "@/components/ModelSelector";
import { ImageUpload } from "@/components/ImageUpload";
import { GradCamOverlay } from "@/components/GradCamOverlay";
import { ResultsPanel } from "@/components/ResultsPanel";
import { TaxonomyTree } from "@/components/TaxonomyTree";
import { ExplanationBlock } from "@/components/ExplanationBlock";
import { ChatPanel } from "@/components/ChatPanel";
import { InspectorPanel } from "@/components/InspectorPanel";
import { HistoryPanel } from "@/components/HistoryPanel";

import {
  predictImage,
  chatWithPrediction,
  getHistory,
  uploadImage,
  dataUrlToFile,
} from "@/lib/api";

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

      setResult({
        ...data,
        explanation: explainRes.answer,
      });

      setChatMessages([{ role: "assistant", content: explainRes.answer }]);
      setActiveNav("results");

      const history = await getHistory(20);
      setHistoryItems(history.items);
    } catch (error: any) {
      console.error(error);
      alert(error.message || "เกิดข้อผิดพลาด");
    } finally {
      setIsAnalyzing(false);
    }
  }, [imageFile, mlModel, aiModel]);

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
          { role: "assistant", content: res.answer },
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
    <div className="flex h-screen overflow-hidden bg-background">
      <aside
        className={`hidden md:flex md:flex-col flex-shrink-0 border-r bg-background transition-all duration-200 ${
          sidebarOpen ? "w-60" : "w-0 overflow-hidden"
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
              className={`next-nav-item w-full ${
                activeNav === item.id ? "next-nav-item-active" : ""
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
        <header className="flex h-14 flex-shrink-0 items-center justify-between border-b px-4 md:px-6">
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
                className="flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-60"
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

        <div className="flex md:hidden border-b overflow-x-auto">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveNav(item.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors border-b-2 whitespace-nowrap ${
                activeNav === item.id
                  ? "border-accent text-foreground"
                  : "border-transparent text-muted-foreground"
              }`}
            >
              <item.icon className="h-3.5 w-3.5" />
              {item.label}
            </button>
          ))}
        </div>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl p-4 md:p-8">
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

                  {imagePreview && result ? (
                    <GradCamOverlay
                      imageSrc={(result?.gradcam ?? imagePreview)!}
                      visible={true}
                      label="Grad-CAM"
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

                  {result ? (
                    <>
                      <div className="grid gap-6 lg:grid-cols-2">
                        <div className="space-y-4">
                          <div className="flex items-center gap-2 mb-2">
                            <Cpu className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm font-medium text-foreground">
                              {lang === "th" ? "ผลการจำแนก" : "Classification"}
                            </span>
                          </div>
                          <ResultsPanel
                            result={result}
                            labels={t as unknown as Record<string, string>}
                          />
                        </div>

                        {imagePreview && (
                          <div className="space-y-4">
                            <div className="flex items-center gap-2 mb-2">
                              <Microscope className="h-4 w-4 text-muted-foreground" />
                              <span className="text-sm font-medium text-foreground">Grad-CAM</span>
                            </div>
                            <GradCamOverlay
                              imageSrc={result?.gradcam ?? imagePreview ?? ""}
                              visible={true}
                              label="Grad-CAM"
                              onClear={handleClearImage}
                            />
                          </div>
                        )}
                      </div>

                      <div className="grid gap-6 lg:grid-cols-2">
                        <div>
                          <div className="flex items-center gap-2 mb-3">
                            <GitBranch className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm font-medium text-foreground">
                              {t.taxonomy}
                            </span>
                          </div>
                          <TaxonomyTree taxonomy={result.taxonomy} label="" />
                        </div>

                        <div>
                          <div className="flex items-center gap-2 mb-3">
                            <Sparkles className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm font-medium text-foreground">
                              {t.explanation}
                            </span>
                          </div>
                          <ExplanationBlock
                            text={
                              result?.explanation ||
                              (lang === "th" ? "ยังไม่มีคำอธิบายจาก AI" : "No AI explanation yet.")
                            }
                            label=""
                            aiModel={selectedAiName}
                          />
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="card-surface flex flex-col items-center justify-center py-20">
                      <BarChart3 className="h-8 w-8 text-muted-foreground/30 mb-3" />
                      <p className="text-sm text-muted-foreground">
                        {lang === "th"
                          ? "ยังไม่มีผลการวิเคราะห์ กรุณาอัปโหลดภาพก่อน"
                          : "No results yet. Please upload an image first."}
                      </p>
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