"use client";

import { useState, useCallback, useEffect, useRef } from "react";

import type { Lang } from "@/lib/i18n";
import {
  ML_MODELS,
  AI_MODELS,
  AI_OFF,
  LLM_SAFE_IMAGE_TYPES,
  type PredictionResult,
  type ChatMessage,
  type HistoryItem,
} from "@/lib/types";
import {
  detectWings,
  chatWithPrediction,
  getHistory,
  uploadImage,
  dataUrlToFile,
  getProvinces,
  resolveAiProvider,
  deleteBlobs,
  type DetectResult,
} from "@/lib/api";
import { levelFromConfidence } from "@/lib/confidence";
import { downscaleImage } from "@/lib/resize-image";
import { drawAnnotatedWing } from "@/lib/annotate";
import type { AnnotatedFeature } from "@/app/api/annotate/route";
import { getDefaultSystemPrompt } from "@/lib/prompts";
import { PROMPT_PACK } from "@/lib/chat-prompts";
import { toPredictionPayload, friendlyChatErrorMessage } from "@/lib/prediction-format";
import {
  perfBeginRun,
  perfEnsureRun,
  perfEndRun,
  perfMeta,
  perfCall,
  perfJson,
  bodyBytes,
} from "@/lib/perf";
import { toast } from "@/components/ui/sonner";

export type NavSection = "upload" | "results" | "chat" | "inspector" | "batch";

/** หนึ่งรูปในคิวตรวจเป็นชุด */
export type BatchItem = {
  /** ไฟล์ที่ย่อแล้วและจะถูกส่งจริง — ต้องเก็บไว้เพื่อเปิดดูภายหลังโดยไม่ย่อซ้ำ */
  file: File | null;
  name: string;
  status: "pending" | "running" | "done" | "error";
  result?: DetectResult;
  error?: string;
  ms?: number;
};

