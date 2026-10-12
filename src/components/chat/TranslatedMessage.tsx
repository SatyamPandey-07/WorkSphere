"use client";

import { useState } from "react";
import { Check, Copy, Eye, EyeOff, Languages, Loader2, Info } from "lucide-react";
import { useMessageTranslation } from "@/hooks/useMessageTranslation";

const VIEW_MODE_STORAGE_KEY = "worksphere-translation-view-mode";

interface TranslatedMessageProps {
  messageId: string;
  text: string;
  targetLanguage?: string;
}

export function TranslatedMessage({ messageId, text, targetLanguage: propTargetLanguage }: TranslatedMessageProps) {
  const {
    translation,
    error,
    isLoading,
    showOriginal,
    translate,
    toggleOriginal,
  } = useMessageTranslation(messageId, text);

  const [copied, setCopied] = useState(false);
  const [sideBySide, setSideBySide] = useState<boolean>(() => {
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        return window.localStorage.getItem(VIEW_MODE_STORAGE_KEY) === "dual";
      } catch {
        return false;
      }
    }
    return false;
  });

  const toggleSideBySide = () => {
    setSideBySide((prev) => {
      const next = !prev;
      if (typeof window !== "undefined" && window.localStorage) {
        try {
          window.localStorage.setItem(
            VIEW_MODE_STORAGE_KEY,
            next ? "dual" : "single",
          );
        } catch {
          // Ignore localStorage errors
        }
      }
      return next;
    });
  };

  const currentText =
    translation && !showOriginal ? translation.translatedText : text;

  const handleCopy = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(currentText);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = currentText;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn("Failed to copy translated text to clipboard:", err);
    }
  };

  // Metrics: word and character counts
  const sourceLang = (translation?.sourceLanguage || "AUTO").slice(0, 3).toUpperCase();
  const targetLang = (propTargetLanguage || "EN").slice(0, 3).toUpperCase();
  const charCount = currentText.length;
  const wordCount = currentText.trim() ? currentText.trim().split(/\s+/).length : 0;

  return (
    <div>
      {translation && (
        <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-zinc-400">
          <span>
            {translation.sourceLanguage &&
            translation.sourceLanguage.toLowerCase() !== "unknown" &&
            translation.sourceLanguage.toLowerCase() !== "undefined"
              ? `Translated from ${translation.sourceLanguage}`
              : "Auto-detected"}
          </span>
          <button
            type="button"
            onClick={toggleOriginal}
            className="underline underline-offset-2 hover:text-zinc-600 dark:hover:text-zinc-200"
            aria-label={
              showOriginal ? "Show translated message" : "Show original message"
            }
          >
            {showOriginal ? "Show translation" : "Show original"}
          </button>
          <button
            type="button"
            onClick={toggleSideBySide}
            className="inline-flex items-center gap-1 rounded p-0.5 text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-200"
            aria-label={
              sideBySide
                ? "Switch to single message view"
                : "Switch to side-by-side view"
            }
            title={sideBySide ? "Single view" : "Compare side-by-side"}
          >
            {sideBySide ? (
              <EyeOff className="h-3 w-3" aria-hidden="true" />
            ) : (
              <Eye className="h-3 w-3" aria-hidden="true" />
            )}
            <span className="text-[10px]">
              {sideBySide ? "Single view" : "Side-by-side"}
            </span>
          </button>
          <div className="relative inline-flex items-center">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1 rounded p-0.5 text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-200"
              aria-label={
                copied ? "Copied translated text" : "Copy translated text"
              }
              title={copied ? "Copied!" : "Copy"}
            >
              {copied ? (
                <Check
                  className="h-3 w-3 text-emerald-500"
                  aria-hidden="true"
                />
              ) : (
                <Copy className="h-3 w-3" aria-hidden="true" />
              )}
            </button>
            {copied && (
              <span
                role="status"
                className="absolute -top-6 left-1/2 -translate-x-1/2 rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] font-medium text-white shadow-sm dark:bg-zinc-700"
              >
                Copied!
              </span>
            )}
          </div>
        </div>
      )}
      {translation && sideBySide ? (
        <div
          data-testid="dual-text-layout"
          className="mt-1 flex flex-col gap-1 rounded-md border border-zinc-200/60 bg-zinc-50/50 p-2 text-xs dark:border-zinc-800/60 dark:bg-zinc-900/50 sm:flex-row sm:items-start sm:gap-3"
        >
          <div className="flex-1">
            <span className="block text-[9px] font-bold uppercase tracking-wider text-zinc-400">
              Original
            </span>
            <span className="whitespace-pre-wrap text-zinc-500 dark:text-zinc-400">
              {text}
            </span>
          </div>
          <div className="hidden h-auto w-px self-stretch bg-zinc-200 dark:bg-zinc-700 sm:block" />
          <div className="flex-1">
            <span className="block text-[9px] font-bold uppercase tracking-wider text-zinc-400">
              Translated
            </span>
            <span className="whitespace-pre-wrap font-medium text-zinc-900 dark:text-zinc-100">
              {translation.translatedText}
            </span>
          </div>
        </div>
      ) : (
        <span className="whitespace-pre-wrap">{currentText}</span>
      )}

      {/* Language pill badge & character / word count metadata footer */}
      {translation && (
        <div
          data-testid="translation-metadata-footer"
          className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500 select-none"
        >
          <span
            data-testid="translation-lang-pill"
            title="Translated via WorkSphere AI neural translation engine"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200/60 dark:border-zinc-700/60 text-zinc-600 dark:text-zinc-300 font-mono font-medium"
            aria-label={`Translation from ${sourceLang} to ${targetLang}, ${charCount} characters, ${wordCount} words`}
          >
            <Languages className="w-2.5 h-2.5 text-blue-500" aria-hidden="true" />
            <span>
              {sourceLang} → {targetLang} • {charCount} chars ({wordCount} words)
            </span>
          </span>

          <span
            className="inline-flex items-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 cursor-help"
            title="Provider: WorkSphere Neural Edge Translator (Gemini API / On-Device Model)"
            aria-label="Provider: WorkSphere Neural Edge Translator"
          >
            <Info className="w-2.5 h-2.5" aria-hidden="true" />
          </span>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-1 text-xs text-red-500">
          {error}
        </p>
      )}
      {!translation && (
        <button
          type="button"
          onClick={() => void translate()}
          disabled={isLoading || !text.trim()}
          className="mt-2 flex items-center gap-1.5 text-[10px] text-zinc-400 transition-colors hover:text-zinc-700 disabled:cursor-wait disabled:opacity-60 dark:hover:text-zinc-200"
          aria-label={error ? "Retry translation" : "Translate message"}
        >
          {isLoading ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              Translating…
            </>
          ) : (
            <>
              <Languages className="h-3 w-3" aria-hidden="true" />
              {error ? "Retry translation" : "Translate"}
            </>
          )}
        </button>
      )}
    </div>
  );
}

export default TranslatedMessage;
