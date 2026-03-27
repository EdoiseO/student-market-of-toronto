"use client";

import { useLanguage } from "@/context/LanguageContext";

export default function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();

  return (
    <div className="flex gap-2">
      <button
        onClick={() => setLanguage("en")}
        className={`rounded-md px-3 py-1 text-sm ${
          language === "en" ? "bg-black text-white" : "bg-zinc-200 text-black"
        }`}
      >
        EN
      </button>
      <button
        onClick={() => setLanguage("fr")}
        className={`rounded-md px-3 py-1 text-sm ${
          language === "fr" ? "bg-black text-white" : "bg-zinc-200 text-black"
        }`}
      >
        FR
      </button>
    </div>
  );
}