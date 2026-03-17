import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

interface ExplanationBlockProps {
  text: string;
  label: string;
  aiModel: string;
}

export function ExplanationBlock({ text, label, aiModel }: ExplanationBlockProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
    >
      {label && (
        <div className="flex items-center gap-2 mb-3">
          <p className="label-caps">{label}</p>
          <span className="font-mono rounded-md border px-1.5 py-0.5 text-[10px] text-accent">
            {aiModel}
          </span>
        </div>
      )}
      <div className="card-surface p-4">
        <div className="flex gap-2.5">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
          <div className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
            {text}
          </div>
        </div>
        {!label && aiModel && (
          <div className="mt-3 pt-3 border-t">
            <span className="font-mono text-[10px] text-muted-foreground">
              Powered by {aiModel}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
}
