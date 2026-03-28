"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { translations } from "@/lib/translations";

const LanguageContext = createContext();

export function LanguageProvider({ children }) {
  const [language, setLanguage] = useState("en");

  useEffect(() => {
    const cookieLanguage = document.cookie
      .split("; ")
      .find((row) => row.startsWith("language="))
      ?.split("=")[1];

    const savedLanguage = localStorage.getItem("language");

    const nextLanguage =
      cookieLanguage === "en" || cookieLanguage === "fr"
        ? cookieLanguage
        : savedLanguage === "en" || savedLanguage === "fr"
        ? savedLanguage
        : "en";

    setLanguage(nextLanguage);
  }, []);

  useEffect(() => {
    localStorage.setItem("language", language);
    document.cookie = `language=${language}; path=/; max-age=31536000`;
  }, [language]);

  function updateLanguage(nextLanguage) {
    if (nextLanguage !== "en" && nextLanguage !== "fr") return;
    setLanguage(nextLanguage);
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