"use client";

import React, { useState, useRef, useEffect, useCallback, useId } from "react";
import { Link2, Check } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

export interface SocialShareButtonProps {
  url?: string;
  title?: string;
  text?: string;
  className?: string;
  label?: string;
  copiedLabel?: string;
  tooltipText?: string;
  showTooltip?: boolean;
  onCopy?: (url: string) => void;
  showIcon?: boolean;
}

/**
 * Copies text to clipboard with modern navigator.clipboard API and fallback
 * hidden textarea mechanism for older mobile/unsupported browsers (#3467).
 */
export async function copyShareableLinkToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to textarea fallback
    }
  }

  if (typeof document !== "undefined") {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "0";
      textarea.setAttribute("readonly", "");
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const success = document.execCommand("copy");
      document.body.removeChild(textarea);
      if (success) return true;
    } catch (err) {
      console.error("[SocialShareButton] Fallback copy failed:", err);
    }
  }

  return false;
}

export function SocialShareButton({
  url,
  title,
  text,
  className = "",
  label = "Share Session",
  copiedLabel = "Copied!",
  tooltipText = "Share session link",
  showTooltip = true,
  onCopy,
  showIcon = true,
}: SocialShareButtonProps) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipId = useId();

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleShareClick = useCallback(async () => {
    const targetUrl =
      url || (typeof window !== "undefined" ? window.location.href : "");

    // 1. Try Native Web Share API (Mobile / supported devices)
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.share === "function"
    ) {
      try {
        const shareData: ShareData = {
          title: title || "WorkSphere Focus Session",
          text: text || "Join my collaborative session on WorkSphere!",
          url: targetUrl,
        };

        if (typeof navigator.canShare !== "function" || navigator.canShare(shareData)) {
          await navigator.share(shareData);
          onCopy?.(targetUrl);
          return;
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          // User intentionally cancelled / dismissed the native share sheet
          return;
        }
        // If native share fails with another error, fall through to clipboard copy
      }
    }

    // 2. Fallback to clipboard copy
    const success = await copyShareableLinkToClipboard(targetUrl);

    if (success) {
      setCopied(true);
      toast("Session link copied to clipboard! 📋", "success");
      onCopy?.(targetUrl);

      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        setCopied(false);
      }, 2500);
    } else {
      toast("Unable to copy session link", "error");
    }
  }, [url, title, text, toast, onCopy]);

  return (
    <div className="relative inline-flex items-center group">
      <button
        type="button"
        onClick={handleShareClick}
        data-testid="share-session-button"
        aria-label={label}
        aria-describedby={showTooltip ? tooltipId : undefined}
        className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 ${
          copied
            ? "border border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
            : "border border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10 hover:text-white"
        } ${className}`}
      >
        {showIcon && (
          copied ? (
            <Check className="h-4 w-4 text-emerald-400 shrink-0" data-testid="share-icon-check" />
          ) : (
            <Link2 className="h-4 w-4 text-violet-400 shrink-0" data-testid="share-icon-link" />
          )
        )}
        <span>{copied ? copiedLabel : label}</span>
      </button>

      {showTooltip && (
        <div
          id={tooltipId}
          role="tooltip"
          data-testid="share-tooltip"
          className="pointer-events-none absolute bottom-full right-0 sm:left-1/2 mb-2 translate-x-0 sm:-translate-x-1/2 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 z-50 whitespace-nowrap px-2.5 py-1 text-xs font-medium text-white bg-zinc-900 border border-white/10 rounded-lg shadow-lg backdrop-blur-sm"
        >
          <span>{copied ? copiedLabel : tooltipText}</span>
        </div>
      )}
    </div>
  );
}

export default SocialShareButton;
