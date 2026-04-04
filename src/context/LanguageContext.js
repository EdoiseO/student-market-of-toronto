"use client";
import { createContext, useContext, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { translations } from "@/lib/translations";

const LanguageContext = createContext();

export function LanguageProvider({ children, initialLanguage = "en" }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [language, setLanguage] = useState(() => {
    if (typeof window === "undefined") {
      return initialLanguage;
    }

    const cookieLanguage = document.cookie
      .split("; ")
      .find((row) => row.startsWith("language="))
      ?.split("=")[1];

    const savedLanguage = localStorage.getItem("language");

    if (cookieLanguage === "en" || cookieLanguage === "fr") {
      return cookieLanguage;
    }

    if (savedLanguage === "en" || savedLanguage === "fr") {
      return savedLanguage;
    }

    return initialLanguage;
  });

  useEffect(() => {
    localStorage.setItem("language", language);
    document.cookie = `language=${language}; path=/; max-age=31536000`;
  }, [language]);

  function updateLanguage(nextLanguage) {
    if (nextLanguage !== "en" && nextLanguage !== "fr") return;
    if (nextLanguage === language) return;

    if (typeof window !== "undefined") {
      localStorage.setItem("language", nextLanguage);
      document.cookie = `language=${nextLanguage}; path=/; max-age=31536000`;
    }

    setLanguage(nextLanguage);

    startTransition(() => {
      router.refresh();
    });
  }

  const t = translations[language] || translations.en;

  return (
    <LanguageContext.Provider
      value={{ language, setLanguage: updateLanguage, t }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
