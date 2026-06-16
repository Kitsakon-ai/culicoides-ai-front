"use client";

interface TaxonomyTreeProps {
  taxonomy: Record<string, string>;
  label: string;
}

const ALL_SPECIES = ["guttifer", "mahasarakhamense", "oxystoma", "peregrinus"];

const RANK_ORDER = ["kingdom", "phylum", "class", "order", "family", "genus"];
const RANK_LABEL: Record<string, string> = {
  kingdom: "Kingdom",
  phylum: "Phylum",
  class: "Class",
  order: "Order",
  family: "Family",
  genus: "Genus",
};

const ACCENT = "#3b82f6";
const GRAY   = "#94a3b8";
const BLUE   = "#3b82f6";

// Each staircase step
const STEP_X = 44;
const STEP_Y = 52;
const START_X = 44;
const START_Y = 44;

// Species tips (rightmost x)
const TIP_X = 630;

// Species step
const SP_STEP_Y = 52;

const W = 820;

export function TaxonomyTree({ taxonomy, label }: TaxonomyTreeProps) {
  const predicted = (taxonomy.species ?? "").toLowerCase().trim();
  const ranks = RANK_ORDER.filter((r) => taxonomy[r]);

  const nodes = ranks.map((rank, i) => ({
    rank,
    rankLabel: RANK_LABEL[rank] ?? rank,
    value: taxonomy[rank],
    x: START_X + i * STEP_X,
    y: START_Y + i * STEP_Y,
    isGenus: rank === "genus",
  }));

  const genus = nodes.at(-1)!;
  const spYs = ALL_SPECIES.map((_, i) => genus.y + i * SP_STEP_Y);
  const cladeX = genus.x + 28;
  const svgH = (spYs.at(-1) ?? genus.y) + 42;

  return (
    <div className="card-surface p-4 overflow-x-auto">
      {label && <p className="label-caps mb-3">{label}</p>}
      <svg
        viewBox={`0 0 ${W} ${svgH}`}
        className="w-full min-w-120"
        style={{ height: svgH }}
        aria-label="Taxonomy cladogram"
      >
        {/*
         * Staircase backbone: H-first L-shape (RIGHT then DOWN).
         * Each horizontal step is STEP_X wide — same length for every rank.
         * No long lines extending to the right; labels sit at each L-corner.
         */}
        {nodes.slice(0, -1).map((node, i) => {
          const next = nodes[i + 1];
          return (
            <path
              key={`bb-${i}`}
              d={`M ${node.x} ${node.y} H ${next.x} V ${next.y}`}
              fill="none"
              stroke={BLUE}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}

        {/* Short horizontal from Genus node → clade bar */}
        <line
          x1={genus.x} y1={genus.y}
          x2={cladeX}   y2={genus.y}
          stroke={BLUE} strokeWidth={2}
        />

        {/* Vertical clade bar for species */}
        <line
          x1={cladeX} y1={spYs[0]}
          x2={cladeX} y2={spYs.at(-1)!}
          stroke={GRAY} strokeWidth={2}
        />

        {/* ── Species branches ── */}
        {ALL_SPECIES.map((sp, i) => {
          const isHit = sp === predicted;
          const col  = isHit ? ACCENT : GRAY;
          const sy   = spYs[i];
          return (
            <g key={sp}>
              <line
                x1={cladeX} y1={sy}
                x2={TIP_X}  y2={sy}
                stroke={col} strokeWidth={isHit ? 2.5 : 1.5}
              />
              {isHit && (
                <circle cx={TIP_X} cy={sy} r={11}
                  fill="none" stroke={ACCENT} strokeWidth={1.5} opacity={0.25}
                />
              )}
              <circle cx={TIP_X} cy={sy} r={isHit ? 6 : 4} fill={col} />
              {isHit && (
                <text
                  x={TIP_X + 12} y={sy - 10}
                  fontSize={8.5} fill={ACCENT} opacity={0.9}
                  fontFamily="system-ui, -apple-system, sans-serif"
                >
                  ▶ Predicted
                </text>
              )}
              <text
                x={TIP_X + 12} y={sy + 5}
                fontSize={isHit ? 12 : 11}
                fill={col}
                fontWeight={isHit ? "700" : "400"}
                fontStyle="italic"
                fontFamily="system-ui, -apple-system, sans-serif"
              >
                C. {sp}
              </text>
            </g>
          );
        })}

        {/* "Species" rank label above first species */}
        <text
          x={TIP_X + 12} y={spYs[0] - 18}
          fontSize={9} fill={GRAY}
          fontFamily="system-ui, -apple-system, sans-serif"
        >
          Species
        </text>

        {/* ── Rank node circles ── */}
        {nodes.map((node) => (
          <circle key={`dot-${node.rank}`}
            cx={node.x} cy={node.y} r={4} fill={BLUE}
          />
        ))}

        {/*
         * Labels for Kingdom → Family: placed just right of each L-corner
         * (at next.x + 6, node.y ± offset) so they never cross the vertical segment.
         */}
        {nodes.slice(0, -1).map((node, i) => {
          const next = nodes[i + 1];
          const lx = next.x + 6;
          return (
            <g key={`lbl-${node.rank}`}>
              <text
                x={lx} y={node.y - 8}
                fontSize={9} fill={GRAY}
                fontFamily="system-ui, -apple-system, sans-serif"
              >
                {node.rankLabel}
              </text>
              <text
                x={lx} y={node.y + 9}
                fontSize={11} fill="#1e293b" fontWeight="500"
                fontFamily="system-ui, -apple-system, sans-serif"
              >
                {node.value}
              </text>
            </g>
          );
        })}

        {/* Genus label: same style, placed just right of the clade bar */}
        <text
          x={cladeX + 6} y={genus.y - 8}
          fontSize={9} fill={GRAY}
          fontFamily="system-ui, -apple-system, sans-serif"
        >
          {genus.rankLabel}
        </text>
        <text
          x={cladeX + 6} y={genus.y + 9}
          fontSize={11} fill="#1e293b" fontWeight="500" fontStyle="italic"
          fontFamily="system-ui, -apple-system, sans-serif"
        >
          {genus.value}
        </text>
      </svg>
    </div>
  );
}
