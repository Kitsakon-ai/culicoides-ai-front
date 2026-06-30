"use client";

import { useState } from "react";
import { GitBranch } from "lucide-react";

interface TaxonomyTreeProps {
  taxonomy: Record<string, string>;
  label: string;
}

// Sibling genera within family Ceratopogonidae, shown for context alongside
// the predicted genus — mirrors a standard genus→species cladogram layout.
const FAMILY_GENERA = ["Culicoides", "Forcipomyia", "Dasyhelea", "Leptoconops", "Bezzia"];

// Representative species per genus — only Culicoides reflects the model's
// actual candidate list; the rest are illustrative real species for context.
const GENUS_SPECIES: Record<string, string[]> = {
  culicoides: ["guttifer", "mahasarakhamense", "oxystoma", "peregrinus"],
  forcipomyia: ["taiwana", "fuliginosa", "eques"],
  dasyhelea: ["obscura", "sonorensis", "bisanensis"],
  leptoconops: ["kerteszi", "torrens", "becquaerti"],
  bezzia: ["annulipes", "setulosa", "nobilis"],
};

const ACCENT = "#3b82f6";
const GRAY = "#94a3b8";
const INK = "#1e293b";

// ── Genus column (left) ──
const GENUS_PANEL_X = 16;
const GENUS_PANEL_W = 160;
const GENUS_ROOT_X = 32;
const GENUS_TIP_X = 130;
const GENUS_START_Y = 78;
const GENUS_STEP_Y = 36;

// ── Species column (right) ──
const SPECIES_CLADE_X = 430;
const SPECIES_TIP_X = 680;
const SPECIES_START_Y = 78;
const SPECIES_STEP_Y = 42;

const W = 800;
const COLLAPSED_W = GENUS_TIP_X + 160;

