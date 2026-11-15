"use client";

import React, { useState, useEffect, useRef } from "react";
import { Share2, Check } from "lucide-react";

export interface VenueShareButtonProps {
  venueId: string;
  venueName: string;
  /** Optional custom URL to share. If omitted, derives from window.location.origin */
  customUrl?: string;
  /** Optional button label (default: 'Share') */
  buttonText?: string;
  /** Optional label when copied to clipboard (default: 'Link copied') */
  copiedText?: string;
  /** Duration in milliseconds to keep the copied status visible (default: 1800) */
  copyDurationMs?: number;
  /** Whether the share button is disabled */
  disabled?: boolean;
  /** Optional callback fired when share succeeds (via Web Share API or Clipboard) */
  onShareSuccess?: (method: "native" | "clipboard", url: string) => void;
  /** Optional callback fired when sharing or copying fails */
  onError?: (error: unknown) => void;
  /** Optional custom CSS classes */
  className?: string;
  /** Optional test identifier override */
  testId?: string;
}

export function VenueShareButton({
  venueId,
  venueName,
  customUrl,
  buttonText = "Share",
  copiedText = "Link copied",
  copyDurationMs = 1800,
  disabled = false,
  onShareSuccess,
  onError,
  className = "",
  testId = "venue-share-btn",
}: VenueShareButtonProps) {
  const [copied, setCopied] = useState(false);
  const isMountedRef = useRef(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const getShareUrl = (): string => {
    if (customUrl) return customUrl;
    const origin =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : "";
    return `${origin}/social?venue=${encodeURIComponent(venueId)}`;
  };

  const share = async () => {
    if (disabled || !venueId) return;

    const url = getShareUrl();
    const data = {
      title: `${venueName} on WorkSphere`,
      text: `Check out ${venueName} as a place to work.`,
      url,
    };

    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share(data);
        if (isMountedRef.current) {
          onShareSuccess?.("native", url);
        }
        return;
      }

      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else if (typeof document !== "undefined") {
        // Fallback for older or restricted environments
        const textArea = document.createElement("textarea");
        textArea.value = url;
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
      }

      if (!isMountedRef.current) return;

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      setCopied(true);
      onShareSuccess?.("clipboard", url);

      timeoutRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          setCopied(false);
        }
      }, copyDurationMs);
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") {
        if (isMountedRef.current) {
          console.error("Unable to share venue", error);
          onError?.(error);
        }
      }
    }
  };

  const computedAriaLabel = copied
    ? `Link to ${venueName} copied to clipboard`
    : `Share ${venueName}`;

  return (
    <button
      type="button"
      disabled={disabled}
      aria-disabled={disabled}
      onClick={share}
      aria-label={computedAriaLabel}
      data-testid={testId}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-violet-500/50 ${
        disabled
          ? "opacity-50 cursor-not-allowed bg-zinc-600 text-zinc-300"
          : copied
          ? "bg-emerald-600 hover:bg-emerald-500 text-white"
          : "bg-violet-600 hover:bg-violet-500 text-white"
      } ${className}`.trim()}
    >
      {copied ? (
        <Check className="h-4 w-4 shrink-0" data-testid="venue-share-icon-check" />
      ) : (
        <Share2 className="h-4 w-4 shrink-0" data-testid="venue-share-icon-share" />
      )}
      <span data-testid="venue-share-text">{copied ? copiedText : buttonText}</span>

      {/* Screen reader live notification */}
      <span
        role="status"
        aria-live="polite"
        className="sr-only"
        data-testid="venue-share-sr-announcement"
      >
        {copied ? `Link to ${venueName} copied to clipboard` : ""}
      </span>
    </button>
  );
}

export default VenueShareButton;
