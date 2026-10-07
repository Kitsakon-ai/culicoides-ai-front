"use client";

// ภาพ annotation ที่โมเดลสร้างภาพวาดป้าย + ลูกศรไว้ — ชี้เมาส์ที่ตัวหนังสือป้ายแล้วการ์ดลอยขึ้นมา
//
// ภาพเป็นพิกเซลทั้งหมด ป้ายจริงจึงชี้ไม่ได้ ระบบหากรอบตัวหนังสือแต่ละป้ายไว้แล้ว (lib/label-boxes.ts)
// ตรงนี้วางปุ่มใสทับกรอบนั้น ผู้ใช้เห็นภาพเดิมทุกพิกเซล แค่ชี้ที่ป้ายแล้วมีกรอบไฮไลต์กับการ์ด
// วางด้วย % ของภาพ จึงตรงตัวหนังสือทุกขนาดจอ
//
// ถ้าหาป้ายไม่เจอเลย ยังให้ชี้ได้จากรายการชื่อจุดสังเกตใต้ภาพ

import { forwardRef, type ComponentPropsWithoutRef } from "react";

import type { LabelBox } from "@/lib/label-boxes";
import { WingLandmarkCard } from "@/components/WingLandmarkCard";
import { featureOf, landmarkByName, speciesWing } from "@/lib/wing-landmarks";
import type { Lang } from "@/lib/i18n";

type Props = {
  src: string;
  labels: LabelBox[];
  species: string;
  lang: Lang;
};

// HoverCard ต้องได้ ref ของตัวที่ชี้ จึงต้องเป็น forwardRef
const LabelZone = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<"button"> & { box: LabelBox; amber: boolean }>(
  function LabelZone({ box, amber, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={box.name}
        {...rest}
        className={`absolute cursor-help rounded-[4px] ring-inset transition-colors focus-visible:outline-none ${
          amber
            ? "hover:bg-amber-400/20 hover:ring-2 hover:ring-amber-500/70"
            : "hover:bg-accent/15 hover:ring-2 hover:ring-accent/60"
        }`}
        style={{
          left: `${box.x0 * 100}%`,
          top: `${box.y0 * 100}%`,
          width: `${(box.x1 - box.x0) * 100}%`,
          height: `${(box.y1 - box.y0) * 100}%`,
        }}
      />
    );
  }
);

export function LabeledWingImage({ src, labels, species, lang }: Props) {
  const sp = speciesWing(species);
  const isFigure = (name: string) => featureOf(sp, name)?.level === "figure";
  const zones = labels.filter((b) => landmarkByName(b.name));

  // ไม่เจอป้ายในภาพเลย → ให้ชี้จากรายชื่อจุดสังเกตของชนิดนี้แทน
  const fallback = zones.length === 0 ? (sp?.features ?? []) : [];

  return (
    <div className="space-y-2">
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="Annotated wing morphology" className="block w-full rounded-md border object-contain" />
        {zones.map((box) => (
          <WingLandmarkCard key={box.name} landmark={landmarkByName(box.name)!} species={species} lang={lang}>
            <LabelZone box={box} amber={isFigure(box.name)} />
          </WingLandmarkCard>
        ))}
      </div>

      {fallback.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {fallback.map((f) => {
            const lm = landmarkByName(f.name_en);
            if (!lm) return null;
            return (
              <WingLandmarkCard key={f.name_en} landmark={lm} species={species} lang={lang}>
                <button
                  type="button"
                  className="cursor-help rounded-full border px-2.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-accent/50 hover:text-foreground focus-visible:outline-none"
                >
                  {lang === "th" ? lm.nameTh : lm.nameEn}
                </button>
              </WingLandmarkCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
