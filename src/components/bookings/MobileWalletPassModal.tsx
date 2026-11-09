"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  Smartphone,
  QrCode,
  MapPin,
  Clock,
  Armchair,
  Sparkles,
  Download,
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
  Calendar,
  Copy,
  Check,
  AlertCircle,
} from "lucide-react";
import { BookingSummary } from "@/components/bookings/BookingList";
import { useToast } from "@/components/ui/Toast";

interface MobileWalletPassModalProps {
  booking: BookingSummary | null;
  isOpen: boolean;
  onClose: () => void;
}

export function MobileWalletPassModal({
  booking,
  isOpen,
  onClose,
}: MobileWalletPassModalProps) {
  const { toast } = useToast();
  const [googleSaveUrl, setGoogleSaveUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloadSuccess, setDownloadSuccess] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [showFallbackInput, setShowFallbackInput] = useState(false);

  useEffect(() => {
    if (!isOpen || !booking) return;

    async function fetchWalletDetails() {
      try {
        setLoading(true);
        const res = await fetch(`/api/bookings/${booking?.id}/wallet`);
        if (res.ok) {
          const data = await res.json();
          if (data.googleWallet?.saveUrl) {
            setGoogleSaveUrl(data.googleWallet.saveUrl);
          }
        }
      } catch (err) {
        console.error("Failed to fetch mobile wallet URLs:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchWalletDetails();
  }, [isOpen, booking]);

  if (!isOpen || !booking) return null;

  const venueName = booking.venue?.name || "WorkSphere Venue";
  const seatLabel = booking.seatNumber ? `Desk ${booking.seatNumber}` : "Reserved Hot Desk";
  const address = booking.venue?.address || "Venue Address";

  const passUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/bookings/${booking.id}/wallet/apple`
      : `/api/bookings/${booking.id}/wallet/apple`;

  const fallbackCopy = (text: string): boolean => {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.top = "0";
      textArea.style.left = "0";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand("copy");
      document.body.removeChild(textArea);
      return successful;
    } catch {
      return false;
    }
  };

  const handleCopyPassUrl = async () => {
    setCopyError(null);
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(passUrl);
        setCopiedUrl(true);
        toast("Pass URL copied to clipboard!", "success");
        setTimeout(() => setCopiedUrl(false), 2000);
      } else {
        const success = fallbackCopy(passUrl);
        if (success) {
          setCopiedUrl(true);
          toast("Pass URL copied to clipboard!", "success");
          setTimeout(() => setCopiedUrl(false), 2000);
        } else {
          throw new Error("Clipboard API unavailable");
        }
      }
    } catch (err: any) {
      console.warn("[MobileWalletPassModal] Clipboard copy failed:", err);
      setShowFallbackInput(true);
      setCopyError("Clipboard permission denied or unsupported. Copy URL below:");
      toast("Unable to copy to clipboard. Please copy manually.", "error");
    }
  };

  const handleDownloadApplePass = () => {
    const link = document.createElement("a");
    link.href = `/api/bookings/${booking.id}/wallet/apple`;
    link.download = `worksphere-${booking.confirmationId}.pkpass`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setDownloadSuccess("Apple Wallet Pass downloaded! Open on your iPhone or Mac.");
    setTimeout(() => setDownloadSuccess(null), 4000);
  };

  const handleOpenGoogleWallet = () => {
    if (googleSaveUrl) {
      window.open(googleSaveUrl, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-3xl p-6 sm:p-7 shadow-2xl space-y-6 text-zinc-100 animate-in zoom-in-95 duration-200 overflow-hidden">
        {/* Header decoration */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-blue-500 via-purple-500 to-emerald-500" />

        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-zinc-900 text-white border border-zinc-800 shrink-0">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  Mobile Wallet Pass
                </span>
              </div>
              <h3 className="text-base font-black tracking-tight text-white mt-0.5">
                Add to Apple & Google Wallet
              </h3>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Visual Pass Card Preview */}
        <div className="relative rounded-2xl p-5 bg-gradient-to-br from-zinc-900 via-zinc-900/90 to-zinc-950 border border-zinc-800 text-white shadow-2xl space-y-4 overflow-hidden group">
          {/* Subtle watermark glow */}
          <div className="absolute -right-6 -bottom-6 w-32 h-32 bg-blue-500/10 rounded-full blur-2xl group-hover:bg-blue-500/20 transition-all pointer-events-none" />

          <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                WorkSphere Access Pass
              </span>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-300">
              {booking.confirmationId}
            </span>
          </div>

          <div>
            <h4 className="text-lg font-black tracking-tight text-white">{venueName}</h4>
            <p className="text-xs text-zinc-400 mt-0.5 flex items-center gap-1">
              <MapPin className="w-3 h-3 text-zinc-500 shrink-0" />
              <span className="line-clamp-1">{address}</span>
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/60">
            <div>
              <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">
                Seat / Desk
              </div>
              <div className="text-xs font-bold text-zinc-200 mt-0.5">{seatLabel}</div>
            </div>
            <div>
              <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">
                Time Window
              </div>
              <div className="text-xs font-bold text-zinc-200 mt-0.5">
                {booking.date} @ {booking.time}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2 text-[11px] text-zinc-400">
              <QrCode className="w-4 h-4 text-zinc-300" />
              <span>Embedded Check-In QR</span>
            </div>
            <span className="text-[10px] font-bold text-emerald-400 uppercase">
              Confirmed Spot
            </span>
          </div>
        </div>

        {/* Lock screen alert explanation */}
        <div className="p-3.5 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 flex items-start gap-3">
          <div className="p-1.5 rounded-xl bg-blue-500/10 text-blue-400 mt-0.5 shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            <strong className="text-zinc-200">Geo-Proximity Enabled:</strong> Your phone will automatically display this pass on your lock screen when you arrive near {venueName} for instant 1-tap check-in.
          </p>
        </div>

        {downloadSuccess && (
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-medium flex items-center gap-2 animate-in fade-in">
            <CheckCircle2 className="w-4 h-4" />
            <span>{downloadSuccess}</span>
          </div>
        )}

        {/* Wallet Action Buttons */}
        <div className="space-y-2.5 pt-1">
          {/* Apple Wallet Button */}
          <button
            onClick={handleDownloadApplePass}
            className="w-full flex items-center justify-center gap-3 py-3.5 px-4 rounded-2xl bg-black hover:bg-zinc-900 text-white font-bold text-xs uppercase tracking-wider border border-zinc-700 shadow-xl active:scale-[0.98] transition-all"
          >
            <svg
              className="w-4 h-4 fill-current"
              viewBox="0 0 170 170"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.19-2.12-9.97-3.17-14.34-3.17-4.58 0-9.49 1.05-14.75 3.17-5.26 2.13-9.5 3.24-12.74 3.35-4.35.13-9.16-1.9-14.42-6.08-3.7-3.08-7.71-7.97-12.02-14.67-6.85-10.66-12.27-22.75-16.27-36.27-4-13.52-6-26.06-6-37.62 0-14.73 3.65-26.79 10.95-36.18 7.3-9.4 16.48-14.25 27.54-14.56 4.35 0 9.29 1.18 14.82 3.54 5.53 2.36 9.4 3.62 11.61 3.79 2.02-.26 5.86-1.54 11.51-3.84 5.66-2.31 10.53-3.37 14.61-3.18 11.69.58 20.91 4.77 27.67 12.56-10.19 6.22-15.19 14.8-15 25.74.2 8.67 3.51 15.93 9.94 21.78 6.42 5.85 14.12 9.24 23.09 10.17-2.6 7.82-5.74 15.42-9.42 22.81zM119.22 33.15c0-6.73 2.45-13.06 7.35-18 4.91-4.94 10.87-7.97 17.89-9.1.58 2.01.87 3.98.87 5.92 0 6.64-2.48 12.98-7.44 18.02-4.96 5.04-11.16 8.08-18.59 9.13-.05-1.97-.08-3.96-.08-5.97z" />
            </svg>
            <span>Add to Apple Wallet</span>
          </button>

          {/* Google Wallet Button */}
          <button
            onClick={handleOpenGoogleWallet}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 py-3.5 px-4 rounded-2xl bg-zinc-900 hover:bg-zinc-850 text-white font-bold text-xs uppercase tracking-wider border border-zinc-750 shadow-xl active:scale-[0.98] transition-all disabled:opacity-50"
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                fill="#EA4335"
              />
            </svg>
            <span>Add to Google Wallet</span>
          </button>

          {/* Copy Pass URL Button */}
          <button
            type="button"
            onClick={handleCopyPassUrl}
            data-testid="copy-wallet-pass-url-btn"
            className="w-full flex items-center justify-center gap-2.5 py-3 px-4 rounded-2xl bg-zinc-800 hover:bg-zinc-750 text-zinc-200 hover:text-white font-bold text-xs uppercase tracking-wider border border-zinc-700 active:scale-[0.98] transition-all"
          >
            {copiedUrl ? (
              <>
                <Check className="w-4 h-4 text-emerald-400" />
                <span className="text-emerald-400">Pass URL Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 text-zinc-400" />
                <span>Copy Pass URL</span>
              </>
            )}
          </button>

          {/* Fallback selectable input when clipboard access is denied or fails */}
          {(showFallbackInput || copyError) && (
            <div
              data-testid="clipboard-fallback-container"
              className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs space-y-2 animate-in fade-in"
            >
              <div className="flex items-center gap-2 text-amber-300 font-medium">
                <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
                <span>{copyError || "Clipboard access blocked. Copy URL manually:"}</span>
              </div>
              <input
                type="text"
                readOnly
                value={passUrl}
                data-testid="fallback-pass-url-input"
                onFocus={(e) => e.target.select()}
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-750 rounded-lg text-xs text-zinc-200 font-mono focus:outline-none focus:border-amber-400 select-all"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
