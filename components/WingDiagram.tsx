// แผนผังปีก Culicoides แบบย่อ — ใช้ในการ์ดลอยของคำอธิบาย ชี้ว่าจุดสังเกตอยู่ตรงไหนของปีก
//
// วาดตามแบบที่คีย์จำแนกใช้: โคนปีกอยู่ซ้าย ปลายปีกอยู่ขวา ขอบหน้า (costa) อยู่บน
// เส้นปีกวาดเฉพาะเส้นหลักที่จุดสังเกตอ้างถึง (costa, R, r-m, M1/M2, Cu, anal)
// ไม่ได้วาดตามสัดส่วนของชนิดใดชนิดหนึ่ง — เป็นแผนผังบอกตำแหน่ง ไม่ใช่ภาพของชนิดนั้น

import { LANDMARKS } from "@/lib/wing-landmarks";

export const WING_OUTLINE =
  "M8 40 C12 31 30 22 60 17 C100 11 150 11 178 20 C196 26 198 46 186 55 " +
  "C165 68 115 72 75 66 C45 61 18 52 8 40 Z";

// เส้นปีก — ชื่อในคอมเมนต์ตรงกับศัพท์ที่ใช้ในคำอธิบาย
const VEINS = [
  "M9 38 C14 30 32 21 60 17 C85 13 110 12 126 12.5", // costa (ขอบหน้า)
  "M14 39 C40 30 70 25 88 20.5 L126 13", // R
  "M88 20.5 L87 14.6 M104 17 L104 13", // ขอบ radial cell ที่ 1 และ 2
  "M70 24.8 L72 33", // r-m crossvein
  "M16 41 C40 38 60 35 72 33 C120 30 160 32 192 40", // M → M1
  "M72 33 C110 38 150 48 176 58", // M2
  "M18 45 C45 46 65 46 78 47 C110 52 135 60 150 66", // Cu → CuA1
  "M78 47 C95 54 108 62 112 69", // CuA2
  "M20 48 C40 55 55 60 70 64", // anal
];

type Props = {
  /** ชื่อจุดสังเกต (nameEn ใน LANDMARKS) ที่จะเน้น */
  highlight?: string | null;
  className?: string;
};

export function WingDiagram({ highlight, className }: Props) {
  const mark = LANDMARKS.find((l) => l.nameEn === highlight)?.at;
  return (
    <svg viewBox="0 0 200 80" className={className} aria-hidden="true">
      <path d={WING_OUTLINE} className="fill-background stroke-border" strokeWidth={1.2} />
      {VEINS.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          className="stroke-muted-foreground/45"
          strokeWidth={i === 0 ? 1.6 : 1}
          strokeLinecap="round"
        />
      ))}
      {mark && (
        <g className="text-accent">
          {/* วงกระเพื่อม — SMIL จึงไม่ต้องพึ่ง transform-origin ของ CSS ใน SVG */}
          <circle cx={mark.x} cy={mark.y} r={mark.r ?? 6} fill="none" stroke="currentColor" strokeWidth={1.2}>
            <animate attributeName="r" values={`${mark.r ?? 6};${(mark.r ?? 6) + 7}`} dur="2.2s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.7;0" dur="2.2s" repeatCount="indefinite" />
          </circle>
          <circle cx={mark.x} cy={mark.y} r={mark.r ?? 6} fill="currentColor" fillOpacity={0.18} stroke="currentColor" strokeWidth={1.4} />
          <circle cx={mark.x} cy={mark.y} r={1.8} fill="currentColor" />
        </g>
      )}
    </svg>
  );
}
