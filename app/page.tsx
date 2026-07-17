"use client";

import { useState } from "react";
import {
  Play,
  Loader2,
  Upload,
  BarChart3,
  Settings2,
  Bug,
  ChevronRight,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import { TEXT, type Lang } from "@/lib/i18n";
import {
  ML_MODELS,
  AI_MODELS,
  AI_PROVIDER_ORDER,
  AI_PROVIDER_LABEL,
} from "@/lib/types";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { LanguageToggle } from "@/components/LanguageToggle";
import { ModelSelector } from "@/components/ModelSelector";
import { useCulicoidesAnalysis, type NavSection } from "@/hooks/useCulicoidesAnalysis";
import { UploadSection } from "@/components/workspace/UploadSection";
import { ResultsSection } from "@/components/workspace/ResultsSection";
import { ChatSection } from "@/components/workspace/ChatSection";
import { InspectorSection } from "@/components/workspace/InspectorSection";

export default function Index() {
  const [lang, setLang] = useState<Lang>("th");
  const t = TEXT[lang];
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const analysis = useCulicoidesAnalysis(lang);
  const {
    mlModel,
    setMlModel,
    aiModel,
    setAiModel,
    activeNav,
    setActiveNav,
    imagePreview,
    result,
    isAnalyzing,
    handleRunInference,
  } = analysis;

  const navItems: { id: NavSection; label: string; icon: React.ElementType }[] = [
    { id: "upload", label: lang === "th" ? "อัปโหลด" : "Upload", icon: Upload },
    { id: "results", label: lang === "th" ? "ผลลัพธ์" : "Results", icon: BarChart3 },
    { id: "inspector", label: "Inspector", icon: Settings2 },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-background print:h-auto print:overflow-visible">
      <aside
        className={`hidden md:flex md:flex-col flex-shrink-0 border-r bg-background transition-all duration-200 print:hidden ${sidebarOpen ? "w-60" : "w-0 overflow-hidden"
          }`}
      >
        <div className="flex h-14 items-center gap-2.5 border-b px-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-accent-foreground">
            <Bug className="h-4 w-4" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-foreground">Culicoides AI</span>
            <span className="text-[10px] text-muted-foreground">Research</span>
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          <p className="label-caps mb-2 px-3">Workspace</p>
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveNav(item.id)}
              className={`next-nav-item w-full ${activeNav === item.id ? "next-nav-item-active" : ""
                }`}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="border-t p-3 space-y-4">
          <ModelSelector
            label={t.selectMl}
            models={ML_MODELS}
            selectedId={mlModel}
            onSelect={setMlModel}
          />
          <ModelSelector
            label={t.selectAi}
            models={AI_MODELS}
            selectedId={aiModel}
            onSelect={setAiModel}
          />
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 flex-shrink-0 items-center justify-between px-4 md:px-6 print:hidden">
          <div className="flex items-center gap-2">
            <button
              className="md:hidden flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:text-foreground"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              <Bug className="h-4 w-4" />
            </button>

            <div className="flex items-center gap-1.5 text-sm">
              <span className="text-muted-foreground">Culicoides AI</span>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
              <span className="font-medium text-foreground">
                {navItems.find((n) => n.id === activeNav)?.label}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <LanguageToggle lang={lang} onChange={setLang} />

            {imagePreview && !result && (
              <button
                onClick={handleRunInference}
                disabled={isAnalyzing}
                className="hidden md:flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-60"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {t.analyzing}
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5" />
                    {t.runInference}
                  </>
                )}
              </button>
            )}
          </div>
        </header>
        <div className="flex md:hidden border-b overflow-x-auto print:hidden">
          <div className="md:hidden border-b px-4 py-3 space-y-3 bg-background">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                {t.selectMl}
              </label>
              <select
                value={mlModel}
                onChange={(e) => setMlModel(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {ML_MODELS.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                {t.selectAi}
              </label>
              <Select value={aiModel} onValueChange={setAiModel}>
                <SelectTrigger className="w-full text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AI_PROVIDER_ORDER.map((provider) => {
                    const items = AI_MODELS.filter((m) => m.provider === provider);
                    if (!items.length) return null;
                    return (
                      <SelectGroup key={provider}>
                        <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                          {AI_PROVIDER_LABEL[provider]}
                        </SelectLabel>
                        {items.map((m) => (
                          <SelectItem key={m.id} value={m.id} className="text-sm">
                            {m.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="flex md:hidden border-b overflow-x-auto print:hidden">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveNav(item.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors border-b-2 whitespace-nowrap ${activeNav === item.id
                ? "border-accent text-foreground"
                : "border-transparent text-muted-foreground"
                }`}
            >
              <item.icon className="h-3.5 w-3.5" />
              {item.label}
            </button>
          ))}
        </div>

        <main className="flex-1 overflow-y-auto print:overflow-visible">
          <div className="mx-auto max-w-7xl p-4 md:p-8 print:max-w-none print:p-0">
            <AnimatePresence mode="wait">
              {activeNav === "upload" && (
                <motion.div
                  key="upload"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-6"
                >
                  <UploadSection analysis={analysis} lang={lang} t={t} />
                </motion.div>
              )}

              {activeNav === "results" && (
                <motion.div
                  key="results"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-8"
                >
                  <ResultsSection analysis={analysis} lang={lang} t={t} />
                  {result && result.confidenceLevel !== "ood" && (
                    <div className="border-t pt-8 space-y-6 print:hidden">
                      <ChatSection analysis={analysis} lang={lang} t={t} />
                    </div>
                  )}
                </motion.div>
              )}

              {activeNav === "inspector" && (
                <motion.div
                  key="inspector"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-6"
                >
                  <InspectorSection analysis={analysis} lang={lang} t={t} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </main>
      </div>

    </div>
  );
}
