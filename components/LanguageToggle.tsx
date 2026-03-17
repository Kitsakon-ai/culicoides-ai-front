import type { Lang } from "@/lib/i18n";

interface LanguageToggleProps {
  lang: Lang;
  onChange: (lang: Lang) => void;
}

export function LanguageToggle({ lang, onChange }: LanguageToggleProps) {
  return (
    <div className="flex items-center gap-0.5 rounded-md border p-0.5">
      <button
        onClick={() => onChange("th")}
        className={`rounded px-2.5 py-1 text-xs font-medium transition-all duration-150 ${
          lang === "th"
            ? "bg-secondary text-foreground"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        🇹🇭 TH
      </button>
      <button
        onClick={() => onChange("en")}
        className={`rounded px-2.5 py-1 text-xs font-medium transition-all duration-150 ${
          lang === "en"
            ? "bg-secondary text-foreground"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        🇬🇧 EN
      </button>
    </div>
  );
}
