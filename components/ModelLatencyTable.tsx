"use client";

import { Zap } from "lucide-react";
import { AI_MODELS, AI_OFF } from "@/lib/types";
import type { Lang } from "@/lib/i18n";

/**
 * ตารางเทียบโมเดล AI ที่ใช้เขียนคำอธิบาย
 *
 * ของเดิมช่องหมายเหตุเขียนมือทีละแถว เลยขัดกันเอง — GPT-4.1 Mini (3-5s)
 * ติดป้าย "เร็วที่สุด" ทั้งที่ Flash-Lite (1-3s) ได้แค่ "สุดเร็ว"
 * และไอคอนสายฟ้าก็บอกซ้ำกับช่องความเร็วที่อยู่ติดกัน
 *
 * เวอร์ชันนี้แยกสองเรื่องออกจากกัน:
 *   - ระดับความเร็ว = คำนวณจากตัวเลขวินาที ไม่ได้เขียนมือ จึงขัดกันเองไม่ได้อีก
 *   - ช่องหมายเหตุ  = บอกเรื่องที่ตารางยังไม่ได้บอก คือ "ควรเลือกตัวนี้ตอนไหน"
 */

type Text = Record<Lang, string>;

/** ราคาต่อ 1M token [เข้า, ออก] หน่วยดอลลาร์ + มีโควตาฟรีให้ใช้ไหม
 *
 *  ดึงจากหน้า pricing ของผู้ให้บริการโดยตรง (ตรวจล่าสุด 29 ก.ย. 2026):
 *    OpenAI  developers.openai.com/api/docs/pricing
 *    Google  ai.google.dev/gemini-api/docs/pricing
 *    Claude  platform.claude.com/docs/en/about-claude/pricing
 *
 *  ราคาขยับได้ ถ้าตัวเลขในเล่มกับในเว็บไม่ตรงกันให้ยึดหน้า pricing แล้วมาแก้ตรงนี้
 *  free = ตระกูล Flash/Flash-Lite ของ Google มีโควตาฟรีต่อวัน ใช้ทดสอบได้โดยไม่เสียเงิน */
const PRICE: Record<string, { in: number; out: number; free?: boolean }> = {
  // OpenAI — Sol แพงกว่า Terra ทั้งที่เลขรุ่นเดียวกัน
  "gpt-5.6-terra": { in: 2.0, out: 12.0 },
  "gpt-5.6-sol": { in: 4.0, out: 20.0 },
  "gpt-5.6-luna": { in: 0.2, out: 1.2 },
  "gpt-4.1": { in: 2.0, out: 8.0 },
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
  // Google — Pro เป็นตัวเดียวในลิสต์ที่ไม่มีโควตาฟรี
  "gemini-3.1-pro-preview": { in: 2.0, out: 12.0 },
  "gemini-3.6-flash": { in: 0.75, out: 3.75, free: true },
  "gemini-3.5-flash-lite": { in: 0.3, out: 2.5, free: true },
  "gemini-3.1-flash-lite": { in: 0.25, out: 1.5, free: true },
  // Anthropic
  "claude-opus-4-8": { in: 5.0, out: 25.0 },
  "claude-sonnet-4-6": { in: 3.0, out: 15.0 },
  "claude-haiku-4-5": { in: 1.0, out: 5.0 },
};

/** โทเคนที่ใช้จริงต่อการอธิบายหนึ่งครั้ง (ภาพปีก 1 ใบ + พรอมต์ + คำตอบ)
 *  เป็นค่าเพดานเดียวกับที่ใช้คุมงบ $2 ตอนทำการทดลอง zero-shot
 *  ดู benchmark/zero-shot/run-zeroshot.mjs — const worst = (2500 * m.in + 3000 * m.out) / 1e6 */
const TOK_IN = 2500;
const TOK_OUT = 3000;

function costPerRun(p: { in: number; out: number }) {
  return (TOK_IN * p.in + TOK_OUT * p.out) / 1e6;
}

/** sec  = ช่วงเวลาตอบกลับเป็นวินาที [ต่ำสุด, สูงสุด] — ระดับความเร็วคำนวณจากตรงนี้
 *  note = เหตุผลที่จะเลือกตัวนี้ ไม่ใช่การบอกซ้ำว่าเร็วหรือช้า */
