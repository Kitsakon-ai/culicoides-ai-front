import { useState } from "react";
import { Send, Trash2 } from "lucide-react";
import type { ChatMessage } from "@/lib/types";

interface ChatPanelProps {
  messages: ChatMessage[];
  onSend: (message: string) => void;
  onClear: () => void;
  labels: Record<string, string>;
  isLoading: boolean;
}

export function ChatPanel({ messages, onSend, onClear, labels, isLoading }: ChatPanelProps) {
  const [input, setInput] = useState("");

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    onSend(input.trim());
    setInput("");
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <p className="label-caps">{labels.chat}</p>
        {messages.length > 0 && (
          <button
            onClick={onClear}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <Trash2 className="h-3 w-3" />
            {labels.clearChat}
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="card-surface mb-3 max-h-80 min-h-[160px] overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-8">
            {labels.chatPlaceholder}
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-accent text-accent-foreground"
                  : "bg-secondary text-secondary-foreground"
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex gap-2 justify-start">
            <div className="bg-secondary rounded-lg px-3 py-2">
              <span className="text-xs text-muted-foreground animate-pulse">...</span>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder={labels.chatPlaceholder}
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:ring-1 focus:ring-accent"
          disabled={isLoading}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || isLoading}
          className="flex h-9 w-9 items-center justify-center rounded-md bg-accent text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-40"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
