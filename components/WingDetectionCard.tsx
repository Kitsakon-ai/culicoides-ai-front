"use client";

// ── การ์ด "ปีกที่พบในภาพ" ──────────────────────────────────────────────
// แสดงผลจาก /api/detect ซึ่งหาปีกทุกตัวในภาพแล้วตอบว่าพบกี่ชนิด
// ต่างจากผลหลักของหน้านี้ที่มองทั้งรูปเป็นปีกเดียว จึงตอบได้ชนิดเดียว
//
// เรื่องพิกัดกรอบ (จุดที่พลาดกันบ่อย):
//   box ที่ backend คืนมาเป็นพิกัดบน "ภาพที่ส่งไป" ไม่ใช่ขนาดที่แสดงบนจอ
//   วิธีที่ใช้ที่นี่ตัดปัญหาทิ้งทั้งหมด — ตั้ง canvas.width/height เท่าภาพจริง
//   แล้ววาดด้วยพิกัดดิบ จากนั้นให้ CSS (w-full h-auto) เป็นคนย่อ
//   ระบบพิกัดใน canvas จึงเท่ากับของภาพเสมอ ไม่มีสูตรคูณให้คำนวณผิด
//
//   ภาพที่ส่งมาต้องเป็น "ไฟล์ที่ส่งไปจริง" (imagePreview ซึ่งมาจาก downscaleImage
//   ตัวเดียวกับที่อัปโหลด) ไม่ใช่ไฟล์ต้นฉบับ ไม่งั้นกรอบเพี้ยนเมื่อภาพถูกย่อ

import { useEffect, useRef, useState } from "react";
import { Loader2, ScanSearch } from "lucide-react";

import type { DetectResult, DetectedWing } from "@/lib/api";
import type { Lang } from "@/lib/i18n";

type Props = {
  preview: string | null;
  data: DetectResult | null;
  isLoading: boolean;
  error: string | null;
  lang: Lang;
  /** ปีกที่กำลังดูรายละเอียดอยู่ (null = ดูผลของทั้งภาพ) */
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
};

const SPECIES_COLOR: Record<string, string> = {
  guttifer: "#2a78d6",
  mahasarakhamense: "#eb6834",
  oxystoma: "#1baf7a",
  peregrinus: "#eda100",
};
const REJECT_COLOR = "#b3261e";

const colorOf = (w: DetectedWing) =>
  w.species ? SPECIES_COLOR[w.species] ?? "#6b7280" : REJECT_COLOR;