const INFO: Record<string, { sec: [number, number]; note: Text }> = {
  "gpt-5.6-terra": {
    sec: [2, 4],
    note: { th: "เรือธงของ OpenAI · reasoning", en: "OpenAI flagship · reasoning" },
  },
  "gpt-5.6-sol": {
    sec: [2, 4],
    note: { th: "reasoning ตัวแรง แพงสุดฝั่ง OpenAI", en: "Heavyweight reasoning, priciest OpenAI here" },
  },
  "gpt-5.6-luna": {
    sec: [3, 5],
    note: { th: "reasoning ตัวประหยัด ถูกที่สุดในลิสต์", en: "Budget reasoning, cheapest in the list" },
  },
  "gpt-4.1": {
    sec: [6, 10],
    note: { th: "รุ่นก่อน ไม่มี reasoning", en: "Previous generation, no reasoning" },
  },
  "gpt-4.1-mini": {
    sec: [3, 5],
    note: { th: "รุ่นก่อน ตัวเล็ก", en: "Previous generation, small" },
  },
  "gemini-3.1-pro-preview": {
    sec: [4, 6],
    note: { th: "เรือธงของ Google", en: "Google flagship" },
  },
  "gemini-3.6-flash": {
    sec: [2, 4],
    note: { th: "สมดุลราคากับความเร็ว", en: "Balanced price and speed" },
  },
  "gemini-3.5-flash-lite": {
    sec: [1, 3],
    note: { th: "ใหม่กว่า 3.1 Flash-Lite แต่แพงกว่า", en: "Newer than 3.1 Flash-Lite but costs more" },
  },
  "gemini-3.1-flash-lite": {
    sec: [1, 3],
    note: { th: "ถูกที่สุดฝั่ง Google", en: "Cheapest Google model here" },
  },
  "claude-opus-4-8": {
    sec: [8, 12],
    note: { th: "อธิบายละเอียดสุด แลกกับช้าสุดและแพงสุด", en: "Most detailed, but slowest and priciest overall" },
  },
  "claude-sonnet-4-6": {
    sec: [5, 8],
    note: { th: "ตัวสมดุลของ Anthropic", en: "Balanced model from Anthropic" },
  },
  "claude-haiku-4-5": {
    sec: [3, 5],
    note: { th: "ตัวเล็กของ Anthropic", en: "Small model from Anthropic" },
  },
  [AI_OFF]: {
    sec: [0, 0],
    note: { th: "ไม่เรียก LLM เลย ไม่เสียโทเคน", en: "No LLM call at all, no tokens spent" },
  },
};

/** 4 ระดับ ตัดสินจากกึ่งกลางของช่วงเวลา — เขียนมือไม่ได้ จึงขัดกับช่องความเร็วไม่ได้ */
const TIERS: { max: number; bars: number; color: string; label: Text }[] = [
  { max: 2.5, bars: 4, color: "bg-emerald-500", label: { th: "เร็วมาก", en: "Very fast" } },
  { max: 4.0, bars: 3, color: "bg-emerald-500", label: { th: "เร็ว", en: "Fast" } },
  { max: 6.5, bars: 2, color: "bg-accent", label: { th: "ปานกลาง", en: "Moderate" } },
  { max: Infinity, bars: 1, color: "bg-amber-500", label: { th: "ช้า", en: "Slow" } },
];

function tierOf(sec: [number, number]) {
  const mid = (sec[0] + sec[1]) / 2;
  return TIERS.find((t) => mid <= t.max)!;
}

const TEXT = {
  th: {
    title: "เทียบโมเดล AI ที่ใช้เขียนคำอธิบาย",
    model: "โมเดล",
    speed: "ความเร็ว",
    price: "ราคา/1M",
    note: "หมายเหตุ",
  },
  en: {
    title: "AI models used to write explanations",
    model: "Model",
    speed: "Speed",
    price: "Price/1M",
    note: "Notes",
  },
};

interface ModelLatencyTableProps {
  currentAiModel: string;
  lang: Lang;
}

