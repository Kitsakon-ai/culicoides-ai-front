"use client";

// ── ตรวจเป็นชุด: อัปทั้งโฟลเดอร์แล้วไล่ตรวจทีละรูป ─────────────────────
// ใช้ /api/detect อย่างเดียว ไม่แตะ LLM เลย จึงไม่เสียโทเคนแม้อัปเป็นร้อยรูป
// (Grad-CAM กับคำอธิบาย AI ค่อยขอตอนกดเปิดดูรูปใดรูปหนึ่ง)

import { useMemo, useRef, useState } from "react";
import { FolderOpen, Loader2, Download, X, Trash2, ChevronRight } from "lucide-react";

import type { Lang } from "@/lib/i18n";
import type { CulicoidesAnalysis } from "@/hooks/useCulicoidesAnalysis";

interface Props {
  analysis: CulicoidesAnalysis;
  lang: Lang;
}

const SPECIES_COLOR: Record<string, string> = {
  guttifer: "#2a78d6",
  mahasarakhamense: "#eb6834",
  oxystoma: "#1baf7a",
  peregrinus: "#eda100",
};

const IMAGE_EXT = /\.(jpe?g|png|tiff?|bmp|webp)$/i;

export function BatchSection({ analysis, lang }: Props) {
  const th = lang === "th";
  const {
    batchItems,
    isBatchRunning,
    runBatch,
    cancelBatch,
    clearBatch,
    openBatchItem,
    mlModel,
  } = analysis;

  const folderRef = useRef<HTMLInputElement | null>(null);
  const filesRef = useRef<HTMLInputElement | null>(null);
  const [opening, setOpening] = useState<number | null>(null);

  const done = batchItems.filter((b) => b.status === "done").length;
  const failed = batchItems.filter((b) => b.status === "error").length;
  const cancelled = batchItems.filter((b) => b.status === "cancelled").length;
  const total = batchItems.length;
  // รูปที่ถูกยกเลิกนับเป็น "จบแล้ว" ด้วย ไม่งั้นแถบความคืบหน้าจะค้างไม่ถึง 100%
  // ทั้งที่ไม่มีอะไรทำงานอยู่แล้ว
  const pct = total ? Math.round(((done + failed + cancelled) / total) * 100) : 0;

  // สรุปรวมทั้งชุด — นับ "จำนวนปีก" ไม่ใช่จำนวนรูป เพราะหนึ่งรูปมีได้หลายปีก
  const summary = useMemo(() => {
    const perSpecies: Record<string, number> = {};
    let wings = 0;
    let answered = 0;
    let imagesWithNothing = 0;
    for (const b of batchItems) {
      if (b.status !== "done" || !b.result) continue;
      wings += b.result.wingsDetected;
      answered += b.result.wingsAnswered;
      if (b.result.wingsAnswered === 0) imagesWithNothing++;
      for (const w of b.result.wings) {
        if (w.species) perSpecies[w.species] = (perSpecies[w.species] ?? 0) + 1;
      }
    }
    return { perSpecies, wings, answered, imagesWithNothing };
  }, [batchItems]);

  const pick = (list: FileList | null) => {
    if (!list) return;
    const files = Array.from(list).filter((f) => IMAGE_EXT.test(f.name));
    if (files.length) void runBatch(files);
  };

  /** CSV หนึ่งแถวต่อหนึ่งปีก — เอาไปทำตารางในเล่มวิจัยได้ตรง ๆ */
  const downloadCsv = () => {
    const head = [
      "file", "wing", "species", "confidence", "accepted",
      "knnDistance", "knnRadius", "x0", "y0", "x1", "y1",
      "wingsDetected", "wingsAnswered", "modelUsed",
    ];
    const rows: string[][] = [];
    for (const b of batchItems) {
      if (b.status !== "done" || !b.result) {
        rows.push([b.name, "", "", "", "", "", "", "", "", "", "",
                   "", "", b.status === "error" ? `ERROR: ${b.error ?? ""}` : b.status]);
        continue;
      }
      if (!b.result.wings.length) {
        rows.push([b.name, "0", "", "", "", "", "", "", "", "", "",
                   "0", "0", b.result.modelUsed]);
        continue;
      }
      b.result.wings.forEach((w, i) => {
        rows.push([
          b.name, String(i + 1), w.species ?? "unknown",
          w.confidence != null ? w.confidence.toFixed(4) : "",
          String(w.accepted), w.knnDistance.toFixed(4), w.knnRadius.toFixed(4),
          String(w.box[0]), String(w.box[1]), String(w.box[2]), String(w.box[3]),
          String(b.result!.wingsDetected), String(b.result!.wingsAnswered),
          b.result!.modelUsed,
        ]);
      });
    }
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const csv = [head, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
    // BOM เพื่อให้ Excel บน Windows อ่านภาษาไทยไม่เป็นขยะ
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `culicoides-batch-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const open = async (i: number) => {
    setOpening(i);
    try {
      await openBatchItem(i);
    } finally {
      setOpening(null);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">
          {th ? "ตรวจเป็นชุด" : "Batch detection"}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {th
            ? "เลือกทั้งโฟลเดอร์แล้วไล่ตรวจทีละรูป — ใช้เฉพาะโมเดลจำแนก ไม่เรียก AI จึงไม่เสียโทเคน"
            : "Pick a whole folder and scan image by image — classification only, no AI calls, no tokens spent."}
        </p>
      </div>

      {/* ตัวเลือกไฟล์ */}
      <div className="flex flex-wrap gap-3">
        <input
          ref={folderRef}
          type="file"
          multiple
          // @ts-expect-error — ไม่ใช่มาตรฐาน แต่ Chrome/Edge/Safari รองรับ
          webkitdirectory=""
          directory=""
          className="hidden"
          onChange={(e) => pick(e.target.files)}
        />
        <input
          ref={filesRef}
          type="file"
          multiple
          accept="image/*"
          className="hidden"
          onChange={(e) => pick(e.target.files)}
        />
        <button
          onClick={() => folderRef.current?.click()}
          disabled={isBatchRunning}
          className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-60"
        >
          <FolderOpen className="h-4 w-4" />
          {th ? "เลือกทั้งโฟลเดอร์" : "Choose a folder"}
        </button>
        <button
          onClick={() => filesRef.current?.click()}
          disabled={isBatchRunning}
          className="flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-60"
        >
          {th ? "เลือกหลายไฟล์" : "Choose files"}
        </button>
        {total > 0 && !isBatchRunning && (
          <>
            <button
              onClick={downloadCsv}
              className="flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
            >
              <Download className="h-4 w-4" />
              {th ? "ดาวน์โหลด CSV" : "Download CSV"}
            </button>
            <button
              onClick={clearBatch}
              className="flex items-center gap-2 rounded-md border px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
            >
              <Trash2 className="h-4 w-4" />
              {th ? "ล้างผล" : "Clear"}
            </button>
          </>
        )}
        {isBatchRunning && (
          <button
            onClick={cancelBatch}
            className="flex items-center gap-2 rounded-md border border-destructive/40 px-4 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
          >
            <X className="h-4 w-4" />
            {th ? "ยกเลิก" : "Cancel"}
          </button>
        )}
      </div>

      {total === 0 && (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          {th
            ? "ยังไม่ได้เลือกรูป · รองรับ JPG / PNG / TIFF · โมเดลที่จะใช้คือตัวที่เลือกไว้ในเมนูซ้าย"
            : "No images selected yet · JPG / PNG / TIFF · uses the model selected in the sidebar"}
        </p>
      )}

      {/* ความคืบหน้า */}
      {total > 0 && (
        <div className="rounded-xl border p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">
              {isBatchRunning ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin-slow" />
                  {th ? `กำลังตรวจ ${done + failed}/${total}` : `Scanning ${done + failed}/${total}`}
                </span>
              ) : (
                <>{th ? `ตรวจเสร็จ ${done}/${total} รูป` : `Done ${done}/${total}`}</>
              )}
            </span>
            <span className="text-muted-foreground">
              {th ? `โมเดล ${mlModel}` : `Model ${mlModel}`}
              {failed > 0 && (
                <span className="ml-2 text-destructive">
                  {th ? `ล้มเหลว ${failed}` : `${failed} failed`}
                </span>
              )}
              {cancelled > 0 && (
                <span className="ml-2">
                  {th ? `ยกเลิก ${cancelled}` : `${cancelled} cancelled`}
                </span>
              )}
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>

          {/* สรุปรวม */}
          {done > 0 && (
            <div className="mt-4 space-y-2 border-t pt-3">
              <p className="text-sm">
                {th
                  ? `พบปีกรวม ${summary.wings} ตัว · ระบุชนิดได้ ${summary.answered} ตัว`
                  : `${summary.wings} wings found · ${summary.answered} identified`}
                {summary.imagesWithNothing > 0 && (
                  <span className="text-muted-foreground">
                    {th
                      ? ` · ${summary.imagesWithNothing} รูปไม่มีปีกที่ระบุได้`
                      : ` · ${summary.imagesWithNothing} images with nothing identified`}
                  </span>
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(summary.perSpecies)
                  .sort((a, b) => b[1] - a[1])
                  .map(([sp, n]) => (
                    <span
                      key={sp}
                      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
                    >
                      <i
                        className="block h-2.5 w-2.5 rounded-full"
                        style={{ background: SPECIES_COLOR[sp] ?? "#6b7280" }}
                      />
                      <i>{sp}</i>
                      <span className="font-medium tabular-nums">{n}</span>
                    </span>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ตารางผลรายไฟล์ */}
      {total > 0 && (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">{th ? "ไฟล์" : "File"}</th>
                <th className="px-3 py-2 text-right">{th ? "ปีก" : "Wings"}</th>
                <th className="px-3 py-2 text-right">{th ? "ตอบได้" : "Identified"}</th>
                <th className="px-3 py-2 text-left">{th ? "ชนิดที่พบ" : "Species"}</th>
                <th className="px-3 py-2 text-right">{th ? "เวลา" : "Time"}</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {batchItems.map((b, i) => (
                <tr key={i} className="border-t">
                  <td className="max-w-[260px] truncate px-3 py-2" title={b.name}>
                    {b.name}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {b.result ? b.result.wingsDetected : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {b.result ? b.result.wingsAnswered : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {b.status === "running" && (
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin-slow" />
                        {th ? "กำลังตรวจ" : "scanning"}
                      </span>
                    )}
                    {b.status === "pending" && (
                      <span className="text-muted-foreground">{th ? "รอคิว" : "queued"}</span>
                    )}
                    {b.status === "cancelled" && (
                      <span className="text-muted-foreground/60">
                        {th ? "ยกเลิกแล้ว" : "cancelled"}
                      </span>
                    )}
                    {b.status === "error" && (
                      <span className="text-destructive" title={b.error}>
                        {th ? "ล้มเหลว" : "failed"}
                      </span>
                    )}
                    {b.status === "done" && b.result && (
                      <span className="flex flex-wrap gap-1.5">
                        {b.result.speciesFound.length === 0 ? (
                          <span className="text-muted-foreground">
                            {th ? "ไม่พบชนิดที่ระบุได้" : "none"}
                          </span>
                        ) : (
                          b.result.speciesFound.map((sp) => (
                            <span
                              key={sp}
                              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
                            >
                              <i
                                className="block h-2 w-2 rounded-full"
                                style={{ background: SPECIES_COLOR[sp] ?? "#6b7280" }}
                              />
                              <i>{sp}</i>
                            </span>
                          ))
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {b.ms != null ? `${(b.ms / 1000).toFixed(1)}s` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {b.status === "done" && b.file && (
                      <button
                        onClick={() => void open(i)}
                        disabled={opening != null}
                        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors hover:bg-muted disabled:opacity-50"
                      >
                        {opening === i ? (
                          <Loader2 className="h-3 w-3 animate-spin-slow" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )}
                        {th ? "เปิดดู" : "Open"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > 0 && (
        <p className="text-xs text-muted-foreground">
          {th
            ? 'ระบบปิด AI ให้อัตโนมัติตอนตรวจเป็นชุด · กด "เปิดดู" เพื่อดูรูปนั้นแบบเต็มพร้อม Grad-CAM รายปีก แล้วถ้าอยากได้คำอธิบาย ค่อยเลือกโมเดล AI จากเมนูซ้าย · CSV มีหนึ่งแถวต่อหนึ่งปีก พร้อมพิกัดกรอบและระยะ kNN'
            : 'AI is turned off automatically for batch scanning. Click "Open" to view an image in full with per-wing Grad-CAM, then pick an AI model in the sidebar if you want an explanation. The CSV has one row per wing with box coordinates and kNN distance.'}
        </p>
      )}
    </div>
  );
}
