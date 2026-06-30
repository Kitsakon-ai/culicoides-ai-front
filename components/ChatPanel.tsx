"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Trash2, Bot, User, Sparkles } from "lucide-react";
import type { ChatMessage } from "@/lib/types";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

const assistantMd: Components = {
  p: ({ children }) => <p className="mb-1.5 last:mb-0 text-sm leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="mb-1.5 last:mb-0 space-y-1 pl-0">{children}</ul>,
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
}

export function ChatPanel({
  messages,
  onSend,
  onClear,
  labels,
  isLoading,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isLoading]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    setInput("");
    await onSend(text);
  };

  return (
    <div className="card-surface flex h-[70vh] min-h-[420px] flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 px-4 py-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/15">
          <Sparkles className="h-3.5 w-3.5 text-accent" />
        </div>
        <p className="text-sm font-medium text-foreground">{labels.chat}</p>
        {messages.length > 0 && (
          <button
            onClick={onClear}
            className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <Trash2 className="h-3 w-3" />
            {labels.clearChat}
          </button>
        )}
      </div>

      {/* Messages — scrolls internally, input stays pinned below */}
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary">
              <Bot className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="max-w-xs text-xs text-muted-foreground">
              {labels.chatPlaceholder}
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex items-end gap-2 ${
              msg.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            {msg.role === "assistant" && (
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15">
                <Bot className="h-3.5 w-3.5 text-accent" />
              </div>
            )}
            <div
              className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 ${
                msg.role === "user"
                  ? "rounded-br-sm bg-accent text-accent-foreground text-sm leading-relaxed"
                  : "rounded-bl-sm bg-secondary text-secondary-foreground"
              }`}
            >
              {msg.role === "user" ? (
                msg.content
              ) : (
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={assistantMd}>
                  {msg.content}
                </ReactMarkdown>
              )}
            </div>
            {msg.role === "user" && (
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                <User className="h-3.5 w-3.5" />
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex items-end gap-2 justify-start">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15">
              <Bot className="h-3.5 w-3.5 text-accent" />
            </div>
            <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-secondary px-3.5 py-3">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60" />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input bar — anchored to the bottom of the chat frame */}
      <div className="flex shrink-0 items-center gap-2 border-t bg-background/80 px-3 py-3 backdrop-blur-sm">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder={labels.chatPlaceholder}
          className="flex-1 rounded-full border bg-background px-4 py-2.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:ring-1 focus:ring-accent"
          disabled={isLoading}
        />
        <button
          onClick={() => void handleSend()}
          disabled={!input.trim() || isLoading}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
