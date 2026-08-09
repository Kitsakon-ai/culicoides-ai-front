"use client";

import { useState, useCallback, useEffect, useRef } from "react";

import type { Lang } from "@/lib/i18n";
import {
  ML_MODELS,
  AI_MODELS,
  LLM_SAFE_IMAGE_TYPES,
  type PredictionResult,
  type ChatMessage,
  type HistoryItem,
} from "@/lib/types";
import {
  predictImage,
  chatWithPrediction,
  getHistory,
  uploadImage,
  dataUrlToFile,
  getProvinces,
  resolveAiProvider,
} from "@/lib/api";
import { drawAnnotatedWing } from "@/lib/annotate";
import { getDefaultSystemPrompt } from "@/lib/prompts";
import { PROMPT_PACK } from "@/lib/chat-prompts";
import { toPredictionPayload, friendlyChatErrorMessage } from "@/lib/prediction-format";
import { toast } from "@/components/ui/sonner";

export type NavSection = "upload" | "results" | "chat" | "inspector";

// Controller hook ที่รวม state + business logic ของ workspace ทั้งหมด
// (ML/AI model, ภาพ, ผลทำนาย, คำอธิบาย, แชต, แผนที่การกระจายตัว)
// แยกออกจาก view (page.tsx + components/workspace/*) เพื่อให้ทดสอบ/อ่านง่ายขึ้น
// รับ lang เข้ามาเพื่อใช้ในข้อความ toast/error — ส่วน setLang เป็น UI state ของ shell
export function useCulicoidesAnalysis(lang: Lang) {
  const [mlModel, setMlModel] = useState(ML_MODELS[0].id);
  const [aiModel, setAiModel] = useState(AI_MODELS[0].id);
  const [imagePreview, setImagePreview] = useState<string | null>(null); // data URL
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [result, setResult] = useState<PredictionResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [activeNav, setActiveNav] = useState<NavSection>("upload");
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [provinces, setProvinces] = useState<string[]>([]);
  const [isMapLoading, setIsMapLoading] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState(() => getDefaultSystemPrompt(lang));
  const explanationRequestId = useRef(0);
  // ภาษาของรอบก่อน — ใช้ตรวจว่า system prompt ที่ค้างอยู่ยังเป็น default ของภาษาเดิม
  // (แปลว่าผู้ใช้ไม่ได้แก้เอง → สลับเป็น default ภาษาใหม่ได้) หรือถูกแก้ไปแล้ว (ต้องเก็บไว้)
  const prevLangRef = useRef(lang);

  // ── Uploaded blob URL cache ──────────────────────────────────
  // uploadImage() writes to Vercel Blob storage (1GB cap on Hobby plan).
  // Re-uploading the same original photo / gradcam heatmap on every AI-model
  // switch or chat message burns through that quota fast — cache the URLs
  // per image instead and only re-upload when the image actually changes.
  const [originalImageUrl, setOriginalImageUrl] = useState<string | null>(null);
  const [heatmapImageUrl, setHeatmapImageUrl] = useState<string | null>(null);

  const handleImageSelect = useCallback((file: File, preview: string) => {
    setImageFile(file);
    setImagePreview(preview);
    setResult(null);
    setChatMessages([]);
    setOriginalImageUrl(null);
    setHeatmapImageUrl(null);
  }, []);

  const handleClearImage = useCallback(() => {
    setImageFile(null);
    setImagePreview(null);
    setResult(null);
    setChatMessages([]);
    setProvinces([]);
    setActiveNav("upload");
    setOriginalImageUrl(null);
    setHeatmapImageUrl(null);
  }, []);

  const [isExplaining, setIsExplaining] = useState(false);

  // ── Phase 2: คำอธิบายจาก LLM (ช้า → แยก request) ──────────────
  // รับผลทำนายที่ /predict ตอบกลับมาแล้วค่อยขอคำอธิบาย + annotate ต่างหาก
  // โชว์ loading เฉพาะช่อง AI Explanation (isExplaining) ไม่บล็อกการแสดงผลทำนาย
  // ถูกเรียกทั้งตอนรันครั้งแรก และตอนเปลี่ยน AI model / system prompt
  const runExplanation = useCallback(
    async (
      pred: PredictionResult,
      opts?: { freshHeatmap?: boolean; systemPrompt?: string }
    ) => {
      if (!imageFile) {
        setIsExplaining(false);
        return;
      }

      const requestId = ++explanationRequestId.current;

      try {
        setIsExplaining(true);
        // ล้างคำอธิบายรอบก่อนทิ้งก่อนเริ่มรอบใหม่ — ถ้าปล่อยค้างไว้ การ์ดจะโชว์
        // ข้อความเก่าเต็ม ๆ ระหว่างรอ (loader ใหญ่ขึ้นเฉพาะตอนยังไม่มีข้อความ)
        // ทำให้ตอนสลับภาษา/เปลี่ยนโมเดล AI ดูเหมือนไม่มีอะไรเกิดขึ้น
        setResult((prev) => (prev ? { ...prev, explanation: "" } : prev));

        // Reuse the blob URLs from the original inference run instead of
        // re-uploading the same bytes every time the AI model changes.
        const originalUrl = originalImageUrl ?? (await uploadImage(imageFile)).url;
        if (!originalImageUrl) setOriginalImageUrl(originalUrl);

        // TIFF เป็นฟอร์แมตหลักของ dataset แต่เบราว์เซอร์เรนเดอร์ใน <img>/canvas ไม่ได้
        // (data URL จาก FileReader จึงโชว์เป็นรูปแตก) — /api/upload แปลงเป็น PNG ให้แล้ว
        // จึงสลับมาใช้ URL นั้นเป็นภาพต้นฉบับที่แสดงผลและวาด annotation ทับ
        const renderable = LLM_SAFE_IMAGE_TYPES.has(imageFile.type);
        const previewSrc = renderable ? imagePreview : originalUrl;
        if (!renderable && imagePreview !== originalUrl) setImagePreview(originalUrl);

        // prediction ใหม่ (รันครั้งแรก / เปลี่ยนโมเดล ML) ได้ Grad-CAM ใหม่
        // จึงต้องอัปโหลด heatmap ใหม่ ไม่ใช้ cache เดิม — ส่วน regenerate
        // (เปลี่ยน AI model, prediction เดิม) ใช้ cache ต่อได้เพื่อไม่อัปโหลดซ้ำ
        const cachedHeatmap = opts?.freshHeatmap ? null : heatmapImageUrl;
        const heatmapUrl = cachedHeatmap ?? (pred.gradcam
          ? (await uploadImage(dataUrlToFile(pred.gradcam, "gradcam.png"))).url
          : null);
        if (heatmapUrl && heatmapUrl !== heatmapImageUrl) setHeatmapImageUrl(heatmapUrl);

        const L = PROMPT_PACK[lang];
        let streamed = "";
        const explainRes = await chatWithPrediction({
          message: L.explanation.request,
          ai_model: aiModel,
          mode: "explanation",
          lang,
          prediction: toPredictionPayload(pred),
          // ตอนเพิ่งสลับภาษา state systemPrompt ยังไม่อัปเดตในรอบนี้ → รับเป็น override มาแทน
          systemPrompt: opts?.systemPrompt ?? systemPrompt,
          xai: {
            highlightedRegions: L.xai.explanationRegions,
            confidenceDrivers: L.xai.explanationDrivers,
            warningFlags:
              pred.confidenceLevel === "low" || pred.confidenceLevel === "ood"
                ? [L.xai.preliminaryFlag]
                : [],
          },
          images: {
            original: originalUrl,
            heatmap: heatmapUrl ?? null,
          },
        }, (delta) => {
          // stream คำอธิบายลงการ์ดแบบ real-time (เห็นข้อความไหลออกมาเรื่อย ๆ)
          if (explanationRequestId.current !== requestId) return;
          streamed += delta;
          setResult((prev) => (prev ? { ...prev, explanation: streamed } : prev));
        });

        if (explanationRequestId.current !== requestId) return;

        let annotatedImage: string | null = null;
        try {
          if (previewSrc) {
            const annotateRes = await fetch("/api/annotate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                imageUrl: originalUrl,
                aiModel,
                provider: resolveAiProvider(aiModel),
                species: pred.species,
              }),
            });
            const { features, annotatedImage: aiImage } = await annotateRes.json();
            if (aiImage) {
              // gpt-image วาด annotation มาเป็นภาพสำเร็จแล้ว (ติดป้าย AI-rendered ในตัว) ใช้ได้เลย
              annotatedImage = aiImage;
            } else {
              // fallback: วาด overlay พิกัดทับภาพจริงเอง
              if (features.length === 0) {
                toast.info(
                  lang === "th"
                    ? "AI ยังไม่สามารถระบุจุดสังเกตบนภาพนี้ได้อัตโนมัติ"
                    : "AI couldn't automatically pinpoint features on this image"
                );
              }
              annotatedImage = await drawAnnotatedWing(
                previewSrc,
                null,
                pred.species,
                pred.confidence,
                features,
                lang,
              );
            }
          }
        } catch {
          // annotation is optional — silently skip on failure
        }

        if (explanationRequestId.current !== requestId) return;

        // คำอธิบายแสดงในการ์ด ExplanationBlock ด้านบนแล้ว ไม่ต้อง seed ลงแชต (กันซ้ำ)
        setResult((prev) =>
          prev ? { ...prev, explanation: explainRes.answer, annotatedImage } : prev
        );
      } catch (error) {
        console.error(error);
        if (explanationRequestId.current !== requestId) return;

        const message = friendlyChatErrorMessage(error, lang);
        toast.error(message);

        // แสดง error ในการ์ดคำอธิบายด้านบน (ไม่ต้อง seed ลงแชต)
        // ล้างรูป annotation ของรอบก่อนทิ้งด้วย — กันภาพเก่าค้างข้าง error สด
        setResult((prev) => (prev ? { ...prev, explanation: message, annotatedImage: null } : prev));
      } finally {
        if (explanationRequestId.current === requestId) setIsExplaining(false);
      }
    },
    [imageFile, aiModel, systemPrompt, imagePreview, lang, originalImageUrl, heatmapImageUrl]
  );

  // โหลดจังหวัดที่คาดว่าพบ (แผนที่การกระจายตัว) — ขึ้นกับ species + AI model
  // จึงต้องเรียกซ้ำทั้งตอนได้ผลทำนายใหม่ และตอนเปลี่ยน AI model
  const refreshProvinces = useCallback(
    (species: string) => {
      setIsMapLoading(true);
      getProvinces(species, aiModel)
        .then((res) => setProvinces(res.provinces))
        .catch(() => setProvinces([]))
        .finally(() => setIsMapLoading(false));
    },
    [aiModel]
  );

  const handleRunInference = useCallback(async () => {
    if (!imageFile) return;

    // ── Phase 1: CNN + Grad-CAM++ (เร็ว) ───────────────────────
    // ตอบผลทำนายกลับมาแล้วโชว์ทันที ไม่รอ LLM — ถ้า LLM ล่ม/timeout
    // ผลทายที่ได้แล้วจะยังอยู่ ไม่หายไปทั้งก้อน
    setIsAnalyzing(true);
    let data: PredictionResult | null = null;
    try {
      data = await predictImage(imageFile, mlModel);
    } catch (error) {
      console.error(error);
      toast.error(friendlyChatErrorMessage(error, lang));
    } finally {
      setIsAnalyzing(false);
    }

    if (!data) return;

    // แสดง species + heatmap + confidence ทันที แล้วสลับไปหน้าผลลัพธ์
    // ตั้ง isExplaining ตั้งแต่ตรงนี้ กันจอ AI Explanation กระพริบก่อน phase 2 เริ่ม
    setResult(data);
    setChatMessages([]);
    setActiveNav("results");

    // โหลดประวัติใน background (ไม่เกี่ยวกับผลทำนายปัจจุบัน)
    getHistory(20)
      .then((history) => setHistoryItems(history.items))
      .catch((err) => console.error(err));

    // ต่ำกว่าเกณฑ์ ood → ไม่น่าจะใช่ Culicoides: ไม่ขอคำอธิบาย/แผนที่/annotate (ไม่เสีย LLM ฟรี)
    if (data.confidenceLevel === "ood") {
      setIsExplaining(false);
      setProvinces([]);
      return;
    }

    setIsExplaining(true);
    refreshProvinces(data.species);

    // ── Phase 2: ขอคำอธิบายจาก LLM แยกต่างหาก (ไม่ await ที่นี่) ──
    // freshHeatmap: prediction ใหม่ → Grad-CAM ใหม่ ต้องอัปโหลด heatmap ใหม่
    runExplanation(data, { freshHeatmap: true });
  }, [imageFile, mlModel, lang, refreshProvinces, runExplanation]);

  // สร้างคำอธิบายใหม่โดยใช้ผลทำนาย/ภาพเดิม แต่ ai_model หรือ systemPrompt อาจเปลี่ยนไป
  // (เช่น กดเปลี่ยนโมเดล AI หรือแก้ system prompt) — ใช้ phase 2 ตัวเดียวกับตอนรันครั้งแรก
  const regenerateExplanation = useCallback(() => {
    if (!result || !imageFile) return;
    if (result.confidenceLevel === "ood") return; // ไม่น่าจะใช่ Culicoides — ไม่ต้องอธิบาย
    return runExplanation(result);
  }, [result, imageFile, runExplanation]);

  // เปลี่ยนโมเดล AI แล้วสร้างคำอธิบายใหม่ + แผนที่การกระจายตัวใหม่ (ใช้ prediction เดิม)
  useEffect(() => {
    if (result?.confidenceLevel === "ood") return; // ไม่น่าจะใช่ Culicoides — ไม่สร้างใหม่
    regenerateExplanation();
    if (result) refreshProvinces(result.species);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiModel]);

  // เปลี่ยนโมเดล ML แล้ววิเคราะห์รูปเดิมใหม่ด้วยโมเดลที่เลือก
  // (เฉพาะเมื่อมีผลอยู่แล้ว — ถ้ายังไม่เคยรัน ให้รอผู้ใช้กด Run เอง)
  useEffect(() => {
    if (result && imageFile) handleRunInference();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mlModel]);

  // เปลี่ยนภาษา UI → คำอธิบาย/แชตต้องเปลี่ยนตามด้วย ไม่ใช่แค่ตัวหนังสือบนหน้าจอ
  // ถ้าผู้ใช้ยังไม่ได้แก้ system prompt เอง ให้สลับไป default ของภาษาใหม่ แล้วสร้างคำอธิบายใหม่
  // (ส่ง prompt เป็น override เพราะ setState ยังไม่มีผลภายในรอบ effect นี้)
  useEffect(() => {
    const prev = prevLangRef.current;
    if (prev === lang) return;
    prevLangRef.current = lang;

    const nextPrompt =
      systemPrompt.trim() === getDefaultSystemPrompt(prev).trim()
        ? getDefaultSystemPrompt(lang)
        : systemPrompt;
    if (nextPrompt !== systemPrompt) setSystemPrompt(nextPrompt);

    if (!result || !imageFile) return;
    if (result.confidenceLevel === "ood") return; // ไม่น่าจะใช่ Culicoides — ไม่ต้องอธิบาย
    runExplanation(result, { systemPrompt: nextPrompt });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  const handleResetSystemPrompt = useCallback(() => {
    setSystemPrompt(getDefaultSystemPrompt(lang));
  }, [lang]);

  const handleChatSend = useCallback(
    async (message: string) => {
      const nextUserMessage = { role: "user" as const, content: message };
      setChatMessages((prev) => [...prev, nextUserMessage]);
      setIsChatLoading(true);

      try {
        // Reuse the cached blob URLs from the original inference run instead
        // of re-uploading the same photo/heatmap on every chat message.
        let originalUrl = originalImageUrl;
        if (!originalUrl && imageFile) {
          originalUrl = (await uploadImage(imageFile)).url;
          setOriginalImageUrl(originalUrl);
        }

        let heatmapUrl = heatmapImageUrl;
        if (!heatmapUrl && result?.gradcam) {
          heatmapUrl = (await uploadImage(dataUrlToFile(result.gradcam, "gradcam.png"))).url;
          setHeatmapImageUrl(heatmapUrl);
        }

        let streamed = "";
        let started = false;
        const L = PROMPT_PACK[lang];
        const res = await chatWithPrediction({
          message,
          ai_model: aiModel,
          mode: "vision",
          lang,
          prediction: result ? toPredictionPayload(result) : null,
          // ตัด imageUrl (base64) ออกจาก history ที่ส่งไป backend เพราะ backend ใช้แค่ content
          // และถ้าส่งไปเต็มๆ หลังสร้างภาพไปหลายรูป payload จะใหญ่เกิน Vercel function limit (FUNCTION_PAYLOAD_TOO_LARGE)
          history: [...chatMessages, nextUserMessage].map(({ role, content }) => ({ role, content })),
          xai: {
            highlightedRegions: L.xai.chatRegions,
            confidenceDrivers: L.xai.chatDrivers,
            warningFlags:
              result?.confidenceLevel === "low" || result?.confidenceLevel === "ood"
                ? [L.xai.preliminaryFlag]
                : [],
          },
          images: {
            original: originalUrl ?? null,
            heatmap: heatmapUrl ?? null,
          },
        }, (delta) => {
          streamed += delta;
          if (!started) {
            // token แรกมาถึง — ปิด typing dots แล้วเริ่มโชว์ bubble ที่ค่อย ๆ โต
            started = true;
            setIsChatLoading(false);
            setChatMessages((prev) => [...prev, { role: "assistant", content: streamed }]);
          } else {
            setChatMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = { ...updated[updated.length - 1], content: streamed };
              return updated;
            });
          }
        });

        // สรุปข้อความ assistant + แนบรูปที่สร้าง (ถ้ามี) — คำขอสร้างรูปตอบกลับเป็น
        // JSON ก้อนเดียวไม่มี token stream (started === false) จึง append ใหม่แทน
        setChatMessages((prev) => {
          const msg = {
            role: "assistant" as const,
            content: res.answer || streamed,
            imageUrl: res.imageUrl,
            imageError: res.imageError,
          };
          if (!started) return [...prev, msg];
          const updated = [...prev];
          updated[updated.length - 1] = msg;
          return updated;
        });
      } catch (error) {
        console.error(error);
        const content = friendlyChatErrorMessage(error, lang);
        toast.error(content);
        setChatMessages((prev) => [...prev, { role: "assistant", content }]);
      } finally {
        setIsChatLoading(false);
      }
    },
    [aiModel, result, chatMessages, imageFile, lang, originalImageUrl, heatmapImageUrl]
  );

  const selectedAiName = AI_MODELS.find((m) => m.id === aiModel)?.name ?? "";
  const selectedMlName = ML_MODELS.find((m) => m.id === mlModel)?.name ?? mlModel;

  useEffect(() => {
    getHistory(20)
      .then((res) => setHistoryItems(res.items))
      .catch((err) => console.error(err));
  }, []);

  return {
    // model selection
    mlModel,
    setMlModel,
    aiModel,
    setAiModel,
    selectedAiName,
    selectedMlName,
    // image + result
    imagePreview,
    result,
    isAnalyzing,
    isExplaining,
    // chat
    chatMessages,
    setChatMessages,
    isChatLoading,
    // navigation
    activeNav,
    setActiveNav,
    // history + distribution map
    historyItems,
    provinces,
    isMapLoading,
    // system prompt
    systemPrompt,
    setSystemPrompt,
    // actions
    handleImageSelect,
    handleClearImage,
    handleRunInference,
    regenerateExplanation,
    handleResetSystemPrompt,
    handleChatSend,
  };
}

export type CulicoidesAnalysis = ReturnType<typeof useCulicoidesAnalysis>;
