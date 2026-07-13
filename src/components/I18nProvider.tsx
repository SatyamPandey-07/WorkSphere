"use client";

import React, { useEffect, useState } from "react";
import i18n from "i18next";
import { initReactI18next, I18nextProvider } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { useCsrfToken } from "@/hooks/useCsrfToken";

import en from "../locales/en.json";
import es from "../locales/es.json";
import fr from "../locales/fr.json";
import de from "../locales/de.json";
import hi from "../locales/hi.json";

// Initialize i18next outside of component to avoid re-initialization
i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      es: { translation: es },
      fr: { translation: fr },
      de: { translation: de },
      hi: { translation: hi }
    },
    fallbackLng: "en",
    interpolation: {
      escapeValue: false // react already safes from xss
    }
  });

export default function I18nProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);

  // Ensures a CSRF token is fetched on load and automatically re-issued
  // whenever the locale changes, so form submissions right after a language
  // switch never hit a stale/missing token. See issue #201.
  useCsrfToken();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    // Avoid hydration mismatch by rendering children without context first,
    // or just render children as is. React-i18next can handle hydration if configured carefully,
    // but a simple approach is to render after mount.
    // However, to avoid flashing, returning children works.
    return <>{children}</>;
  }

  return (
    <I18nextProvider i18n={i18n}>
      {children}
    </I18nextProvider>
  );
}
