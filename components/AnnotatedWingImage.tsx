"use client";

// ภาพปีกจริง + หมุดเลขกำกับชี้จุดสังเกตเฉพาะชนิด และคำอธิบายหมุดใต้ภาพ
// ชี้เมาส์ที่หมุด (หรือรายการใต้ภาพ) แล้วการ์ดลอยขึ้นมา
//
// ทำเป็น HTML ซ้อนบนภาพ ไม่วาดลงพิกเซลแบบเดิม (canvas / gpt-image)
// เพราะต้องรู้ตำแหน่งของทุกหมุดถึงจะเปิดการ์ดตอนชี้ได้ และวางด้วย % จึงย่อขยายตามการ์ดได้เอง
//
// ชื่อจุดสังเกตอยู่ใต้ภาพ ไม่ได้ติดข้างหมุด — จุดที่ใช้แยกชนิดมักกระจุกรอบ stigma
// และในโหมดดูทีละปีกภาพปีกเต็มกรอบ ป้ายบนภาพจะทับกันเองและบังลายปีกที่กำลังชี้ให้ดู
//
// พิกัด x, y เป็นสัดส่วน 0–1 ของภาพ (มาจาก /api/annotate)

import { forwardRef, useState, type ComponentPropsWithoutRef } from "react";

import type { AnnotatedFeature } from "@/app/api/annotate/route";
import { WingLandmarkCard } from "@/components/WingLandmarkCard";
import { featureOf, landmarkByName, speciesWing, type Landmark } from "@/lib/wing-landmarks";
import type { Lang } from "@/lib/i18n";

type Props = {
  src: string;
  features: AnnotatedFeature[];
  species: string;
  lang: Lang;
};

type Pin = { f: AnnotatedFeature; lm: Landmark; n: number; fromFigure: boolean };

/** เลขในวงกลม — ใช้ทั้งบนภาพและในรายการใต้ภาพ ให้จับคู่กันด้วยตาได้ทันที */
const Badge = ({ n, fromFigure, size }: { n: number; fromFigure: boolean; size: "sm" | "md" }) => (
  <span
    className={`relative flex shrink-0 items-center justify-center rounded-full font-bold text-white ${
      fromFigure ? "bg-amber-500" : "bg-accent"
    } ${size === "md" ? "h-5 w-5 text-[10px] shadow-md ring-2 ring-white" : "h-4 w-4 text-[9px]"}`}
  >
    {n}
  </span>
);

// HoverCard ต้องได้ ref ของตัวที่ชี้ จึงต้องเป็น forwardRef
const PinButton = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<"button"> & { pin: Pin; active: boolean }>(
  function PinButton({ pin, active, style, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={pin.lm.nameEn}
        {...rest}
        className="absolute -translate-x-1/2 -translate-y-1/2 cursor-help rounded-full focus-visible:outline-none"
        style={style}
      >
        <span
          className={`absolute inset-0 animate-ping-slower rounded-full ${pin.fromFigure ? "bg-amber-400/60" : "bg-accent/60"}`}
        />
        <span className={`block transition-transform ${active ? "scale-125" : ""}`}>
          <Badge n={pin.n} fromFigure={pin.fromFigure} size="md" />
        </span>
      </button>
    );
  }
);

export function AnnotatedWingImage({ src, features, species, lang }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const sp = speciesWing(species);

  const pins: Pin[] = features
    .map((f) => ({ f, lm: landmarkByName(f.name) ?? landmarkByName(f.labelEn) }))
    .filter((x): x is { f: AnnotatedFeature; lm: Landmark } => Boolean(x.lm))
    .map(({ f, lm }, i) => ({ f, lm, n: i + 1, fromFigure: featureOf(sp, lm.nameEn)?.level === "figure" }));

  const hoverProps = (i: number) => ({
    onMouseEnter: () => setHover(i),
    onMouseLeave: () => setHover(null),
    onFocus: () => setHover(i),
    onBlur: () => setHover(null),
  });

  return (
    <div className="space-y-2">
      <div className="relative select-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="Wing with diagnostic landmarks" className="block w-full rounded-md border" />
        {pins.map((pin, i) => (
          <WingLandmarkCard key={i} landmark={pin.lm} species={species} lang={lang}>
            <PinButton
              pin={pin}
              active={hover === i}
              {...hoverProps(i)}
              style={{ left: `${pin.f.x * 100}%`, top: `${pin.f.y * 100}%` }}
            />
          </WingLandmarkCard>
        ))}
      </div>

      {/* รายการหมุด — ชี้ที่รายการก็เปิดการ์ดเดียวกัน และหมุดบนภาพจะขยายให้เห็นว่าอยู่ตรงไหน */}
      <div className="flex flex-wrap gap-1.5">
        {pins.map((pin, i) => (
          <WingLandmarkCard key={i} landmark={pin.lm} species={species} lang={lang}>
            <button
              type="button"
              {...hoverProps(i)}
              className={`flex cursor-help items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-[11px] transition-colors focus-visible:outline-none ${
                hover === i
                  ? pin.fromFigure
                    ? "border-amber-500/50 bg-amber-500/10 text-foreground"
                    : "border-accent/50 bg-accent/10 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              <Badge n={pin.n} fromFigure={pin.fromFigure} size="sm" />
              {lang === "th" ? pin.lm.nameTh : pin.lm.nameEn}
            </button>
          </WingLandmarkCard>
        ))}
      </div>
    </div>
  );
}
