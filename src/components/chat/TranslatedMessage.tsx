"use client";

import { Languages, Loader2 } from "lucide-react";
import { useMessageTranslation } from "@/hooks/useMessageTranslation";

interface TranslatedMessageProps {
  messageId: string;
  text: string;
}

export function TranslatedMessage({ messageId, text }: TranslatedMessageProps) {
  const {
    translation,
    error,
    isLoading,
    showOriginal,
    translate,
    toggleOriginal,
  } = useMessageTranslation(messageId, text);

  return (
    <div>
      {translation && (
        <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-zinc-400">
          <span>Translated from {translation.sourceLanguage}</span>
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
        </div>
      )}
      <span className="whitespace-pre-wrap">
        {translation && !showOriginal ? translation.translatedText : text}
      </span>
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
