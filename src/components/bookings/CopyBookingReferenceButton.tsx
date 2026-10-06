"use client";

import React, { useState, useEffect, useRef, useId } from "react";
import { Copy, Check } from "lucide-react";

export interface CopyBookingReferenceButtonProps {
  /** The booking confirmation reference ID to copy (e.g., 'WS-A1B2C34D') */
  referenceId: string;
  /** Optional button label or text */
  label?: string;
  /** Whether to render the reference ID inline inside the button */
  showId?: boolean;
  /** Custom tooltip text before copying (default: 'Copy reference ID') */
  tooltipText?: string;
  /** Custom tooltip text after copying (default: 'Reference ID copied!') */
  copiedTooltipText?: string;
  /** Tooltip position relative to button */
  tooltipPosition?: "top" | "bottom" | "left" | "right";
  /** Optional custom CSS classes for the button */
  className?: string;
  /** Optional callback fired when successfully copied */
  onCopied?: (referenceId: string) => void;
  /** Optional aria-label override */
  ariaLabel?: string;
}

export function CopyBookingReferenceButton({
  referenceId,
  label,
  showId = false,
  tooltipText = "Copy reference ID",
  copiedTooltipText = "Reference ID copied!",
  tooltipPosition = "top",
  className = "",
  onCopied,
  ariaLabel,
}: CopyBookingReferenceButtonProps) {
  const [isCopied, setIsCopied] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipId = useId();

  const isTooltipVisible = isHovered || isFocused || isCopied;

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const fallbackCopy = (text: string) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.opacity = "0";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand("copy");
    } catch (e) {
      console.error("[CopyBookingReferenceButton] Fallback copy failed:", e);
    }
    document.body.removeChild(textArea);
  };

  const handleCopy = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();

    if (!referenceId) return;

    if (navigator?.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(referenceId);
      } catch {
        fallbackCopy(referenceId);
      }
    } else {
      fallbackCopy(referenceId);
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    setIsCopied(true);
    onCopied?.(referenceId);

    timeoutRef.current = setTimeout(() => {
      setIsCopied(false);
    }, 2000);
  };

  // Tooltip positioning styles
  const getTooltipPositionClasses = () => {
    switch (tooltipPosition) {
      case "bottom":
        return "top-full left-1/2 -translate-x-1/2 mt-2";
      case "left":
        return "right-full top-1/2 -translate-y-1/2 mr-2";
      case "right":
        return "left-full top-1/2 -translate-y-1/2 ml-2";
      case "top":
      default:
        return "bottom-full left-1/2 -translate-x-1/2 mb-2";
    }
  };

  const getArrowClasses = () => {
    switch (tooltipPosition) {
      case "bottom":
        return "-top-1 left-1/2 -translate-x-1/2 border-b-zinc-900 dark:border-b-zinc-100 border-x-transparent border-t-transparent";
      case "left":
        return "-right-1 top-1/2 -translate-y-1/2 border-l-zinc-900 dark:border-l-zinc-100 border-y-transparent border-r-transparent";
      case "right":
        return "-left-1 top-1/2 -translate-y-1/2 border-r-zinc-900 dark:border-r-zinc-100 border-y-transparent border-l-transparent";
      case "top":
      default:
        return "-bottom-1 left-1/2 -translate-x-1/2 border-t-zinc-900 dark:border-t-zinc-100 border-x-transparent border-b-transparent";
    }
  };

  const computedAriaLabel =
    ariaLabel ||
    (isCopied
      ? `Booking reference ID ${referenceId} copied to clipboard`
      : `Copy booking confirmation reference ID ${referenceId}`);

  return (
    <div className="relative inline-flex items-center">
      <button
        type="button"
        onClick={handleCopy}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        aria-label={computedAriaLabel}
        aria-describedby={isTooltipVisible ? tooltipId : undefined}
        data-testid="copy-booking-reference-btn"
        className={`group inline-flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-violet-500/50 ${
          isCopied
            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 font-semibold"
            : "bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800/80 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700/60"
        } ${className}`}
      >
        {isCopied ? (
          <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 animate-in zoom-in-50 duration-200" />
        ) : (
          <Copy className="w-3.5 h-3.5 text-zinc-500 group-hover:text-zinc-700 dark:text-zinc-400 dark:group-hover:text-zinc-200 transition-colors" />
        )}

        {showId && (
          <span className="font-mono font-semibold tracking-wide">
            {referenceId}
          </span>
        )}

        {label && <span>{label}</span>}
      </button>

      {/* Floating Tooltip with Smooth Animation */}
      {isTooltipVisible && (
        <div
          id={tooltipId}
          role="tooltip"
          aria-live="polite"
          data-testid="copy-reference-tooltip"
          className={`absolute z-50 pointer-events-none whitespace-nowrap px-2.5 py-1 text-[11px] font-medium rounded-lg shadow-lg transition-all duration-200 animate-in fade-in zoom-in-95 ${getTooltipPositionClasses()} ${
            isCopied
              ? "bg-emerald-700 dark:bg-emerald-600 text-white"
              : "bg-zinc-900 dark:bg-zinc-100 text-zinc-100 dark:text-zinc-900"
          }`}
        >
          <div className="flex items-center gap-1">
            {isCopied && <Check className="w-3 h-3 text-white" />}
            <span>{isCopied ? copiedTooltipText : tooltipText}</span>
          </div>
          {/* Tooltip Arrow */}
          <div
            className={`absolute w-0 h-0 border-4 ${getArrowClasses()}`}
          />
        </div>
      )}
    </div>
  );
}

export default CopyBookingReferenceButton;
