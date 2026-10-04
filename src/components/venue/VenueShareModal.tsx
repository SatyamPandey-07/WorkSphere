"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Share2, Copy, Check, Download, X, QrCode, MapPin } from "lucide-react";
import { generateQRCodeSVG, downloadSVG } from "@/lib/qr/svgQr";
import { sanitizeSvg } from "@/lib/security/svgSanitizer";

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
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
    }
  }, []);

  const shortUrl = useMemo(() => {
    return origin ? `${origin}/venues/${venue.id}` : `/venues/${venue.id}`;
  }, [origin, venue.id]);

  const qrSvg = useMemo(() => {
    return generateQRCodeSVG(shortUrl, {
      size: 200,
      title: `${venue.name} QR Code`,
      fgColor: "#09090b",
      bgColor: "#ffffff",
      padding: 3,
    });
  }, [shortUrl, venue.name]);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setCopied(false);
  }, []);

  // Handle ESC key to close modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleClose]);

  const handleShareClick = async () => {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
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
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(shortUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (err) {
      console.error("Failed to copy shortlink:", err);
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
          className={`p-2.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 transition-all active:scale-95 ${className}`}
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
          className={`inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-semibold text-sm transition-all active:scale-95 ${className}`}
        >
          <Share2 className="w-4 h-4" />
          <span>Share Venue</span>
        </button>
      );
    }

    return (
      <button
        type="button"
        onClick={handleShareClick}
        aria-label={`Share ${venue.name}`}
        className={`inline-flex items-center justify-center gap-2 py-3 px-5 rounded-2xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 font-bold text-sm transition-all shadow-md active:scale-95 ${className}`}
      >
        <Share2 className="w-4 h-4" />
        <span>Share Venue</span>
      </button>
    );
  };

  return (
    <>
      {renderTriggerButton()}

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
                onClick={handleClose}
                aria-label="Close dialog"
                className="p-2 rounded-xl text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
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
                  dangerouslySetInnerHTML={{ __html: sanitizeSvg(qrSvg) }}
                />
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-2.5 text-center font-medium">
                  Scan with your phone camera to instantly view this venue.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