export function WingDetectionCard({
  preview,
  data,
  isLoading,
  error,
  lang,
  selectedIndex,
  onSelect,
}: Props) {
  const th = lang === "th";
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canDraw, setCanDraw] = useState(true);
  // เลือก ensemble ไว้ → แต่ละปีกมีผลจากหลายโมเดลให้เทียบกัน
  const multiModel = (data?.wings ?? []).some((w) => (w.models?.length ?? 0) > 1);
  // Grad-CAM ทำด้วยโมเดลเดียวเสมอ แม้ตอนเลือก ensemble
  const camModel = (data?.wings ?? []).find((w) => w.gradcamModel)?.gradcamModel;

  /** คลิกบนภาพ → หาว่าโดนปีกตัวไหน
   *  ต้องแปลงพิกัดหน้าจอกลับเป็นพิกัดภายใน canvas (ซึ่งเท่าขนาดภาพจริง) ก่อน
   *  ถ้ากรอบซ้อนกัน เลือกตัวที่เล็กที่สุด เพราะน่าจะเป็นตัวที่ผู้ใช้ตั้งใจจิ้ม */
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    let hit = -1;
    let smallest = Infinity;
    data.wings.forEach((w, i) => {
      const [x0, y0, x1, y1] = w.box;
      if (x < x0 || x > x1 || y < y0 || y > y1) return;
      const area = (x1 - x0) * (y1 - y0);
      if (area < smallest) {
        smallest = area;
        hit = i;
      }
    });
    if (hit < 0) return;
    if (!data.wings[hit].species) return; // ปีกที่ถูกปฏิเสธ ไม่มีอะไรให้ดู
    onSelect(hit);
  };

  // ต้องวาดใน effect เท่านั้น — ถ้าเรียกทันทีหลัง setState ตัว canvas
  // ยังไม่ถูก mount (มันอยู่หลังเงื่อนไข data) แล้ว ref จะยังเป็น null
  useEffect(() => {
    if (!preview || !data) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || data.imageSize[0];
      const h = img.naturalHeight || data.imageSize[1];
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.drawImage(img, 0, 0, w, h);

      const lw = Math.max(2, Math.round(w / 320));
      const fs = Math.max(13, Math.round(w / 42));
      ctx.lineWidth = lw;
      ctx.font = `700 ${fs}px "Segoe UI", system-ui, sans-serif`;
      ctx.textBaseline = "top";

      data.wings.forEach((wing, i) => {
        const [x0, y0, x1, y1] = wing.box;
        const col = colorOf(wing);
        // มีปีกที่ถูกเลือกอยู่ → หรี่ตัวอื่นลง ให้เห็นชัดว่ากำลังดูตัวไหน
        const dim = selectedIndex != null && selectedIndex !== i;
        const isSel = selectedIndex === i;

        ctx.globalAlpha = dim ? 0.35 : 1;
        ctx.lineWidth = isSel ? lw * 2 : lw;
        ctx.strokeStyle = col;
        ctx.setLineDash(wing.accepted ? [] : [lw * 3, lw * 2]);
        ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
        ctx.setLineDash([]);
        ctx.lineWidth = lw;

        const label = wing.species
          ? `${i + 1}. ${wing.species} ${Math.round((wing.confidence ?? 0) * 100)}%`
          : `${i + 1}. ${th ? "ไม่รู้" : "unknown"}`;
        const padX = fs * 0.35;
        const tw = ctx.measureText(label).width + padX * 2;
        const tht = fs * 1.5;
        // ป้ายอยู่เหนือกรอบ ถ้าชนขอบบนให้ย้ายลงมาไว้ในกรอบแทน
        const ly = y0 - tht - lw >= 0 ? y0 - tht - lw : y0 + lw;
        const lx = Math.min(Math.max(0, x0), Math.max(0, w - tw));

        ctx.fillStyle = col;
        ctx.fillRect(lx, ly, tw, tht);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(label, lx + padX, ly + tht * 0.22);
        ctx.globalAlpha = 1;
      });
      setCanDraw(true);
    };
    img.onerror = () => setCanDraw(false); // เช่น TIFF ที่เบราว์เซอร์เปิดไม่ได้
    img.src = preview;
  }, [preview, data, th, selectedIndex]);

  // backend ที่ยังไม่มี /detect (เช่นตัวที่ deploy อยู่) จะเข้าทางนี้
  // ไม่ขึ้นอะไรเลยดีกว่าขึ้น error ให้ผู้ใช้ทั่วไปเห็น เพราะผลหลักยังใช้ได้ปกติ
  if (error && !data) return null;
  if (!isLoading && !data) return null;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/10">
          <ScanSearch className="h-3.5 w-3.5 text-accent" />
        </div>
        <span className="text-sm font-medium text-foreground">
          {th ? "ปีกที่พบในภาพ" : "Wings found in image"}
        </span>
        {isLoading && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        )}
      </div>

      {isLoading && !data && (
        <p className="text-sm text-muted-foreground">
          {th ? "กำลังหาปีกในภาพ ..." : "Scanning for wings ..."}
        </p>
      )}

      {data && (
        <div className="space-y-4">
          <div className="rounded-xl border p-4">
            <p className="text-base font-semibold">
              {data.speciesCount > 0
                ? th
                  ? `พบ ${data.speciesCount} ชนิด: ${data.speciesFound.join(", ")}`
                  : `${data.speciesCount} species: ${data.speciesFound.join(", ")}`
                : th
                  ? "ไม่พบชนิดที่ระบุได้"
                  : "No identifiable species"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {th
                ? `ตรวจเจอ ${data.wingsDetected} ปีก · ตอบได้ ${data.wingsAnswered} ปีก`
                : `${data.wingsDetected} wings detected · ${data.wingsAnswered} identified`}
              {data.wingsDetected > data.wingsAnswered &&
                (th
                  ? ` · ตอบไม่ได้ ${data.wingsDetected - data.wingsAnswered} ปีก`
                  : ` · ${data.wingsDetected - data.wingsAnswered} unknown`)}
            </p>
            {data.speciesFound.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {data.speciesFound.map((s) => (
                  <span
                    key={s}
                    className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
                  >
                    <i
                      className="block h-2.5 w-2.5 rounded-full"
                      style={{ background: SPECIES_COLOR[s] ?? "#6b7280" }}
                    />
                    <i className="not-italic">{s}</i>
                  </span>
                ))}
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            {th
              ? "คลิกที่ปีกตัวไหนก็ได้ เพื่อให้คำอธิบาย AI · แผนที่ · taxonomy ด้านบนเปลี่ยนไปตามปีกตัวนั้น"
              : "Click any wing to make the AI explanation, map and taxonomy above follow that wing."}
          </p>

          <div className="overflow-hidden rounded-xl border">
            <canvas
              ref={canvasRef}
              onClick={handleCanvasClick}
              className="block h-auto w-full cursor-pointer"
            />
            {!canDraw && (
              <p className="px-4 py-3 text-sm text-muted-foreground">
                {th
                  ? "เบราว์เซอร์แสดงภาพฟอร์แมตนี้ไม่ได้ — ผลตรวจยังถูกต้อง ดูตำแหน่งกรอบได้จากตารางด้านล่าง"
                  : "Browser cannot render this format — results are still valid, see the table below."}
              </p>
            )}
          </div>

          {data.wings.some((w) => w.gradcam) && (
            <div>
              <p className="mb-2 text-sm font-medium">
                {th ? "Grad-CAM++ รายปีก" : "Per-wing Grad-CAM++"}
                <span className="ml-2 font-normal text-muted-foreground">
                  {th
                    ? "โมเดลมองตรงไหนตอนตัดสินปีกแต่ละตัว"
                    : "where the model looked for each wing"}
                </span>
              </p>
              {/* ตอน ensemble ตัวเลขเป็นค่าเฉลี่ยของ 3 โมเดล แต่ heatmap ทำจากตัวเดียว
                  ต้องบอกให้ชัดว่าเป็นของโมเดลไหน ไม่งั้นเข้าใจว่าเป็นของทั้ง ensemble */}
              {camModel && (
                <p className="mb-2 text-xs text-muted-foreground">
                  {th
                    ? `ภาพความร้อนสร้างจาก ${camModel}`
                    : `Heatmaps generated by ${camModel}`}
                  {multiModel &&
                    (th
                      ? " — ตัวเดียวเท่านั้น ต่างจากตัวเลขความมั่นใจที่เฉลี่ยจากทุกโมเดล"
                      : " — one model only, unlike the confidence which averages all models")}
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                {data.wings.map((w, i) =>
                  w.gradcam ? (
                    <div
                      key={i}
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelect(i)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelect(i);
                        }
                      }}
                      className={`cursor-pointer rounded-xl border p-3 transition-colors ${
                        selectedIndex === i
                          ? "border-accent bg-accent/5 ring-1 ring-accent"
                          : "hover:bg-muted/40"
                      }`}
                    >
                      <p className="mb-2 flex items-center gap-2 text-sm font-medium">
                        <i
                          className="block h-2.5 w-2.5 rounded-sm"
                          style={{ background: colorOf(w) }}
                        />
                        {th ? "ปีก" : "Wing"} {i + 1} · <i>{w.species}</i> ·{" "}
                        {Math.round((w.confidence ?? 0) * 100)}%
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        <figure>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={w.heatmap}
                            alt={`heatmap ${i + 1}`}
                            className="w-full rounded-lg border"
                          />
                          <figcaption className="mt-1 text-center text-xs text-muted-foreground">
                            Heatmap
                          </figcaption>
                        </figure>
                        <figure>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={w.gradcam}
                            alt={`grad-cam ${i + 1}`}
                            className="w-full rounded-lg border"
                          />
                          <figcaption className="mt-1 text-center text-xs text-muted-foreground">
                            {th ? "ทับบนภาพปีก" : "Overlay"}
                          </figcaption>
                        </figure>
                      </div>
                    </div>
                  ) : null
                )}
              </div>
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">{th ? "ปีก" : "Wing"}</th>
                  <th className="px-3 py-2 text-left">{th ? "ชนิด" : "Species"}</th>
                  <th className="px-3 py-2 text-right">
                    {th ? "ความมั่นใจ" : "Confidence"}
                  </th>
                  {multiModel && (
                    <th className="px-3 py-2 text-right">
                      {th ? "โมเดลที่ตรงกัน" : "Models agreeing"}
                    </th>
                  )}
                  <th className="px-3 py-2 text-right">{th ? "ระยะ kNN" : "kNN dist"}</th>
                  <th className="px-3 py-2 text-right">{th ? "รัศมี" : "Radius"}</th>
                  <th className="px-3 py-2 text-left">
                    {th ? "กรอบ (x0,y0)-(x1,y1)" : "Box (x0,y0)-(x1,y1)"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.wings.map((w, i) => (
                  <tr
                    key={i}
                    onClick={() => w.species && onSelect(i)}
                    className={`border-t ${
                      w.species ? "cursor-pointer" : ""
                    } ${
                      selectedIndex === i
                        ? "bg-accent/10"
                        : w.species
                          ? "hover:bg-muted/40"
                          : ""
                    }`}
                  >
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-2">
                        <i
                          className="block h-2.5 w-2.5 rounded-sm"
                          style={{ background: colorOf(w) }}
                        />
                        {i + 1}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {w.species ? (
                        <i>{w.species}</i>
                      ) : (
                        <span className="text-destructive">
                          {th ? "ไม่รู้" : "unknown"}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {w.confidence != null ? `${Math.round(w.confidence * 100)}%` : "—"}
                    </td>
                    {multiModel && (
                      <td className="px-3 py-2 text-right tabular-nums">
                        {w.models && w.models.length > 1 ? (
                          <span
                            title={w.models
                              .map(
                                (m) =>
                                  `${m.name}: ${
                                    m.accepted && m.species
                                      ? `${m.species} ${Math.round((m.confidence ?? 0) * 100)}%`
                                      : th
                                        ? "ปฏิเสธ"
                                        : "rejected"
                                  }`
                              )
                              .join("\n")}
                            className={
                              w.models.every((m) => m.isWinner)
                                ? "text-success"
                                : "text-muted-foreground"
                            }
                          >
                            {w.models.filter((m) => m.isWinner).length}/{w.models.length}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    )}
                    <td className="px-3 py-2 text-right tabular-nums">
                      {w.knnDistance.toFixed(4)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {w.knnRadius.toFixed(4)}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">
                      ({w.box[0]},{w.box[1]})-({w.box[2]},{w.box[3]})
                    </td>
                  </tr>
                ))}
                {data.wings.length === 0 && (
                  <tr>
                    <td
                      colSpan={multiModel ? 7 : 6}
                      className="px-3 py-6 text-center text-muted-foreground"
                    >
                      {th ? "หาปีกไม่เจอในภาพนี้" : "No wings found in this image"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-muted-foreground">
            {th
              ? "กรอบเส้นทึบ = ผ่านด่าน kNN ตอบชนิดได้ · กรอบเส้นประสีแดง = ระยะไกลเกินรัศมี โมเดลไม่เคยเห็นอะไรแบบนี้ จึงตอบว่าไม่รู้แทนการเดา"
              : "Solid box = passed the kNN gate · dashed red box = beyond the radius, the model has not seen anything like it and answers unknown instead of guessing."}
          </p>

        </div>
      )}
    </div>
  );
}