export function TaxonomyTree({ taxonomy, label }: TaxonomyTreeProps) {
  const predictedSpecies = (taxonomy.species ?? "").toLowerCase().trim();
  const predictedGenus = (taxonomy.genus ?? "Culicoides").toLowerCase().trim();

  const [expandedGenus, setExpandedGenus] = useState<string | null>(predictedGenus);

  const genera = FAMILY_GENERA.map((g, i) => ({
    name: g,
    key: g.toLowerCase(),
    isPredicted: g.toLowerCase() === predictedGenus,
    y: GENUS_START_Y + i * GENUS_STEP_Y,
  }));

  const activeGenus = genera.find((g) => g.key === expandedGenus) ?? null;
  const activeSpecies = activeGenus ? GENUS_SPECIES[activeGenus.key] ?? [] : [];

  const spYs = activeSpecies.map((_, i) => SPECIES_START_Y + i * SPECIES_STEP_Y);
  const genusFirstY = genera[0].y;
  const genusLastY = genera.at(-1)!.y;
  const isExpanded = activeGenus !== null && activeSpecies.length > 0;
  const svgW = isExpanded ? W : COLLAPSED_W;
  const svgH = isExpanded ? Math.max(genusLastY, spYs.at(-1) ?? 0) + 46 : genusLastY + 46;

  return (
    <div className="card-surface overflow-hidden">
      {label && (
        <div className="flex items-center gap-2 px-4 py-2.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/10">
            <GitBranch className="h-3.5 w-3.5 text-accent" />
          </div>
          <span className="text-xs font-medium text-foreground">{label}</span>
        </div>
      )}

      <div className="overflow-x-auto p-4">
        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          className={isExpanded ? "w-full min-w-150" : "w-full min-w-75"}
          style={{ height: svgH }}
          aria-label="Taxonomy cladogram"
        >
          {/* Genus column background panel */}
          <rect
            x={GENUS_PANEL_X}
            y={0}
            width={GENUS_PANEL_W}
            height={svgH}
            fill="#f1f5f9"
            rx={6}
          />

          {/* Column headers */}
          <text
            x={GENUS_PANEL_X + 14}
            y={26}
            fontSize={15}
            fontWeight="700"
            fill={INK}
            fontFamily="system-ui, -apple-system, sans-serif"
          >
            Genus
          </text>
          {isExpanded && activeGenus && (
            <>
              <text
                x={SPECIES_CLADE_X - 130}
                y={26}
                fontSize={15}
                fontWeight="700"
                fill={INK}
                fontFamily="system-ui, -apple-system, sans-serif"
              >
                Species
              </text>
              <text
                x={SPECIES_CLADE_X - 130}
                y={40}
                fontSize={9.5}
                fontStyle="italic"
                fill={GRAY}
                fontFamily="system-ui, -apple-system, sans-serif"
              >
                {activeGenus.name} specific epithet
              </text>
            </>
          )}

          {/* Family root → genus clade bar */}
          <line
            x1={GENUS_ROOT_X}
            y1={genusFirstY}
            x2={GENUS_ROOT_X}
            y2={genusLastY}
            stroke={GRAY}
            strokeWidth={2}
          />

          {/* ── Genus branches — every genus is clickable to reveal its species ── */}
          {genera.map((g) => {
            const isOpen = g.key === expandedGenus;
            const col = g.isPredicted ? ACCENT : isOpen ? ACCENT : GRAY;
            return (
              <g
                key={g.name}
                onClick={() => setExpandedGenus((prev) => (prev === g.key ? null : g.key))}
                style={{ cursor: "pointer" }}
              >
                <line
                  x1={GENUS_ROOT_X}
                  y1={g.y}
                  x2={GENUS_TIP_X}
                  y2={g.y}
                  stroke={col}
                  strokeWidth={isOpen || g.isPredicted ? 2.5 : 1.5}
                />
                <circle cx={GENUS_TIP_X} cy={g.y} r={isOpen || g.isPredicted ? 5.5 : 4} fill={col} />
                <text
                  x={GENUS_TIP_X + 10}
                  y={g.y + 4}
                  fontSize={10}
                  fill={col}
                  fontFamily="system-ui, -apple-system, sans-serif"
                  style={{ userSelect: "none" }}
                >
                  {isOpen ? "▾" : "▸"}
                </text>
                <text
                  x={GENUS_TIP_X + 22}
                  y={g.y + 4}
                  fontSize={g.isPredicted ? 12.5 : 11}
                  fontStyle="italic"
                  fontWeight={g.isPredicted || isOpen ? "700" : "400"}
                  fill={col === GRAY ? INK : col}
                  fontFamily="system-ui, -apple-system, sans-serif"
                >
                  {g.name}
                </text>
              </g>
            );
          })}

          {isExpanded && activeGenus && (
            <>
              {/* Dashed connector: expanded genus → species clade */}
              <path
                d={`M ${GENUS_TIP_X + 8} ${activeGenus.y}
                    C ${(GENUS_TIP_X + SPECIES_CLADE_X) / 2} ${activeGenus.y},
                      ${(GENUS_TIP_X + SPECIES_CLADE_X) / 2} ${(spYs[0] + spYs.at(-1)!) / 2},
                      ${SPECIES_CLADE_X} ${(spYs[0] + spYs.at(-1)!) / 2}`}
                fill="none"
                stroke={ACCENT}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                opacity={0.6}
              />

              {/* Species clade bar */}
              <line
                x1={SPECIES_CLADE_X}
                y1={spYs[0]}
                x2={SPECIES_CLADE_X}
                y2={spYs.at(-1)!}
                stroke={GRAY}
                strokeWidth={2}
              />

              {/* ── Species branches ── */}
              {activeSpecies.map((sp, i) => {
                const isHit = activeGenus.isPredicted && sp === predictedSpecies;
                const col = isHit ? ACCENT : GRAY;
                const sy = spYs[i];
                return (
                  <g key={sp}>
                    <line
                      x1={SPECIES_CLADE_X}
                      y1={sy}
                      x2={SPECIES_TIP_X}
                      y2={sy}
                      stroke={col}
                      strokeWidth={isHit ? 2.5 : 1.5}
                    />
                    {isHit && (
                      <circle
                        cx={SPECIES_TIP_X}
                        cy={sy}
                        r={11}
                        fill="none"
                        stroke={ACCENT}
                        strokeWidth={1.5}
                        opacity={0.25}
                      />
                    )}
                    <circle cx={SPECIES_TIP_X} cy={sy} r={isHit ? 6 : 4} fill={col} />
                    {isHit && (
                      <text
                        x={SPECIES_TIP_X + 12}
                        y={sy - 10}
                        fontSize={8.5}
                        fill={ACCENT}
                        opacity={0.9}
                        fontFamily="system-ui, -apple-system, sans-serif"
                      >
                        ▶ Predicted
                      </text>
                    )}
                    <text
                      x={SPECIES_TIP_X + 12}
                      y={sy + 5}
                      fontSize={isHit ? 12 : 11}
                      fill={col}
                      fontWeight={isHit ? "700" : "400"}
                      fontStyle="italic"
                      fontFamily="system-ui, -apple-system, sans-serif"
                    >
                      {activeGenus.name[0]}. {sp}
                    </text>
                  </g>
                );
              })}
            </>
          )}
        </svg>
      </div>
    </div>
  );
}
