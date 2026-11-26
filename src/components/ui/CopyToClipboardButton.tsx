"use client";

import React, { useState, useEffect, useRef } from "react";
import { Copy, Check } from "lucide-react";

export interface CopyToClipboardButtonProps {
  textToCopy: string;
  className?: string;
  label?: string;
  toastMessage?: string;
  errorToastMessage?: string;
  ariaLabel?: string;
  onCopy?: (text: string) => void;
  disabled?: boolean;
}

export function CopyToClipboardButton({
  textToCopy,
  className = "",
  label = "Copy Address",
  toastMessage = "Address copied!",
  errorToastMessage = "Unable to copy. Please copy manually.",
  ariaLabel,
  onCopy,
  disabled = false,
}: CopyToClipboardButtonProps) {
  const [isCopied, setIsCopied] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [showErrorToast, setShowErrorToast] = useState(false);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (feedbackTimerRef.current !== null) {
        clearTimeout(feedbackTimerRef.current);
      }
    },
    [],
  );

  // Requirement 4: Fallback for legacy browsers without navigator.clipboard
  const fallbackCopyTextToClipboard = (text: string) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;

    // Avoid scrolling to bottom on mobile
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.position = "fixed";

    try {
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      return document.execCommand("copy");
    } catch (err) {
      console.error("Fallback: Oops, unable to copy", err);
      return false;
    } finally {
      if (textArea.parentNode) {
        textArea.parentNode.removeChild(textArea);
      }
    }
  };

  // Requirement 2: Write text using navigator.clipboard
  const handleCopy = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();
    if (disabled) return;

    if (!navigator.clipboard) {
      if (fallbackCopyTextToClipboard(textToCopy)) {
        triggerFeedback();
      } else {
        triggerCopyError();
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(textToCopy);
      triggerFeedback();
    } catch (err) {
      console.error("Failed to copy text: ", err);
      // Try fallback if modern API fails for any reason
      if (fallbackCopyTextToClipboard(textToCopy)) {
        triggerFeedback();
      } else {
        triggerCopyError();
      }
    }
  };

  // Requirement 3: Display temporary checkmark and trigger toast feedback
  const triggerFeedback = () => {
    if (feedbackTimerRef.current !== null) {
      clearTimeout(feedbackTimerRef.current);
    }
    setIsCopied(true);
    setShowToast(true);
    setShowErrorToast(false);
    onCopy?.(textToCopy);

    // Reset back to normal after 2 seconds per issue criteria
    feedbackTimerRef.current = setTimeout(() => {
      feedbackTimerRef.current = null;
      setIsCopied(false);
      setShowToast(false);
    }, 2000);
  };

  const triggerCopyError = () => {
    if (feedbackTimerRef.current !== null) {
      clearTimeout(feedbackTimerRef.current);
    }
    setIsCopied(false);
    setShowToast(false);
    setShowErrorToast(true);
    feedbackTimerRef.current = setTimeout(() => {
      feedbackTimerRef.current = null;
      setShowErrorToast(false);
    }, 2000);
  };

  return (
    <>
      <button
        onClick={handleCopy}
        type="button"
        disabled={disabled}
        data-testid="copy-to-clipboard-button"
        title={ariaLabel || "Copy to clipboard"}
        aria-label={ariaLabel || "Copy to clipboard"}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
          disabled
            ? "opacity-50 cursor-not-allowed bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500"
            : isCopied
              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
              : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
        } ${className}`}
      >
        <span className="shrink-0">
          {isCopied ? (
            <Check className="w-4 h-4" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
        </span>
        <span className="whitespace-nowrap max-w-[200px] truncate">
          {isCopied ? "Copied!" : label}
        </span>
      </button>

      {/* Self-contained Toast Notification */}
      {showToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 text-sm font-medium text-white bg-zinc-900 dark:bg-zinc-100 dark:text-black rounded-lg shadow-xl animate-in fade-in slide-in-from-bottom-5 duration-300"
        >
          <Check className="w-4 h-4 text-green-400 dark:text-green-600" />
          {toastMessage}
        </div>
      )}
      {showErrorToast && (
        <div
          role="alert"
          aria-live="assertive"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 text-sm font-medium text-white bg-red-700 rounded-lg shadow-xl animate-in fade-in slide-in-from-bottom-5 duration-300"
        >
          {errorToastMessage}
        </div>
      )}
    </>
  );
}
