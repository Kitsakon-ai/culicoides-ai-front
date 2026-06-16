"use client";

import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

interface ExplanationBlockProps {
  text: string;
  label: string;
  aiModel: string;
}

const mdComponents: Components = {
  h1: ({ children }) => (
    <p className="mt-5 mb-2 first:mt-0 text-sm font-semibold text-foreground border-l-2 border-accent pl-2">
      {children}
    </p>
  ),
  h2: ({ children }) => (
    <p className="mt-5 mb-2 first:mt-0 text-sm font-semibold text-foreground border-l-2 border-accent pl-2">
      {children}
    </p>
  ),
  h3: ({ children }) => (
    <p className="mt-3 mb-1.5 first:mt-0 text-xs font-semibold text-muted-foreground">
      {children}
    </p>
  ),
  p: ({ children }) => (
    <p className="mb-2.5 last:mb-0 text-sm leading-relaxed text-foreground">
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul className="mb-2.5 last:mb-0 space-y-1.5 pl-0">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2.5 last:mb-0 space-y-1.5 pl-0 list-none counter-reset-item">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="flex items-start gap-2 text-sm leading-relaxed text-foreground">
      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent/50" />
      <span className="flex-1">{children}</span>
    </li>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ children }) => (
    <em className="italic text-muted-foreground">{children}</em>
  ),
  hr: () => (
    <hr className="my-3 border-border/50" />
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-accent/40 pl-3 text-sm italic text-muted-foreground my-2.5">
      {children}
    </blockquote>
  ),
};

export function ExplanationBlock({ text, label, aiModel }: ExplanationBlockProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
    >
      {label && <p className="label-caps mb-3">{label}</p>}

      <div className="card-surface overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 border-b px-4 py-2.5">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent" />
          <span className="text-xs font-medium text-foreground">AI Explanation</span>
          {aiModel && (
            <span className="ml-auto rounded border border-accent/30 bg-accent/5 px-1.5 py-0.5 font-mono text-[10px] text-accent">
              {aiModel}
            </span>
          )}
        </div>

        {/* Markdown body */}
        <div className="px-4 py-4">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
            {text}
          </ReactMarkdown>
        </div>
      </div>
    </motion.div>
  );
}
