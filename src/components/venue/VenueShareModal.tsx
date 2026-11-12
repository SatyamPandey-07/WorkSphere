"use client";

import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { Share2, Copy, Check, Download, X, QrCode, MapPin } from "lucide-react";
import { generateQRCodeSVG, downloadSVG } from "@/lib/qr/svgQr";
import { useToast } from "@/components/ui/Toast";
import { useFocusTrap } from "@/hooks/useFocusTrap";

export interface VenueShareProps {
  venue: {
    id: string;
    name: string;
    address?: string | null;
    category?: string;
    imageUrl?: string | null;
  };
  className?: string;
  variant?: "hero" | "button" | "icon" | "outline";
}

export function VenueShareModal({
  venue,
  className = "",
  variant = "button",
}: VenueShareProps) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [origin, setOrigin] = useState("");
  const timerRef = useRef<number | null>(null);
  const shareTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (shareTimerRef.current !== null)
        window.clearTimeout(shareTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
    }
  }, []);

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
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Keep Tab / Shift+Tab inside the dialog while it is open. Escape and
  // returning focus to the trigger are handled by the effect below.
  useFocusTrap(dialogRef, { isActive: isOpen, returnFocus: false });

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setCopied(false);
    setIsSharing(false);
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
    if (isSharing) return;
    setIsSharing(true);
    if (shareTimerRef.current !== null)
      window.clearTimeout(shareTimerRef.current);
    shareTimerRef.current = window.setTimeout(() => setIsSharing(false), 800);

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
    }
  };

  const handleCopyLink = async () => {
    if (copied) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(shortUrl);
        setCopied(true);
        toast("Link copied to clipboard!", "success");
        if (timerRef.current !== null) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => setCopied(false), 2000);
      }
    } catch (err) {
      console.error("Failed to copy shortlink:", err);
      toast("Unable to copy to clipboard", "error");
    }
  };

  const handleDownloadQR = () => {
    const filename = `${venue.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-qr.svg`;
    downloadSVG(qrSvg, filename);
  };

  const renderTriggerButton = () => {
    if (variant === "hero") {
      return (
        <button
          type="button"
          onClick={handleShareClick}
          aria-label={`Share ${venue.name}`}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-full bg-black/40 hover:bg-black/60 text-white backdrop-blur-md border border-white/20 text-xs font-bold uppercase tracking-wider transition-all active:scale-95 shadow-lg ${className}`}
        >
          <Share2 className="w-4 h-4" />
          <span>Share</span>
        </button>
      );
    }

    if (variant === "icon") {
      return (
        <button
          type="button"
          onClick={handleShareClick}
          aria-label={`Share ${venue.name}`}
          className={`p-2.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 transition-all active:scale-95 border border-zinc-200/80 dark:border-zinc-700/80 ${className}`}
        >
          <Share2 className="w-4 h-4" />
        </button>
      );
    }

    if (variant === "outline") {
      return (
        <button
          type="button"
          onClick={handleShareClick}
          aria-label={`Share ${venue.name}`}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-xs font-medium transition-all active:scale-95 ${className}`}
        >
          <Share2 className="w-3.5 h-3.5" />
          <span>Share</span>
        </button>
      );
    }

    // Default "button"
    return (
      <button
        type="button"
        onClick={handleShareClick}
        aria-label={`Share ${venue.name}`}
        className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 text-sm font-semibold transition-all active:scale-95 shadow-sm ${className}`}
      >
        <Share2 className="w-4 h-4" />
        <span>Share</span>
      </button>
    );
  };

  return (
    <>
      {renderTriggerButton()}

      {/*
        Portal the dialog to <body>. The trigger is often rendered inside a
        positioned, z-indexed wrapper (e.g. `absolute z-10` on the venue hero),
        which creates a stacking context and traps any z-index set here below
        the sticky TopNav (`z-40`). Rendering at the body root lets z-[60]
        sit above the navbar and its mobile menu (`z-50`).
      */}
      {isOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-modal-title"
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={handleClose}
          >
            <div
              className="relative w-full max-w-sm rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 shadow-2xl transition-all scale-100 animate-in zoom-in-95 duration-150 space-y-5"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between">
                <h2
                  id="share-modal-title"
                  className="text-lg font-bold text-zinc-900 dark:text-zinc-100"
                >
                  Share Venue
                </h2>
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

              {/* Venue Snippet */}
              <div className="flex items-center gap-3 p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-800">
                {venue.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={venue.imageUrl}
                    alt={venue.name}
                    className="w-12 h-12 rounded-xl object-cover shrink-0 border border-zinc-200/50 dark:border-zinc-700/50"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-xl bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center shrink-0">
                    <MapPin className="w-5 h-5 text-zinc-500 dark:text-zinc-400" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-bold truncate text-zinc-900 dark:text-zinc-100">
                    {venue.name}
                  </h3>
                  {venue.address && (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                      {venue.address}
                    </p>
                  )}
                </div>
              </div>

              {/* Copyable Shortlink */}
              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Copy Shortlink
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={shortUrl}
                    onFocus={(e) => e.target.select()}
                    className="flex-1 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 select-all font-mono focus:outline-none focus:ring-2 focus:ring-zinc-400"
                  />
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
                      copied
                        ? "bg-green-600 text-white"
                        : "bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900"
                    }`}
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* QR Code Section */}
              <div className="space-y-3 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black uppercase tracking-wider text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                    <QrCode className="w-3.5 h-3.5" />
                    <span>Scan or Download QR</span>
                  </span>
                  <button
                    type="button"
                    onClick={handleDownloadQR}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download SVG</span>
                  </button>
                </div>

                <div className="flex flex-col items-center justify-center p-4 bg-zinc-50 dark:bg-zinc-800/40 rounded-2xl border border-zinc-100 dark:border-zinc-800">
                  <div
                    className="p-3 bg-white rounded-xl shadow-md border border-zinc-200/60 inline-flex items-center justify-center"
                    dangerouslySetInnerHTML={{ __html: qrSvg }}
                  />
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-2.5 text-center font-medium">
                    Scan with your phone camera to instantly view this venue.
                  </p>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

export default VenueShareModal;
