"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Trash2, Bot, User, Sparkles } from "lucide-react";
import type { ChatMessage } from "@/lib/types";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

const assistantMd: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0 text-sm leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 last:mb-0 space-y-1 pl-0">{children}</ul>,
  li: ({ children }) => (
    <li className="flex items-start gap-1.5 text-sm leading-relaxed">
      <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-current opacity-50" />
      <span className="flex-1">{children}</span>
    </li>
  ),
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic opacity-80">{children}</em>,
  h1: ({ children }) => <p className="text-sm font-semibold mt-3 mb-1.5 first:mt-0 border-l-2 border-current pl-2 opacity-90">{children}</p>,
  h2: ({ children }) => <p className="text-sm font-semibold mt-3 mb-1.5 first:mt-0 border-l-2 border-current pl-2 opacity-90">{children}</p>,
  h3: ({ children }) => <p className="text-xs font-semibold mt-2 mb-1 first:mt-0 opacity-70">{children}</p>,
};

interface ChatPanelProps {
  messages: ChatMessage[];
  onSend: (message: string) => void | Promise<void>;
  onClear: () => void;
  labels: Record<string, string>;
  isLoading: boolean;
  suggestions?: string[];
}

export function ChatPanel({
  messages,
  onSend,
  onClear,
  labels,
  isLoading,
  suggestions = [],
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  // เลื่อนเฉพาะ "ภายในกล่องแชต" ไปข้อความล่าสุด — ไม่เลื่อนทั้งหน้า
  // (กันหน้าผลลัพธ์เด้งลงมาที่แชตตอน seed คำอธิบายอัตโนมัติ)
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, isLoading]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;
    setInput("");
    await onSend(trimmed);
  };

  return (
    <div className="card-surface flex h-[72vh] min-h-[640px] flex-col overflow-hidden">
      {/* Toolbar — clear button, only when there is a conversation */}
      {messages.length > 0 && (
        <div className="flex shrink-0 items-center justify-end border-b bg-background/60 px-4 py-2">
          <button
            onClick={onClear}
            className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-destructive"
          >
            <Trash2 className="h-3 w-3" />
            {labels.clearChat}
          </button>
        </div>
      )}

      {/* Messages — scrolls internally, input stays pinned below */}
      <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10 ring-1 ring-accent/15">
              <Sparkles className="h-7 w-7 text-accent" />
            </div>
            <p className="max-w-sm text-sm text-muted-foreground">{labels.chatPlaceholder}</p>
            {suggestions.length > 0 && (
              <div className="flex max-w-md flex-wrap justify-center gap-2 pt-1">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => void send(s)}
                    className="rounded-full border bg-background px-3.5 py-2 text-xs text-foreground/80 transition-colors hover:border-accent/50 hover:bg-accent/5 hover:text-accent"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex items-end gap-2.5 ${
              msg.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            {msg.role === "assistant" && (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15">
                <Bot className="h-4 w-4 text-accent" />
              </div>
            )}
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-sm ${
                msg.role === "user"
                  ? "rounded-br-sm bg-accent text-accent-foreground text-sm leading-relaxed"
                  : "rounded-bl-sm bg-secondary text-secondary-foreground"
              }`}
            >
              {msg.role === "user" ? (
                msg.content
              ) : (
                <>
                  {msg.imageUrl && (
                    <div className="mb-2.5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={msg.imageUrl}
                        alt="AI generated image"
                        className="max-w-full rounded-lg border border-border/40 object-contain"
                        style={{ maxHeight: 400 }}
                      />
                      <a
                        href={msg.imageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 flex items-center gap-1 text-[10px] text-accent hover:underline"
                      >
                        เปิดรูปขนาดเต็ม ↗
                      </a>
                    </div>
                  )}
                  {!msg.imageUrl && msg.imageError && (
                    <div className="mb-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive">
                      สร้างภาพไม่สำเร็จ: {msg.imageError}
                    </div>
                  )}
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={assistantMd}>
                    {msg.content}
                  </ReactMarkdown>
                </>
              )}
            </div>
            {msg.role === "user" && (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                <User className="h-4 w-4" />
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex items-end gap-2.5 justify-start">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15">
              <Bot className="h-4 w-4 text-accent" />
            </div>
            <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-secondary px-4 py-3.5">
              <span className="h-1.5 w-1.5 animate-bounce-high rounded-full bg-muted-foreground/70 [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce-high rounded-full bg-muted-foreground/70 [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce-high rounded-full bg-muted-foreground/70" />
            </div>
          </div>
        )}
      </div>

      {/* Input bar — anchored to the bottom of the chat frame */}
      <div className="flex shrink-0 items-center gap-2.5 border-t bg-background/80 px-4 py-3.5 backdrop-blur-sm">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void send(input);
            }
          }}
          placeholder={labels.chatPlaceholder}
          className="flex-1 rounded-full border bg-background px-4 py-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:ring-1 focus:ring-accent"
          disabled={isLoading}
        />
        <button
          onClick={() => void send(input)}
          disabled={!input.trim() || isLoading}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