// Controller hook ที่รวม state + business logic ของ workspace ทั้งหมด
// (ML/AI model, ภาพ, ผลทำนาย, คำอธิบาย, แชต, แผนที่การกระจายตัว)
// แยกออกจาก view (page.tsx + components/workspace/*) เพื่อให้ทดสอบ/อ่านง่ายขึ้น
// รับ lang เข้ามาเพื่อใช้ในข้อความ toast/error — ส่วน setLang เป็น UI state ของ shell
/** อ่านไฟล์เป็น data URL — ใช้แสดงภาพที่ "ส่งไปจริง" ให้ตรงกับพิกัดกรอบ */
function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function useCulicoidesAnalysis(lang: Lang) {
  const [mlModel, setMlModel] = useState(ML_MODELS[0].id);
  const [aiModel, setAiModel] = useState(AI_MODELS[0].id);
  const [imagePreview, setImagePreview] = useState<string | null>(null); // data URL
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [result, setResult] = useState<PredictionResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  // ผลตรวจหลายปีก — วิ่งขนานกับ CNN ตัวหลัก ไม่บล็อกกัน
  const [detectResult, setDetectResult] = useState<DetectResult | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);
  // ── ตรวจเป็นชุด (อัปทั้งโฟลเดอร์) ──────────────────────────
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const batchCancelRef = useRef(false);

  // ปีกที่ผู้ใช้เลือกดูอยู่ (null = ดูผลของทั้งภาพตามปกติ)
  const [selectedWingIndex, setSelectedWingIndex] = useState<number | null>(null);
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

  /** ตรวจหลายรูปรวดเดียว — ยิง /api/detect ทีละใบ ครั้งละไม่กี่ใบพร้อมกัน
   *
   *  จงใจไม่ขอ Grad-CAM และไม่เรียก LLM เลย:
   *    - Grad-CAM สร้างภาพจริง 2 ใบต่อปีก 50 รูปก็เป็นร้อยใบ ช้าและกินแรม
   *    - คำอธิบาย AI ราคา ~$0.03-0.08 ต่อครั้ง 50 รูปคือหลายดอลลาร์ต่อการกดปุ่มเดียว
   *  ทั้งสองอย่างเรียกได้ทีหลังตอนกดเปิดดูรูปใดรูปหนึ่ง
   */
  const runBatch = useCallback(
    async (files: File[]) => {
      if (!files.length || isBatchRunning) return;

      batchCancelRef.current = false;
      setIsBatchRunning(true);
      setActiveNav("batch");
      // ปิด AI อัตโนมัติเมื่อเริ่มตรวจเป็นชุด — กันเผลอยิง LLM ทีละหลายสิบครั้ง
      // อยากได้คำอธิบายค่อยกดเปิดดูรูปนั้น แล้วเลือกโมเดล AI จากเมนูซ้าย
      if (aiModel !== AI_OFF) {
        setAiModel(AI_OFF);
        toast.info(
          lang === "th"
            ? "ปิด AI ให้อัตโนมัติระหว่างตรวจเป็นชุด — เปิดดูรูปแล้วเลือกโมเดล AI เมื่อต้องการคำอธิบาย"
            : "AI turned off for batch scanning — open an image and pick an AI model when you want an explanation"
        );
      }
      setBatchItems(
        files.map((f) => ({ file: null, name: f.name, status: "pending" as const }))
      );

      const CONCURRENCY = 3; // มากกว่านี้ HF Space เริ่มคิวยาว
      let cursor = 0;

      const worker = async () => {
        while (cursor < files.length) {
          if (batchCancelRef.current) return;
          const i = cursor++;
          const raw = files[i];

          setBatchItems((prev) =>
            prev.map((it, k) => (k === i ? { ...it, status: "running" } : it))
          );

          const t0 = performance.now();
          try {
            // ย่อด้วยไปป์ไลน์เดียวกับอัปโหลดรูปเดียว — พิกัดกรอบจะได้ตรงกับไฟล์ที่ส่ง
            const r = await downscaleImage(raw);
            if (r.tooLarge) throw new Error("ไฟล์ใหญ่เกินลิมิตอัปโหลด 4.5 MB");
            const det = await detectWings(r.file, false, mlModel);
            if (batchCancelRef.current) return;
            setBatchItems((prev) =>
              prev.map((it, k) =>
                k === i
                  ? { ...it, file: r.file, status: "done", result: det,
                      ms: Math.round(performance.now() - t0) }
                  : it
              )
            );
          } catch (err) {
            if (batchCancelRef.current) return;
            setBatchItems((prev) =>
              prev.map((it, k) =>
                k === i
                  ? { ...it, status: "error",
                      error: err instanceof Error ? err.message : String(err),
                      ms: Math.round(performance.now() - t0) }
                  : it
              )
            );
          }
        }
      };

      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      setIsBatchRunning(false);
    },
    [isBatchRunning, mlModel, aiModel, lang]
  );

  const cancelBatch = useCallback(() => {
    batchCancelRef.current = true;
    setIsBatchRunning(false);
  }, []);

  const clearBatch = useCallback(() => {
    batchCancelRef.current = true;
    setBatchItems([]);
    setIsBatchRunning(false);
  }, []);

  const handleImageSelect = useCallback((file: File, preview: string) => {
    // รูปเก่าเลิกใช้แล้ว — ลบไฟล์ที่แคชไว้บน Blob ทิ้งไปพร้อมกัน
    deleteBlobs([originalImageUrl, heatmapImageUrl]);
    setImageFile(file);
    setImagePreview(preview);
    setResult(null);
    setChatMessages([]);
    setOriginalImageUrl(null);
    setHeatmapImageUrl(null);
    setDetectResult(null);
    setDetectError(null);
    setSelectedWingIndex(null);
    // ต้องมี URL ทั้งสองใน deps ไม่งั้น closure จะค้างค่า null ตั้งแต่ render แรก
    // แล้ว deleteBlobs จะไม่มีอะไรให้ลบเลย
  }, [originalImageUrl, heatmapImageUrl]);

  const handleClearImage = useCallback(() => {
    deleteBlobs([originalImageUrl, heatmapImageUrl]);
    setImageFile(null);
    setImagePreview(null);
    setResult(null);
    setChatMessages([]);
    setProvinces([]);
    setActiveNav("upload");
    setOriginalImageUrl(null);
    setHeatmapImageUrl(null);
    setDetectResult(null);
    setDetectError(null);
    setSelectedWingIndex(null);
  }, [originalImageUrl, heatmapImageUrl]);

  const [isExplaining, setIsExplaining] = useState(false);

  // ── Phase 2: คำอธิบายจาก LLM (ช้า → แยก request) ──────────────
  // รับผลทำนายที่ /predict ตอบกลับมาแล้วค่อยขอคำอธิบาย + annotate ต่างหาก
  // โชว์ loading เฉพาะช่อง AI Explanation (isExplaining) ไม่บล็อกการแสดงผลทำนาย
  // ถูกเรียกทั้งตอนรันครั้งแรก และตอนเปลี่ยน AI model / system prompt
  const runExplanation = useCallback(
    async (
      pred: PredictionResult,
      opts?: {
        freshHeatmap?: boolean;
        systemPrompt?: string;
        /** ส่งภาพปีกที่ครอปแล้วมาแทนภาพทั้งสไลด์ — ใช้ตอนผู้ใช้เลือกดูทีละปีก
         *  ให้ LLM อธิบายเฉพาะปีกตัวนั้น ไม่ใช่ทั้งสไลด์ที่มีหลายชนิดปนกัน */
        imageOverride?: File;
      }
    ) => {
      // โหมดปีก: ไม่แตะ state ภาพหลัก (imagePreview / originalImageUrl / heatmapImageUrl)
      // เพราะภาพทั้งสไลด์ยังต้องแสดงอยู่ และ cache ของมันต้องไม่ถูกเขียนทับด้วยภาพปีก
      const isWing = Boolean(opts?.imageOverride);
      const srcFile = opts?.imageOverride ?? imageFile;
      if (!srcFile) {
        setIsExplaining(false);
        return;
      }
      // ผู้ใช้ปิด AI ไว้ → ข้ามทั้งคำอธิบายและ annotate (ทั้งคู่เรียก LLM)
      // ด่านนี้อยู่จุดเดียว ครอบทุกทางที่เรียก runExplanation ได้หมด
      if (aiModel === AI_OFF) {
        setIsExplaining(false);
        return;
      }

      // ไฟล์ที่อัปขึ้น Blob ในรอบนี้ — ลบทิ้งใน finally หลังใช้เสร็จ
      // เก็บเฉพาะของโหมดปีก เพราะโหมดภาพเต็มแคช URL ไว้ใช้ซ้ำใน state
      const blobsToCleanup: string[] = [];

      const requestId = ++explanationRequestId.current;
      // เรียกจาก handleRunInference → ต่อท้าย run เดิม / เรียกเดี่ยว (สลับภาษา,
      // เปลี่ยนโมเดล AI, apply prompt) → เปิด run ใหม่ให้เอง
      perfEnsureRun("explanation", { aiModel, lang, species: pred.species });

      try {
        setIsExplaining(true);
        // ล้างคำอธิบายรอบก่อนทิ้งก่อนเริ่มรอบใหม่ — ถ้าปล่อยค้างไว้ การ์ดจะโชว์
        // ข้อความเก่าเต็ม ๆ ระหว่างรอ (loader ใหญ่ขึ้นเฉพาะตอนยังไม่มีข้อความ)
        // ทำให้ตอนสลับภาษา/เปลี่ยนโมเดล AI ดูเหมือนไม่มีอะไรเกิดขึ้น
        setResult((prev) => (prev ? { ...prev, explanation: "" } : prev));

        // Reuse the blob URLs from the original inference run instead of
        // re-uploading the same bytes every time the AI model changes.
        const originalUrl = isWing
          ? (await uploadImage(srcFile)).url          // ภาพปีก — อัปใหม่ทุกครั้ง ไม่ใช้/ไม่เขียน cache ของภาพหลัก
          : originalImageUrl ?? (await uploadImage(srcFile)).url;
        if (isWing) blobsToCleanup.push(originalUrl);
        if (!isWing && !originalImageUrl) setOriginalImageUrl(originalUrl);

        // TIFF เป็นฟอร์แมตหลักของ dataset แต่เบราว์เซอร์เรนเดอร์ใน <img>/canvas ไม่ได้
        // (data URL จาก FileReader จึงโชว์เป็นรูปแตก) — /api/upload แปลงเป็น PNG ให้แล้ว
        // จึงสลับมาใช้ URL นั้นเป็นภาพต้นฉบับที่แสดงผลและวาด annotation ทับ
        const renderable = LLM_SAFE_IMAGE_TYPES.has(srcFile.type);
        // ภาพปีกเป็น JPEG ที่ backend ครอปมาให้ เรนเดอร์ได้เสมอ และต้องวาด
        // annotation ทับ "ภาพปีก" ไม่ใช่ภาพทั้งสไลด์
        const previewSrc = isWing ? originalUrl : renderable ? imagePreview : originalUrl;
        if (!isWing && !renderable && imagePreview !== originalUrl) {
          setImagePreview(originalUrl);
        }

        // prediction ใหม่ (รันครั้งแรก / เปลี่ยนโมเดล ML) ได้ Grad-CAM ใหม่
        // จึงต้องอัปโหลด heatmap ใหม่ ไม่ใช้ cache เดิม — ส่วน regenerate
        // (เปลี่ยน AI model, prediction เดิม) ใช้ cache ต่อได้เพื่อไม่อัปโหลดซ้ำ
        const cachedHeatmap = isWing || opts?.freshHeatmap ? null : heatmapImageUrl;
        const heatmapUrl = cachedHeatmap ?? (pred.gradcam
          ? (await uploadImage(dataUrlToFile(pred.gradcam, "gradcam.png"))).url
          : null);
        if (isWing && heatmapUrl) blobsToCleanup.push(heatmapUrl);
        if (!isWing && heatmapUrl && heatmapUrl !== heatmapImageUrl) {
          setHeatmapImageUrl(heatmapUrl);
        }

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
            annotatedImage = await perfCall(`annotate [${pred.species}]`, async (perf) => {
              const body = JSON.stringify({
                imageUrl: originalUrl,
                aiModel,
                provider: resolveAiProvider(aiModel),
                species: pred.species,
              });
              perf.req(bodyBytes(body));

              const annotateRes = await fetch("/api/annotate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body,
              });
              perf.lap("ttfb");

              const { features, annotatedImage: aiImage } = await perfJson<{
                features: AnnotatedFeature[];
                annotatedImage?: string;
              }>(annotateRes, perf);

              if (aiImage) {
                // gpt-image วาด annotation มาเป็นภาพสำเร็จแล้ว (ติดป้าย AI-rendered ในตัว) ใช้ได้เลย
                perf.note(`gpt-image · ${(aiImage.length / 1024 / 1024).toFixed(2)} MB base64`);
                return aiImage;
              }

              // fallback: วาด overlay พิกัดทับภาพจริงเอง
              perf.note(`fallback overlay · ${features.length} features`);
              if (features.length === 0) {
                toast.info(
                  lang === "th"
                    ? "AI ยังไม่สามารถระบุจุดสังเกตบนภาพนี้ได้อัตโนมัติ"
                    : "AI couldn't automatically pinpoint features on this image"
                );
              }
              const drawn = await drawAnnotatedWing(
                previewSrc,
                null,
                pred.species,
                pred.confidence,
                features,
                lang,
              );
              perf.lap("canvas-draw");
              return drawn;
            });
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
        // ถึงตรงนี้ทั้ง LLM และ /api/annotate ดึงภาพจาก URL ไปใช้เรียบร้อยแล้ว
        // ไฟล์บน Blob จึงหมดประโยชน์ ลบทิ้งทันทีไม่ต้องรอ cron
        deleteBlobs(blobsToCleanup);

        if (explanationRequestId.current === requestId) {
          setIsExplaining(false);
          // explanation เป็นขั้นสุดท้ายของทุก run เสมอ → ปิด run ตรงนี้ที่เดียว
          perfEndRun();
        }
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

  // แปลงปีกหนึ่งตัวให้อยู่ในรูป PredictionResult เพื่อส่งต่อให้ทุกส่วนของหน้า
  // (การ์ดผลหลัก, Top-K, Grad-CAM, คำอธิบาย, แผนที่, taxonomy) ใช้ร่วมกันได้เลย
  // โดยไม่ต้องแก้คอมโพเนนต์เหล่านั้นสักตัว
  const wingToPrediction = useCallback(
    (wing: DetectResult["wings"][number], modelUsed?: string): PredictionResult => ({
      species: wing.species ?? "",
      genus: wing.genus ?? "Culicoides",
      confidence: wing.confidence ?? 0,
      topK: wing.topK ?? [],
      confidenceLevel: levelFromConfidence(wing.confidence ?? 0),
      taxonomy: wing.taxonomy ?? {},
      gradcam: wing.gradcam,
      heatmap: wing.heatmap,
      modelUsed: modelUsed ?? null,
      // กราฟเปรียบเทียบโมเดลของ "ปีกตัวนี้" — มาจากโมเดลครอปที่เห็นภาพเดียวกัน
      // ไม่ใช่ผล ensemble ของทั้งสไลด์ ซึ่งจะเป็นคนละภาพกับที่กำลังดูอยู่
      modelComparison:
        wing.models && wing.models.length > 1
          ? wing.models.map((m) => ({
              modelId: m.arch,
              model: m.name,
              species: m.species ?? "unknown",
              confidence: m.confidence ?? 0,
              confidenceLevel: m.accepted
                ? levelFromConfidence(m.confidence ?? 0)
                : ("ood" as const),
              topK: m.topK ?? [],
              isWinner: m.isWinner,
            }))
          : undefined,
    }),
    []
  );

  const handleRunInference = useCallback(
    async (fileOverride?: File) => {
    // ปุ่มบนหน้าเว็บส่ง MouseEvent มาเป็นอาร์กิวเมนต์แรก ต้องเช็กชนิดก่อนเสมอ
    const imageFileToUse = fileOverride instanceof File ? fileOverride : imageFile;
    if (!imageFileToUse) return;

    perfBeginRun("inference", {
      mlModel,
      aiModel,
      lang,
      file: imageFileToUse.name,
      fileMB: +(imageFileToUse.size / 1024 / 1024).toFixed(2),
      fileType: imageFileToUse.type || "unknown",
    });

    // ── Phase 1: หาปีก → จำแนกทีละตัวด้วยโมเดลครอป ──────────────
    // โมเดลครอปเห็น "ปีกที่ครอปมาแล้ว" ซึ่งตรงกับสิ่งที่มันถูกเทรนมา
    // ต่างจากโมเดลภาพเต็มชุดเดิมที่ต้องยัดทั้งสไลด์ลง 224x224
    // แล้วถูกบังคับให้ตอบชนิดเดียวแม้ในภาพจะมีหลายปีกหลายชนิด
    setIsAnalyzing(true);
    setDetectResult(null);
    setDetectError(null);
    setIsDetecting(true);
    setSelectedWingIndex(null);

    let det: DetectResult | null = null;
    try {
      det = await detectWings(imageFileToUse, true, mlModel);
      setDetectResult(det);
    } catch (error) {
      console.error("detect failed:", error);
      setDetectError(error instanceof Error ? error.message : String(error));
      toast.error(friendlyChatErrorMessage(error, lang));
    } finally {
      setIsDetecting(false);
      setIsAnalyzing(false);
    }

    if (!det) {
      perfEndRun();
      return;
    }

    // ปีกที่ผ่านด่านและมั่นใจที่สุด = คำตอบหลัก ถ้ามีหลายปีกผู้ใช้คลิกดูตัวอื่นได้
    let bestIdx = -1;
    let bestConf = -1;
    det.wings.forEach((w, i) => {
      if (w.species && (w.confidence ?? 0) > bestConf) {
        bestConf = w.confidence ?? 0;
        bestIdx = i;
      }
    });

    // หาปีกไม่เจอ หรือเจอแต่ด่าน kNN ปฏิเสธหมด = ไม่น่าใช่ปีก Culicoides
    // ใช้จอ ood เดิมที่หน้าเว็บมีอยู่แล้ว ไม่ต้องทำจอใหม่
    const primary: PredictionResult =
      bestIdx >= 0
        ? wingToPrediction(det.wings[bestIdx], det.modelUsed)
        : {
            species: "",
            genus: "",
            confidence: 0,
            topK: [],
            confidenceLevel: "ood",
            taxonomy: {},
            modelUsed: det.modelUsed,
          };

    if (bestIdx >= 0) setSelectedWingIndex(bestIdx);
    perfMeta({
      species: primary.species,
      confidence: primary.confidence,
      level: primary.confidenceLevel,
      wings: det.wingsDetected,
      answered: det.wingsAnswered,
    });

    setResult(primary);
    setChatMessages([]);
    setActiveNav("results");

    // โหลดประวัติใน background (ไม่เกี่ยวกับผลทำนายปัจจุบัน)
    getHistory(20)
      .then((history) => setHistoryItems(history.items))
      .catch((err) => console.error(err));

    // ไม่มีปีกที่ตอบได้ → ไม่ขอคำอธิบาย/แผนที่/annotate (ไม่เสีย LLM ฟรี)
    if (primary.confidenceLevel === "ood") {
      setIsExplaining(false);
      setProvinces([]);
      perfEndRun();
      return;
    }

    setIsExplaining(true);
    refreshProvinces(primary.species);

    // ── Phase 2: ขอคำอธิบายจาก LLM แยกต่างหาก (ไม่ await ที่นี่) ──
    // ส่ง "ภาพปีกที่ครอปแล้ว" ไปให้ LLM ไม่ใช่ทั้งสไลด์
    const crop = det.wings[bestIdx]?.crop;
    runExplanation(primary, {
      freshHeatmap: true,
      imageOverride: crop ? dataUrlToFile(crop, `wing-${bestIdx + 1}.jpg`) : undefined,
    });
  }, [imageFile, mlModel, aiModel, lang, refreshProvinces, runExplanation, wingToPrediction]);

  /** เปิดรูปจากคิวขึ้นมาดูแบบเต็ม — รันซ้ำเพื่อเอา Grad-CAM (และคำอธิบายถ้าเปิด AI ไว้) */
  const openBatchItem = useCallback(
    async (index: number) => {
      const item = batchItems[index];
      if (!item?.file) return;
      const preview = await readFileAsDataUrl(item.file);
      setImageFile(item.file);
      setImagePreview(preview);
      setResult(null);
      setChatMessages([]);
      setOriginalImageUrl(null);
      setHeatmapImageUrl(null);
      setDetectResult(null);
      setDetectError(null);
      setSelectedWingIndex(null);
      await handleRunInference(item.file);
    },
    // handleRunInference ถูกประกาศก่อนหน้านี้แล้ว
    [batchItems, handleRunInference]
  );


  const wingCropFile = useCallback(
    (index: number): File | undefined => {
      const crop = detectResult?.wings[index]?.crop;
      return crop ? dataUrlToFile(crop, `wing-${index + 1}.jpg`) : undefined;
    },
    [detectResult]
  );

  // เลือกดูปีกทีละตัว — คำอธิบาย AI, แผนที่, taxonomy, Grad-CAM จะตามปีกตัวนั้น
  // ส่ง index = null เพื่อกลับไปดูผลของทั้งภาพ
  const selectWing = useCallback(
    (index: number | null) => {
      // ระบบเลิกใช้โมเดลภาพเต็มแล้ว จึงไม่มีผล "ทั้งภาพ" ให้ย้อนกลับไปดู
      // คลิกได้แค่สลับไปดูปีกตัวอื่น
      if (index === null) return;

      const wing = detectResult?.wings[index];
      // ปีกที่ด่านปฏิเสธไม่มีชนิด จึงไม่มีอะไรให้อธิบาย
      if (!wing || !wing.species) return;

      setSelectedWingIndex(index);
      const pred = wingToPrediction(wing, detectResult?.modelUsed);
      setResult(pred);
      refreshProvinces(pred.species);
      setIsExplaining(true);
      // ส่ง "ภาพปีกที่ครอปแล้ว" ให้ LLM แทนทั้งสไลด์ ไม่งั้นมันจะอธิบายภาพที่มีหลายชนิดปนกัน
      runExplanation(pred, { imageOverride: wingCropFile(index), freshHeatmap: true });
    },
    [detectResult, refreshProvinces, runExplanation, wingToPrediction, wingCropFile]
  );

  // สร้างคำอธิบายใหม่โดยใช้ผลทำนาย/ภาพเดิม แต่ ai_model หรือ systemPrompt อาจเปลี่ยนไป
  // (เช่น กดเปลี่ยนโมเดล AI หรือแก้ system prompt) — ใช้ phase 2 ตัวเดียวกับตอนรันครั้งแรก
  const regenerateExplanation = useCallback(() => {
    if (!result || !imageFile) return;
    if (result.confidenceLevel === "ood") return; // ไม่น่าจะใช่ Culicoides — ไม่ต้องอธิบาย
    // ถ้ากำลังดูรายปีกอยู่ ต้องส่งภาพปีกไปด้วย ไม่งั้นสลับโมเดล AI ทีเดียว
    // คำอธิบายจะเด้งกลับไปอธิบายทั้งสไลด์เงียบ ๆ
    const override = selectedWingIndex != null ? wingCropFile(selectedWingIndex) : undefined;
    return runExplanation(result, override ? { imageOverride: override } : undefined);
  }, [result, imageFile, runExplanation, selectedWingIndex, wingCropFile]);

  // เปลี่ยนโมเดล AI แล้วสร้างคำอธิบายใหม่ + แผนที่การกระจายตัวใหม่ (ใช้ prediction เดิม)
  useEffect(() => {
    if (result?.confidenceLevel === "ood") return; // ไม่น่าจะใช่ Culicoides — ไม่สร้างใหม่
    regenerateExplanation();
    // refreshProvinces ยังเรียกได้ตอนปิด AI — ฝั่ง API จะหยุดที่ฐานข้อมูล ไม่ยิง LLM
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
    const langOverride =
      selectedWingIndex != null ? wingCropFile(selectedWingIndex) : undefined;
    runExplanation(result, {
      systemPrompt: nextPrompt,
      ...(langOverride ? { imageOverride: langOverride } : {}),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  const handleResetSystemPrompt = useCallback(() => {
    setSystemPrompt(getDefaultSystemPrompt(lang));
  }, [lang]);

  const handleChatSend = useCallback(
    async (message: string) => {
      // แชตก็เรียก LLM — ปิด AI ไว้แล้วต้องไม่ยิง บอกผู้ใช้ให้เลือกโมเดลก่อน
      if (aiModel === AI_OFF) {
        toast.info(
          lang === "th"
            ? "ตอนนี้ปิด AI อยู่ — เลือกโมเดล AI จากเมนูด้านซ้ายก่อนถึงจะแชตได้"
            : "AI is turned off — pick an AI model from the sidebar to chat"
        );
        return;
      }
      const nextUserMessage = { role: "user" as const, content: message };
      setChatMessages((prev) => [...prev, nextUserMessage]);
      setIsChatLoading(true);
      perfBeginRun("chat", { aiModel, lang, message, historyLen: chatMessages.length });

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
            mapProvinces: res.mapProvinces,
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
        perfEndRun();
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
    // ตรวจหลายปีก (วิ่งขนานกับ result)
    detectResult,
    isDetecting,
    detectError,
    selectedWingIndex,
    selectWing,
    // ตรวจเป็นชุด
    batchItems,
    isBatchRunning,
    runBatch,
    cancelBatch,
    clearBatch,
    openBatchItem,
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
