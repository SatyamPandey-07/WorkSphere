"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export interface MessageTranslation {
  translatedText: string;
  sourceLanguage: string;
}

interface TranslationState {
  key: string;
  translation: MessageTranslation | null;
  error: string | null;
  isLoading: boolean;
}

const translationCache = new Map<string, MessageTranslation>();
const pendingTranslations = new Map<string, Promise<MessageTranslation>>();

function getCacheKey(text: string, targetLanguage: string): string {
  return JSON.stringify([text, targetLanguage]);
}

async function requestTranslation(
  text: string,
  targetLanguage: string,
  key: string,
): Promise<MessageTranslation> {
  const cached = translationCache.get(key);
  if (cached) return cached;

  const pending = pendingTranslations.get(key);
  if (pending) return pending;

  const request = (async () => {
    const response = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, targetLanguage }),
    });
    const body = (await response.json()) as {
      translatedText?: string;
      sourceLanguage?: string;
      error?: string;
    };

    if (!response.ok) {
      throw new Error(body.error || "Unable to translate this message.");
    }
    if (typeof body.translatedText !== "string" || !body.translatedText) {
      throw new Error("The translation service returned an invalid response.");
    }

    const result = {
      translatedText: body.translatedText,
      sourceLanguage: body.sourceLanguage || "Unknown",
    };
    translationCache.set(key, result);
    return result;
  })();

  pendingTranslations.set(key, request);
  try {
    return await request;
  } finally {
    pendingTranslations.delete(key);
  }
}

export function useMessageTranslation(messageId: string, text: string) {
  const { i18n } = useTranslation();
  const targetLanguage = (
    i18n.resolvedLanguage ||
    i18n.language ||
    (typeof navigator !== "undefined" ? navigator.language : "en")
  )
    .split("-")[0]
    .toLowerCase();
  const translationKey = useMemo(
    () => getCacheKey(text, targetLanguage),
    [text, targetLanguage],
  );
  const [state, setState] = useState<TranslationState>({
    key: translationKey,
    translation: translationCache.get(translationKey) || null,
    error: null,
    isLoading: false,
  });
  const [showOriginal, setShowOriginal] = useState(false);

  useEffect(() => {
    setState({
      key: translationKey,
      translation: translationCache.get(translationKey) || null,
      error: null,
      isLoading: false,
    });
    setShowOriginal(false);
  }, [messageId, translationKey]);

  const translate = useCallback(async () => {
    if (!text.trim()) return;
    setState({ key: translationKey, translation: null, error: null, isLoading: true });
    try {
      const translation = await requestTranslation(
        text,
        targetLanguage,
        translationKey,
      );
      setState((current) =>
        current.key === translationKey
          ? { key: translationKey, translation, error: null, isLoading: false }
          : current,
      );
    } catch (error) {
      setState((current) =>
        current.key === translationKey
          ? {
              key: translationKey,
              translation: null,
              error:
                error instanceof Error
                  ? error.message
                  : "Unable to translate this message.",
              isLoading: false,
            }
          : current,
      );
    }
  }, [text, targetLanguage, translationKey]);

  const currentState =
    state.key === translationKey
      ? state
      : {
          key: translationKey,
          translation: translationCache.get(translationKey) || null,
          error: null,
          isLoading: false,
        };

  return {
    translation: currentState.translation,
    error: currentState.error,
    isLoading: currentState.isLoading,
    showOriginal,
    translate,
    toggleOriginal: () => setShowOriginal((showing) => !showing),
  };
}
