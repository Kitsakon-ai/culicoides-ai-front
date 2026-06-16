"use client";

import { useState } from "react";
import { Send, Trash2 } from "lucide-react";
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

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    setInput("");
    await onSend(text);
  };

  return (
    <div className="flex flex-col">
      <div className="mb-3 flex items-center justify-between">
        <p className="label-caps">{labels.chat}</p>
        {messages.length > 0 && (
          <button
            onClick={onClear}
            className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <Trash2 className="h-3 w-3" />
            {labels.clearChat}
          </button>
        )}
      </div>

      <div className="card-surface mb-3 max-h-80 min-h-[160px] overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <p className="py-8 text-center text-xs text-muted-foreground">
            {labels.chatPlaceholder}
          </p>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex gap-2 ${
              msg.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 ${
                msg.role === "user"
                  ? "bg-accent text-accent-foreground text-sm leading-relaxed"
                  : "bg-secondary text-secondary-foreground"
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
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-2 justify-start">
            <div className="bg-secondary rounded-lg px-3 py-2">
              <span className="text-xs text-muted-foreground animate-pulse">
                ...
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2">
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
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:ring-1 focus:ring-accent"
          disabled={isLoading}
        />
        <button
          onClick={() => void handleSend()}
          disabled={!input.trim() || isLoading}
          className="flex h-9 w-9 items-center justify-center rounded-md bg-accent text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-40"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}