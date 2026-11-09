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
import pt from "../locales/pt.json";

export interface I18nProviderProps {
  children: React.ReactNode;
  /** Optional initial language override (e.g. 'en', 'es', 'fr') */
  initialLanguage?: string;
}

// Initialize i18next outside of component to avoid re-initialization
if (!i18n.isInitialized) {
  i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources: {
        en: { translation: en },
        es: { translation: es },
        fr: { translation: fr },
        de: { translation: de },
        hi: { translation: hi },
        pt: { translation: pt },
      },
      fallbackLng: "en",
      interpolation: {
        escapeValue: false, // react already escapes from xss
      },
    });
}

export function I18nProvider({ children, initialLanguage }: I18nProviderProps) {
  const [mounted, setMounted] = useState(false);

  // Ensures a CSRF token is fetched on load and automatically re-issued
  // whenever the locale changes, so form submissions right after a language
  // switch never hit a stale/missing token. See issue #201.
  useCsrfToken();

  useEffect(() => {
    setMounted(true);
    if (initialLanguage && i18n.language !== initialLanguage) {
      i18n.changeLanguage(initialLanguage);
    }
  }, [initialLanguage]);

  if (!mounted) {
    // Avoid hydration mismatch by rendering children directly before mount
    return <>{children}</>;
  }

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}

export { i18n };
export default I18nProvider;
