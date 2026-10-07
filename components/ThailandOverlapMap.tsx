"use client";

// แผนที่หลายชนิดในแผนที่เดียว — ตอบคำถามแบบ "จังหวัดไหนพบทั้ง oxystoma และ guttifer"
//
// ThailandMap เดิมระบายได้ทีละชนิด ตรงนี้ระบายตามว่าจังหวัดนั้นพบชนิดไหนบ้าง
//   2 ชนิด  → สีแยกกลุ่ม: เฉพาะชนิด A / เฉพาะชนิด B / พบทั้งสองชนิด
//   3+ ชนิด → ไล่เฉดตามจำนวนชนิดที่พบ จังหวัดที่พบครบทุกชนิดเข้มที่สุด
// รายชื่อจังหวัดมาจากฐานข้อมูลงานวิจัยโดยตรง (species_province) ไม่ได้ให้ AI เดา

import { useMemo, useState } from "react";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";

import { EN_TO_TH, GEO_URL, TH_TO_EN, useGeoFeatures } from "@/components/ThailandMap";
import type { Lang } from "@/lib/i18n";

type Layer = { species: string; provinces: string[] };

const NONE = "#e5e7eb";
const PAIR = ["#3b82f6", "#f59e0b"]; // เฉพาะชนิดแรก / เฉพาะชนิดที่สอง
const BOTH = "#7c3aed";
const RAMP = ["#bfdbfe", "#93c5fd", "#60a5fa", "#3b82f6", "#1d4ed8"];

const short = (s: string) => `C. ${s.replace(/^Culicoides\s+/i, "")}`;

export function ThailandOverlapMap({ layers, lang }: { layers: Layer[]; lang: Lang }) {
  const geo = useGeoFeatures(GEO_URL);
  const [tip, setTip] = useState<{ name: string; species: string[]; x: number; y: number } | null>(null);
  const th = lang === "th";
  const n = layers.length;

  // จังหวัด (ชื่อภาษาอังกฤษตาม GeoJSON) → ลำดับชนิดที่พบ
  const found = useMemo(() => {
    const m = new Map<string, number[]>();
    layers.forEach((l, i) =>
      l.provinces.forEach((p) => {
        const en = TH_TO_EN[p] ?? p;
        m.set(en, [...(m.get(en) ?? []), i]);
      })
    );
    return m;
  }, [layers]);

  const colorOf = (idx: number[] | undefined) => {
    if (!idx?.length) return NONE;
    if (n === 2) return idx.length === 2 ? BOTH : PAIR[idx[0]];
    if (idx.length === n) return RAMP[RAMP.length - 1];
    return RAMP[Math.min(RAMP.length - 2, Math.round(((idx.length - 1) / Math.max(1, n - 1)) * (RAMP.length - 2)))];
  };

  const display = (en: string) => (th ? EN_TO_TH[en] ?? en : en);
  const all = [...found.entries()].filter(([, i]) => i.length === n).map(([p]) => p);
  const groups: { label: string; color: string; provinces: string[] }[] = [
    {
      label: th
        ? `${n === 2 ? "พบทั้งสองชนิด" : "พบครบทุกชนิด"} (${all.length})`
        : `${n === 2 ? "Both species" : "All species"} (${all.length})`,
      color: n === 2 ? BOTH : RAMP[RAMP.length - 1],
      provinces: all,
    },
  ];
  if (n === 2) {
    layers.forEach((l, i) => {
      const only = [...found.entries()].filter(([, idx]) => idx.length === 1 && idx[0] === i).map(([p]) => p);
      groups.push({ label: `${th ? "เฉพาะ" : "Only"} ${short(l.species)} (${only.length})`, color: PAIR[i], provinces: only });
    });
  }

  return (
    <div className="card-surface space-y-3 p-4">
      <div>
        <p className="text-sm font-medium text-foreground">
          {th ? "จังหวัดที่พบ " : "Provinces with "}
          {layers.map((l, i) => (
            <span key={l.species}>
              {i > 0 && (i === n - 1 ? (th ? " และ " : " and ") : ", ")}
              <span className="italic text-accent">{short(l.species)}</span>
            </span>
          ))}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {th
            ? `${n === 2 ? "พบทั้งสองชนิด" : "พบครบทุกชนิด"} ${all.length} จังหวัด`
            : `${all.length} provinces have ${n === 2 ? "both" : "all of them"}`}
        </p>
      </div>

      {/* คำอธิบายสี */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {n === 2 ? (
          <>
            {layers.map((l, i) => (
              <span key={l.species} className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: PAIR[i] }} />
                {th ? "เฉพาะ" : "Only"} <i>{short(l.species)}</i>
              </span>
            ))}
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded-sm" style={{ background: BOTH }} />
              {th ? "พบทั้งสองชนิด" : "Both"}
            </span>
          </>
        ) : (
          <span className="flex items-center gap-1">
            {RAMP.map((c) => <span key={c} className="inline-block h-3 w-3 rounded-sm" style={{ background: c }} />)}
            <span className="ml-1">{th ? "อ่อน → เข้ม = พบน้อยชนิด → พบครบ" : "light → dark = fewer → all species"}</span>
          </span>
        )}
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ background: NONE }} />
          {th ? "ไม่มีรายงาน" : "No record"}
        </span>
      </div>

      <div className="relative mx-auto w-1/2 min-w-[220px] overflow-hidden rounded-md border bg-muted/20">
        <ComposableMap projection="geoMercator" projectionConfig={{ scale: 2100, center: [101, 13] }} width={500} height={650} style={{ width: "100%", height: "auto" }}>
          <Geographies geography={geo}>
            {({ geographies }) =>
              geographies.map((g) => {
                const en: string = g.properties.name ?? "";
                const idx = found.get(en);
                const fill = colorOf(idx);
                return (
                  <Geography
                    key={g.rsmKey}
                    geography={g}
                    onMouseEnter={(e) => {
                      const svg = (e.target as SVGElement).closest("svg")?.getBoundingClientRect();
                      const r = (e.target as SVGElement).getBoundingClientRect();
                      setTip({
                        name: display(en),
                        species: (idx ?? []).map((i) => short(layers[i].species)),
                        x: r.left - (svg?.left ?? 0) + r.width / 2,
                        y: r.top - (svg?.top ?? 0),
                      });
                    }}
                    onMouseLeave={() => setTip(null)}
                    style={{
                      default: { fill, stroke: "#ffffff", strokeWidth: 0.4, outline: "none" },
                      hover: { fill, stroke: "#111827", strokeWidth: 0.8, outline: "none", cursor: "pointer" },
                      pressed: { outline: "none" },
                    }}
                  />
                );
              })
            }
          </Geographies>
        </ComposableMap>
        {tip && (
          <div
            className="pointer-events-none absolute rounded bg-foreground px-2 py-1 text-xs text-background shadow"
            style={{ left: tip.x, top: tip.y - 4, transform: "translate(-50%, -100%)" }}
          >
            <div className="font-medium">{tip.name}</div>
            <div className="opacity-80">{tip.species.length ? tip.species.join(", ") : th ? "ไม่มีรายงาน" : "No record"}</div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {groups.map((g) => (
          <div key={g.label}>
            <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-foreground">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: g.color }} />
              {g.label}
            </p>
            <div className="flex flex-wrap gap-1">
              {g.provinces.length ? (
                g.provinces.map((p) => (
                  <span key={p} className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
                    {display(p)}
                  </span>
                ))
              ) : (
                <span className="text-[11px] text-muted-foreground">—</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
