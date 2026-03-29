"use client";

import { Button } from "@/components/ui/button";
import { useLanguage } from "@/context/LanguageContext";

export default function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();

  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-zinc-200 bg-white p-1 shadow-sm">
      <Button
        type="button"
        size="sm"
        variant={language === "en" ? "default" : "ghost"}
        className="h-8 rounded-lg px-3"
        onClick={() => setLanguage("en")}
      >
        EN
      </Button>
      <Button
        type="button"
        size="sm"
        variant={language === "fr" ? "default" : "ghost"}
        className="h-8 rounded-lg px-3"
        onClick={() => setLanguage("fr")}
      >
        FR
      </Button>
    </div>
  );
}
