"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Share2, X } from "lucide-react";

const DEBOUNCE_DURATION_MS = 800;

interface VenueShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  venueName: string;
  shareUrl: string;
  onNotify?: (message: string, type?: "success" | "error") => void;
}

export const VenueShareModal: React.FC<VenueShareModalProps> = ({
  isOpen,
  onClose,
  venueName,
  shareUrl,
  onNotify,
}) => {
  const [isCopied, setIsCopied] = useState(false);
  const [isSharing, setIsSharing] = useState(false);

  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shareTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetActionStates = useCallback(() => {
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = null;
    }
    if (shareTimeoutRef.current) {
      clearTimeout(shareTimeoutRef.current);
      shareTimeoutRef.current = null;
    }
    setIsCopied(false);
    setIsSharing(false);
  }, []);

 fix/venue-share-modal-debounce
  // Reset state cleanly upon modal close or component unmount
  useEffect(() => {
    if (!isOpen) {
      resetActionStates();

  const shortUrl = useMemo(() => {
    return origin ? `${origin}/venues/${venue.id}` : `/venues/${venue.id}`;
  }, [origin, venue.id]);

  const qrSvg = useMemo(() => {
    if (!isOpen) return "";
    return generateQRCodeSVG(shortUrl, {
      size: 200,
      title: `${venue.name} QR Code`,
      fgColor: "#09090b",
      bgColor: "#ffffff",
      padding: 3,
    });
  }, [isOpen, shortUrl, venue.name]);

  const triggerElementRef = useRef<HTMLElement | null>(null);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setCopied(false);
    if (
      triggerElementRef.current &&
      typeof triggerElementRef.current.focus === "function"
    ) {
      triggerElementRef.current.focus();
    }
  }, []);

  // Handle ESC key to close modal
  useEffect(() => {
    if (!isOpen) return;
    if (typeof document !== "undefined" && !triggerElementRef.current) {
      triggerElementRef.current = document.activeElement as HTMLElement | null;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (
        triggerElementRef.current &&
        typeof triggerElementRef.current.focus === "function"
      ) {
        triggerElementRef.current.focus();
      }
    };
  }, [isOpen, handleClose]);

  const handleShareClick = async () => {
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.share === "function"
    ) {
      try {
        const shareData: ShareData = {
          title: `${venue.name} | WorkSphere`,
          text: `Check out ${venue.name} on WorkSphere!`,
          url: shortUrl,
        };

        await navigator.share(shareData);
        return;
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          // User dismissed the native share sheet
          return;
        }
        // Fallback to modal if native share fails unexpectedly
        setIsOpen(true);
      }
    } else {
      // Desktop or unsupported browser
      setIsOpen(true);
 main
    }
    return () => {
      resetActionStates();
    };
  }, [isOpen, resetActionStates]);

  const handleCopyLink = async () => {
    if (isCopied) return;

    try {
      await navigator.clipboard.writeText(shareUrl);
      setIsCopied(true);
      onNotify?.("Venue link copied to clipboard!", "success");

      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = setTimeout(() => {
        setIsCopied(false);
        copyTimeoutRef.current = null;
      }, DEBOUNCE_DURATION_MS);
    } catch {
      onNotify?.("Failed to copy link", "error");
    }
  };

  const handleWebShare = async () => {
    if (isSharing) return;

    if (typeof navigator === "undefined" || !navigator.share) {
      await handleCopyLink();
      return;
    }

    setIsSharing(true);

    try {
      await navigator.share({
        title: venueName,
        text: `Check out ${venueName} on WorkSphere`,
        url: shareUrl,
      });
      onNotify?.("Venue shared successfully!", "success");
    } catch (error: unknown) {
      // Ignore user cancellation of the native share sheet
      if (error instanceof Error && error.name !== "AbortError") {
        onNotify?.("Unable to share venue", "error");
      }
    } finally {
      if (shareTimeoutRef.current) {
        clearTimeout(shareTimeoutRef.current);
      }
      shareTimeoutRef.current = setTimeout(() => {
        setIsSharing(false);
        shareTimeoutRef.current = null;
      }, DEBOUNCE_DURATION_MS);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="venue-share-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-5 text-slate-100 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h2
            id="venue-share-modal-title"
            className="text-base font-semibold text-slate-100"
          >
            Share {venueName}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close share modal"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

 fix/venue-share-modal-debounce
        <div className="mt-4 space-y-4">
          <div className="flex items-center gap-2 rounded-lg border border-slate-700/80 bg-slate-950/80 px-3 py-2">
            <input
              type="text"
              readOnly
              value={shareUrl}
              aria-label="Shareable venue URL"
              className="w-full bg-transparent text-xs text-slate-300 focus:outline-none"
            />
          </div>

      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="share-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleClose();
          }}
        >
          <div className="relative w-full max-w-md bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl border border-zinc-200 dark:border-zinc-800 p-6 sm:p-7 space-y-6 overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <h2
                  id="share-modal-title"
                  className="text-xl font-black tracking-tight text-zinc-900 dark:text-zinc-50"
                >
                  Share Venue
                </h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  Share this venue with friends or open on another device.
                </p>
              </div>
              <button
                type="button"
                data-testid="venue-share-modal-close"
                onClick={handleClose}
                aria-label="Close dialog"
                className="p-2 rounded-xl text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
 main

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleCopyLink}
              disabled={isCopied}
              aria-disabled={isCopied}
              className={`inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition ${
                isCopied
                  ? "cursor-not-allowed border border-emerald-500/40 bg-emerald-500/20 text-emerald-300"
                  : "bg-indigo-600 text-white hover:bg-indigo-500"
              }`}
            >
              {isCopied ? (
                <>
                  <Check className="h-4 w-4" />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  <span>Copy Link</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleWebShare}
              disabled={isSharing}
              aria-disabled={isSharing}
              className={`inline-flex flex-1 items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition ${
                isSharing
                  ? "cursor-not-allowed border-slate-700 bg-slate-800/60 text-slate-400"
                  : "border-slate-700 bg-slate-800 text-slate-100 hover:bg-slate-700"
              }`}
            >
              <Share2 className="h-4 w-4" />
              <span>{isSharing ? "Sharing..." : "Web Share"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VenueShareModal;
