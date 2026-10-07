"use client";

// การ์ดลอยของจุดสังเกตบนปีก — เปิดตอนชี้เมาส์ที่หมุดบนภาพปีก (ดู AnnotatedWingImage)
//
// ตอบสามคำถามในการ์ดเดียว: อยู่ตรงไหนของปีก (แผนผัง) · คืออะไร (นิยามระดับสกุล)
// · ชนิดนี้เป็นยังไงตรงนั้น (ลักษณะเฉพาะชนิด + ข้อความต้นฉบับ + ที่มา)
// ลักษณะที่ได้จากการดูภาพในเอกสาร (ไม่มีข้อความตีพิมพ์) ติดป้ายสีเหลืองแยกไว้เสมอ
// ผู้อ่านจะได้รู้ว่าข้อไหนมีหลักฐานเป็นข้อความ ข้อไหนเป็นการตีความของผู้วิจัย

import type { ReactElement } from "react";
import { Portal } from "@radix-ui/react-hover-card";
import { BookOpen, Eye, Fingerprint, Image as ImageIcon, Minus } from "lucide-react";

import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { WingDiagram } from "@/components/WingDiagram";
import { LEVEL_LABEL, expandCodes, featureOf, shortCite, speciesWing, type Landmark } from "@/lib/wing-landmarks";
import type { Lang } from "@/lib/i18n";

const TEXT = {
  th: {
    inSpecies: (sp: string) => `ใน C. ${sp}`,
    notDiagnostic: (sp: string) =>
      `ไม่ใช่ลักษณะที่ใช้แยก C. ${sp} — เป็นโครงสร้างที่ปีก Culicoides ทุกชนิดมี`,
    source: "ที่มา",
    original: "ต้นฉบับ",
    figureWarn: "ยังไม่มีข้อความตีพิมพ์รองรับ ควรให้ผู้เชี่ยวชาญยืนยัน",
  },
  en: {
    inSpecies: (sp: string) => `In C. ${sp}`,
    notDiagnostic: (sp: string) =>
      `Not a character used to separate C. ${sp} — every Culicoides wing has this structure`,
    source: "Source",
    original: "Original",
    figureWarn: "No published text supports this yet — needs expert confirmation",
  },
};

type Props = {
  landmark: Landmark;
  species?: string | null;
  lang: Lang;
  /** ตัวที่ชี้แล้วเปิดการ์ด — ต้องเป็น element เดียวที่รับ ref ได้ (เช่น <button>) */
  children: ReactElement;
};

export function WingLandmarkCard({ landmark, species, lang, children }: Props) {
  const t = TEXT[lang];
  const sp = speciesWing(species);
  const feature = featureOf(sp, landmark.nameEn);
  const fromFigure = feature?.level === "figure";

  return (
    <HoverCard openDelay={80} closeDelay={120}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>

      {/* Portal: การ์ดคำอธิบายมี overflow-hidden ถ้าไม่ย้ายออกไปไว้ที่ body การ์ดลอยจะโดนตัดขอบ */}
      <Portal>
        <HoverCardContent side="top" align="center" sideOffset={10} collisionPadding={12}
          className="w-80 overflow-hidden p-0 shadow-lg">
          <div className="border-b bg-gradient-to-b from-accent/10 to-accent/[0.03] px-3 pt-2.5 pb-1.5">
            <WingDiagram highlight={landmark.nameEn} className="h-auto w-full" />
          </div>

          <div className="space-y-2.5 px-3.5 py-3">
            <div>
              <p className="text-sm font-semibold leading-tight text-foreground">{landmark.nameEn}</p>
              <p className="text-xs text-muted-foreground">{landmark.nameTh}</p>
            </div>

            <p className="text-xs leading-relaxed text-muted-foreground">
              {lang === "th" ? landmark.defTh : landmark.defEn}
            </p>

            {feature && sp ? (
              <div
                className={`space-y-1.5 rounded-md border p-2.5 ${
                  fromFigure ? "border-amber-500/30 bg-amber-500/5" : "border-accent/25 bg-accent/5"
                }`}
              >
                <p
                  className={`flex flex-wrap items-center gap-x-1.5 text-[10px] font-semibold tracking-wide ${
                    fromFigure ? "text-amber-600 dark:text-amber-400" : "text-accent"
                  }`}
                >
                  {fromFigure ? <Eye className="h-3 w-3" /> : <Fingerprint className="h-3 w-3" />}
                  <span className="italic">{t.inSpecies(sp.species)}</span>
                  <span className="opacity-60">·</span>
                  <span>{LEVEL_LABEL[feature.level][lang](sp.subgenus)}</span>
                </p>

                {(lang === "th" || !feature.quote) && (
                  <p className="text-xs leading-relaxed text-foreground">{expandCodes(feature.description_th)}</p>
                )}

                {/* ข้อความต้นฉบับคำต่อคำ — ให้ผู้อ่าน (และกรรมการ) ตรวจได้ว่าไม่ได้แต่งเอง */}
                {feature.quote && (
                  <p
                    className={`border-l-2 border-accent/30 pl-2 text-[11px] leading-relaxed ${
                      lang === "th" ? "line-clamp-4 italic text-muted-foreground" : "text-foreground"
                    }`}
                    title={expandCodes(feature.quote)}
                  >
                    {lang === "th" && <span className="font-medium not-italic">{t.original}: </span>}
                    “{expandCodes(feature.quote)}”
                  </p>
                )}

                {feature.figure_note && (
                  <p className="flex items-start gap-1 text-[10px] leading-relaxed text-muted-foreground">
                    <ImageIcon className="mt-px h-3 w-3 shrink-0" />
                    {expandCodes(feature.figure_note)}
                  </p>
                )}

                {fromFigure && (
                  <p className="text-[10px] font-medium text-amber-600 dark:text-amber-400">{t.figureWarn}</p>
                )}

                <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <BookOpen className="h-3 w-3 shrink-0" />
                  {t.source}: {shortCite(feature.source)}
                </p>
              </div>
            ) : sp ? (
              <p className="flex items-start gap-1.5 rounded-md bg-muted/60 p-2.5 text-xs leading-relaxed text-muted-foreground">
                <Minus className="mt-0.5 h-3 w-3 shrink-0" />
                {t.notDiagnostic(sp.species)}
              </p>
            ) : null}
          </div>
        </HoverCardContent>
      </Portal>
    </HoverCard>
  );
}
