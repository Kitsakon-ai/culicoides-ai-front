import { motion } from "framer-motion";

interface TaxonomyTreeProps {
  taxonomy: Record<string, string>;
  label: string;
}

const ICONS: Record<string, string> = {
  Domain: "🌍",
  Kingdom: "👑",
  Phylum: "🦴",
  Class: "🐛",
  Order: "🪰",
  Suborder: "📂",
  Family: "✅",
  Subfamily: "✅",
  Genus: "✅",
  Species: "🎯",
};

export function TaxonomyTree({ taxonomy, label }: TaxonomyTreeProps) {
  const entries = Object.entries(taxonomy);

  return (
    <div>
      {label && <p className="label-caps mb-3">{label}</p>}
      <div className="card-surface p-4">
        <div className="space-y-0">
          {entries.map(([rank, value], i) => (
            <motion.div
              key={rank}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04, duration: 0.2 }}
              className="flex items-center gap-2"
              style={{ paddingLeft: i * 16 }}
            >
              {i > 0 && (
                <span className="text-muted-foreground/30">└</span>
              )}
              <span className="text-xs">{ICONS[rank] ?? "·"}</span>
              <span className="text-xs text-muted-foreground">{rank}:</span>
              <span className={`font-mono text-xs ${rank === "Species" ? "font-bold text-accent" : "text-foreground"}`}>
                {value}
              </span>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