export function ModelLatencyTable({ currentAiModel, lang }: ModelLatencyTableProps) {
  const t = TEXT[lang];

  const rows = AI_MODELS.map((m) => {
    const info = INFO[m.id];
    const off = m.id === AI_OFF;
    return {
      ...m,
      note: info?.note ?? { th: "—", en: "—" },
      // ปิด AI ไม่มีเวลาตอบเพราะไม่ได้เรียกอะไรเลย — ดันไปท้ายตารางเสมอ
      sort: off ? Infinity : info ? (info.sec[0] + info.sec[1]) / 2 : 99,
      range: !info || off ? "—" : `${info.sec[0]}-${info.sec[1]}s`,
      tier: !info || off ? null : tierOf(info.sec),
      price: PRICE[m.id],
    };
  }).sort((a, b) => {
    // ตัวที่เลือกอยู่ขึ้นบนสุด จะได้เทียบกับตัวอื่นได้ทันที
    if (a.id === currentAiModel) return -1;
    if (b.id === currentAiModel) return 1;
    return a.sort - b.sort;
  });

  return (
    <div className="card-surface overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/10">
          <Zap className="h-3.5 w-3.5 text-accent" />
        </div>
        <span className="text-xs font-medium text-foreground">{t.title}</span>
      </div>

      <div className="overflow-x-auto px-4 pb-4">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="py-2 pr-4 font-medium">{t.model}</th>
              <th className="py-2 pr-4 font-medium">{t.speed}</th>
              <th className="py-2 pr-4 text-right font-medium">{t.price}</th>
              <th className="py-2 font-medium">{t.note}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isCurrent = row.id === currentAiModel;
              return (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="py-2.5 pr-4 text-foreground">
                    <span className={isCurrent ? "font-semibold" : ""}>{row.name}</span>
                    {isCurrent && (
                      <span className="ml-1.5 text-xs text-muted-foreground">(current)</span>
                    )}
                    {/* มีโควตาฟรีต่อวัน = ทดสอบได้โดยไม่เสียเงินเลย ซึ่งสำคัญกว่าราคาต่อโทเคน */}
                    {row.price?.free && (
                      <span className="ml-1.5 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                        {lang === "th" ? "มีโควตาฟรี" : "free tier"}
                      </span>
                    )}
                  </td>

                  <td className="py-2.5 pr-4">
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      <span className="flex items-end gap-[2px]" aria-hidden="true">
                        {[0, 1, 2, 3].map((i) => (
                          <span
                            key={i}
                            className={`w-[3px] rounded-[1px] ${
                              row.tier && i < row.tier.bars
                                ? row.tier.color
                                : "bg-muted-foreground/20"
                            }`}
                            // แท่งสูงไล่ขึ้น อ่านทิศทางออกแม้มองผ่าน ๆ
                            style={{ height: `${5 + i * 2}px` }}
                          />
                        ))}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">{row.range}</span>
                      {row.tier && (
                        <span className="text-xs text-muted-foreground/70">
                          {row.tier.label[lang]}
                        </span>
                      )}
                    </div>
                  </td>

                  <td className="py-2.5 pr-4 text-right">
                    {row.price ? (
                      <div className="flex flex-col items-end leading-tight">
                        <span className="font-mono text-xs text-muted-foreground">
                          ${row.price.in} / ${row.price.out}
                        </span>
                        <span className="font-mono text-[10px] text-muted-foreground/60">
                          ≈${costPerRun(row.price).toFixed(3)}
                          {lang === "th" ? "/ครั้ง" : "/run"}
                        </span>
                      </div>
                    ) : (
                      <span className="font-mono text-xs text-muted-foreground">—</span>
                    )}
                  </td>

                  <td className="py-2.5 text-xs text-muted-foreground">{row.note[lang]}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/70">
          {lang === "th"
            ? "ความเร็วเป็นค่าที่พบบ่อยตอนใช้งานจริง แกว่งตามคิวของผู้ให้บริการแต่ละช่วง · " +
              `ราคาเป็นดอลลาร์ต่อ 1 ล้านโทเคน (เข้า / ออก) จากหน้า pricing ของผู้ให้บริการ ตรวจล่าสุด 29 ก.ย. 2026 · ` +
              `บรรทัดล่างคือค่าใช้จ่ายโดยประมาณต่อการอธิบายหนึ่งครั้ง คิดที่ ${TOK_IN.toLocaleString()} โทเคนเข้า / ${TOK_OUT.toLocaleString()} โทเคนออก · ` +
              "โมเดล AI ใช้เขียนคำอธิบายอย่างเดียว ไม่ได้เป็นตัวตัดสินชนิด"
            : "Speeds are typical observed values and vary with provider load · " +
              "Prices are USD per 1M tokens (in / out), taken from each provider's pricing page, checked 29 Sep 2026 · " +
              `The second line is the approximate cost of one explanation, assuming ${TOK_IN.toLocaleString()} input / ${TOK_OUT.toLocaleString()} output tokens · ` +
              "AI models only write the explanation, they never decide the species"}
        </p>
      </div>
    </div>
  );
}
