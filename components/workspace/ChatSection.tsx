"use client";

import { MessageSquare } from "lucide-react";

import type { Lang } from "@/lib/i18n";
import type { CulicoidesAnalysis } from "@/hooks/useCulicoidesAnalysis";
import { ChatPanel } from "@/components/ChatPanel";

interface Props {
  analysis: CulicoidesAnalysis;
  lang: Lang;
  t: Record<string, string>;
}

export function ChatSection({ analysis, lang, t }: Props) {
  const { selectedAiName, chatMessages, handleChatSend, setChatMessages, isChatLoading } = analysis;

  const suggestions =
    lang === "th"
      ? ["ลักษณะเด่นของชนิดนี้คืออะไร", "พบในจังหวัดไหนบ้าง", "เป็นพาหะนำโรคอะไร", "Grad-CAM บอกอะไรเรา"]
      : ["Key wing features?", "Which provinces is it found in?", "What diseases does it transmit?", "What does Grad-CAM show?"];

  return (
    <div className="space-y-3">
      {/* หัวข้อ section แบบเดียวกับแผนที่/Grad-CAM ในหน้าผลลัพธ์ */}
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/10">
          <MessageSquare className="h-3.5 w-3.5 text-accent" />
        </div>
        <span className="text-sm font-medium text-foreground">
          {lang === "th" ? "แชต AI" : "AI Chat"}
        </span>
        {selectedAiName && (
          <span className="text-xs text-muted-foreground">· {selectedAiName}</span>
        )}
      </div>

      <ChatPanel
        messages={chatMessages}
        onSend={handleChatSend}
        onClear={() => setChatMessages([])}
        labels={t as unknown as Record<string, string>}
        isLoading={isChatLoading}
        suggestions={suggestions}
      />
    </div>
  );
}
