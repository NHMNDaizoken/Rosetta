// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import React, { createContext, useContext, useState, useEffect } from "react";
import { vi } from "./vi";
import { en } from "./en";
import { Language } from "../types";

interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  toggleLanguage: () => void;
  t: typeof vi;
}

const I18nContext = createContext<I18nContextType | null>(null);

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    const saved = localStorage.getItem("rosetta_lang");
    return (saved === "en" || saved === "vi") ? saved : "vi"; // Vietnamese default as requested
  });

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem("rosetta_lang", lang);
    document.documentElement.lang = lang;
  };

  const toggleLanguage = () => {
    setLanguage(language === "vi" ? "en" : "vi");
  };

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const t = language === "vi" ? vi : en;

  return (
    <I18nContext.Provider value={{ language, setLanguage, toggleLanguage, t }}>
      {children}
    </I18nContext.Provider>
  );
};

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return context;
}
