"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Loader2, ExternalLink } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

interface ExplanationBlockProps {
  text: string;
  label: string;
  aiModel: string;
  isLoading?: boolean;
  annotatedImage?: string | null;
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
    <ol className="mb-2.5 last:mb-0 space-y-1.5 pl-0 list-none">
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
  hr: () => <hr className="my-3 border-border/50" />,
  // The model has no way to attach a real image inline in this text response —
  // the annotated wing photo above is the only real image. Drop any markdown
  // image syntax it emits anyway instead of rendering a broken <img>.
  img: () => null,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-accent/40 pl-3 text-sm italic text-muted-foreground my-2.5">
      {children}
    </blockquote>
  ),
};

function openImageInTab(src: string) {
  const html = `<!DOCTYPE html><html><head><title>Wing Morphology Annotation</title>
<style>body{margin:0;background:#111;display:flex;justify-content:center;}img{max-width:100%;height:auto;}</style>
</head><body><img src="${src}" alt="Wing annotation"/></body></html>`;
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
}

export function ExplanationBlock({ text, label, aiModel, isLoading, annotatedImage }: ExplanationBlockProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
    >
      {label && <p className="label-caps mb-3">{label}</p>}

      <div className="card-surface overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-2.5">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent" />
          <span className="text-xs font-medium text-foreground">AI Explanation</span>

          {aiModel && (
            <span className="ml-auto rounded border border-accent/30 bg-accent/5 px-1.5 py-0.5 font-mono text-[10px] text-accent">
              {aiModel}
            </span>
          )}
        </div>

        {/* Annotated wing image */}
        <AnimatePresence>
          {annotatedImage && !isLoading && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3 }}
              className="border-t px-4 pt-3 pb-3 space-y-2"
            >
              <p className="label-caps text-[10px] text-muted-foreground">Wing Morphology Annotation</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={annotatedImage}
                alt="Annotated wing morphology"
                className="w-full rounded-md border object-contain"
              />
              <button
                onClick={() => openImageInTab(annotatedImage)}
                className="flex items-center gap-1.5 text-[11px] text-accent hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                เปิดรูปขนาดเต็ม
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Body: big loader while waiting for the first token; once text starts
            streaming in, show it live below with a small "typing" indicator. */}
        {isLoading && !text.trim() ? (
          <div className="flex flex-col items-center justify-center gap-5 px-4 py-16">
            <div className="relative flex h-20 w-20 items-center justify-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/20" />
              <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-accent/10">
                <Loader2 className="h-10 w-10 animate-spin text-accent" />
              </span>
            </div>
            <div className="space-y-1.5 text-center">
              <p className="text-lg font-semibold text-foreground">
                กำลังสร้างคำอธิบายจาก AI
              </p>
              <p className="text-sm text-muted-foreground">
                {aiModel ? `${aiModel} ` : ""}กำลังวิเคราะห์ภาพและ heatmap...
              </p>
            </div>
            <div className="w-full max-w-md space-y-2.5 pt-1">
              <div className="h-3 w-full animate-pulse rounded bg-muted" />
              <div className="h-3 w-11/12 animate-pulse rounded bg-muted" />
              <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
            </div>
          </div>
        ) : (
          <div className="px-4 py-4">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
              {text}
            </ReactMarkdown>
            {isLoading && (
              <span className="mt-3 inline-flex items-center gap-1.5 text-xs text-accent">
                <Loader2 className="h-3 w-3 animate-spin" />
                กำลังสร้างคำอธิบาย...
              </span>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
