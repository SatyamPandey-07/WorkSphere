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

  // Reset state cleanly upon modal close or component unmount
  useEffect(() => {
    if (!isOpen) {
      resetActionStates();
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
