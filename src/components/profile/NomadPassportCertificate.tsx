"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import confetti from "canvas-confetti";
import {
  Check,
  Copy,
  Sparkles,
  AlertCircle,
  Download,
  Loader2,
} from "lucide-react";
import type { PassportStamp } from "@/lib/zkp/nomadProof";
import {
  downloadNomadPassportPngBadge,
  getNomadPassportPngFilename,
  type NomadBadgeParams,
} from "@/lib/profile/badgeGenerator";
import NomadPassportCoin from "./NomadPassportCoin";

export interface NomadPassportCertificateProps {
  stamp?: PassportStamp;
  referralUrl?: string;
  userName?: string;
  userId?: string;
  className?: string;
  onCopySuccess?: (url: string) => void;
  onCopyError?: (error: Error) => void;
  onDownloadBadgeSuccess?: (filename: string) => void;
  onDownloadBadgeError?: (error: Error) => void;
}

/**
 * Resolves a default canonical URL for sharing/referral if none is explicitly provided.
 */
function resolveNomadPassportUrl(
  referralUrl?: string,
  stamp?: PassportStamp,
  userId?: string,
): string {
  if (referralUrl && referralUrl.trim().length > 0) {
    return referralUrl.trim();
  }

  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "https://worksphere.app";

  if (stamp) {
    const params = new URLSearchParams();
    if (stamp.stampId) params.set("stampId", stamp.stampId);
    if (stamp.badgeType) params.set("badgeType", stamp.badgeType);
    if (stamp.epoch !== undefined) params.set("epoch", stamp.epoch.toString());
    if (stamp.nullifierHash) params.set("nullifier", stamp.nullifierHash);
    if (stamp.verificationSignature)
      params.set("sig", stamp.verificationSignature);
    if (stamp.countryCode) params.set("country", stamp.countryCode);
    if (userId) params.set("ref", userId);
    return `${origin}/verify/nomad-passport?${params.toString()}`;
  }

  if (userId) {
    return `${origin}/profile/${encodeURIComponent(userId)}?ref=nomad-passport`;
  }

  return `${origin}/nomad-passport`;
}

/**
 * NomadPassportCertificate
 *
 * Renders the verified Nomad Passport certificate with the 3D/2D Passport Coin,
 * metadata summary, and a celebratory "Copy Nomad Passport Link" button with
 * confetti animation and accessible screen-reader live announcements.
 */
export function NomadPassportCertificate({
  stamp,
  referralUrl,
  userName = "Nomad Explorer",
  userId,
  className = "",
  onCopySuccess,
  onCopyError,
  onDownloadBadgeSuccess,
  onDownloadBadgeError,
}: NomadPassportCertificateProps) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "success" | "error">(
    "idle",
  );
  const [downloadStatus, setDownloadStatus] = useState<
    "idle" | "downloading" | "success" | "error"
  >("idle");
  const [liveAnnouncement, setLiveAnnouncement] = useState<string>("");
  const [showManualFallback, setShowManualFallback] = useState<boolean>(false);

  const fallbackInputId = useId();
  const resetTimerRef = useRef<NodeJS.Timeout | null>(null);
  const downloadTimerRef = useRef<NodeJS.Timeout | null>(null);
  const confettiCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const canonicalUrl = resolveNomadPassportUrl(referralUrl, stamp, userId);

  // Clean up any pending timer on unmount
  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
      if (downloadTimerRef.current) {
        clearTimeout(downloadTimerRef.current);
      }
    };
  }, []);

  const triggerCelebratoryConfetti = () => {
    if (typeof window === "undefined") return;

    // Respect reduced motion preference
    const prefersReducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReducedMotion) {
      return;
    }

    try {
      let confettiInstance: confetti.CreateTypes | null = null;
      if (confettiCanvasRef.current) {
        confettiInstance = confetti.create(confettiCanvasRef.current, {
          resize: true,
          useWorker: false,
        });
      }

      const fire = confettiInstance || confetti;
      const animationEnd = Date.now() + 2000;
      const colors = ["#38bdf8", "#818cf8", "#c084fc", "#fbbf24", "#34d399"];

      const frame = () => {
        fire({
          particleCount: 3,
          angle: 60,
          spread: 55,
          origin: { x: 0, y: 0.7 },
          colors,
          zIndex: 9999,
        });
        fire({
          particleCount: 3,
          angle: 120,
          spread: 55,
          origin: { x: 1, y: 0.7 },
          colors,
          zIndex: 9999,
        });

        if (Date.now() < animationEnd) {
          requestAnimationFrame(frame);
        }
      };

      requestAnimationFrame(frame);
    } catch {
      // Gracefully ignore confetti canvas initialization errors
    }
  };

  const handleCopyLink = async () => {
    if (!canonicalUrl) {
      setCopyStatus("error");
      setShowManualFallback(true);
      return;
    }

    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === "function"
      ) {
        await navigator.clipboard.writeText(canonicalUrl);
      } else {
        // Fallback for environments lacking navigator.clipboard
        throw new Error("Clipboard API unavailable");
      }

      setCopyStatus("success");
      setShowManualFallback(false);
      setLiveAnnouncement("Profile link copied to clipboard!");
      triggerCelebratoryConfetti();
      onCopySuccess?.(canonicalUrl);

      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = setTimeout(() => {
        setCopyStatus("idle");
      }, 3000);
    } catch (err: any) {
      setCopyStatus("error");
      setShowManualFallback(true);
      setLiveAnnouncement("Failed to copy link. Please copy manually.");
      onCopyError?.(err instanceof Error ? err : new Error(String(err)));
    }
  };

  const handleDownloadBadge = async () => {
    setDownloadStatus("downloading");
    setLiveAnnouncement("Generating high-resolution PNG badge...");

    try {
      const badgeParams: NomadBadgeParams = {
        displayName: userName || "Nomad Explorer",
        rank: stamp?.tierTitle || stamp?.badgeType || "Explorer",
        verifiedCheckIns:
          stamp?.epoch && Number.isFinite(stamp.epoch) && stamp.epoch > 0
            ? stamp.epoch
            : 1,
        issuedAt: new Date(),
      };

      await downloadNomadPassportPngBadge(badgeParams, 2);
      const filename = getNomadPassportPngFilename(badgeParams.displayName);

      setDownloadStatus("success");
      setLiveAnnouncement(`Nomad passport badge downloaded as ${filename}!`);
      triggerCelebratoryConfetti();
      onDownloadBadgeSuccess?.(filename);

      if (downloadTimerRef.current) {
        clearTimeout(downloadTimerRef.current);
      }
      downloadTimerRef.current = setTimeout(() => {
        setDownloadStatus("idle");
      }, 3000);
    } catch (err: any) {
      setDownloadStatus("error");
      setLiveAnnouncement("Failed to generate passport badge image.");
      onDownloadBadgeError?.(
        err instanceof Error ? err : new Error(String(err)),
      );

      if (downloadTimerRef.current) {
        clearTimeout(downloadTimerRef.current);
      }
      downloadTimerRef.current = setTimeout(() => {
        setDownloadStatus("idle");
      }, 3000);
    }
  };

  return (
    <div
      data-testid="nomad-passport-certificate"
      className={`relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/90 p-6 shadow-xl backdrop-blur-md transition-all ${className}`}
    >
      {/* Dedicated Confetti Overlay Canvas */}
      <canvas
        ref={confettiCanvasRef}
        data-testid="confetti-canvas"
        className="pointer-events-none absolute inset-0 z-50 h-full w-full"
        aria-hidden="true"
      />

      {/* Screen Reader Live Region for Announcements */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid="copy-status-announcement"
      >
        {liveAnnouncement}
      </div>

      <div className="flex flex-col items-center text-center">
        {/* Certificate Header */}
        <div className="mb-4 space-y-1">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-cyan-400">
            <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
            Verified Nomad Credential
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-white">
            Nomad Passport Certificate
          </h2>
          <p className="text-sm text-slate-400">
            Issued to{" "}
            <span className="font-semibold text-slate-200">{userName}</span>
            {stamp?.venueName && ` at ${stamp.venueName}`}
          </p>
        </div>

        {/* 3D / 2D Interactive Nomad Passport Coin Display */}
        <div className="my-2 w-full max-w-[18rem]">
          <NomadPassportCoin stamp={stamp} />
        </div>

        {/* Certificate Details */}
        {stamp && (
          <div className="mt-4 grid w-full max-w-sm grid-cols-2 gap-2 text-left text-xs text-slate-300">
            <div className="rounded-lg border border-slate-800/80 bg-slate-950/50 p-2.5">
              <span className="text-[10px] uppercase tracking-wider text-slate-500">
                Tier
              </span>
              <p className="font-medium text-slate-200 capitalize">
                {stamp.tierTitle || stamp.badgeType}
              </p>
            </div>
            <div className="rounded-lg border border-slate-800/80 bg-slate-950/50 p-2.5">
              <span className="text-[10px] uppercase tracking-wider text-slate-500">
                Country
              </span>
              <p className="font-medium text-slate-200">
                {stamp.countryName || stamp.countryCode || "Global"}
              </p>
            </div>
            {/* Cryptographic Issuer Credential Stamp */}
            {(stamp.nullifierHash ||
              stamp.verificationSignature ||
              stamp.stampId) && (
              <div className="col-span-2 min-w-0 rounded-lg border border-slate-800/80 bg-slate-950/50 p-2.5">
                <span className="text-[10px] uppercase tracking-wider text-slate-500">
                  Issuer Credential Stamp
                </span>
                <p
                  title={
                    stamp.nullifierHash ||
                    stamp.verificationSignature ||
                    stamp.stampId
                  }
                  className="font-mono text-[11px] text-slate-300 truncate sm:break-all select-all min-w-0"
                >
                  {stamp.nullifierHash ||
                    stamp.verificationSignature ||
                    stamp.stampId}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Action Controls */}
        <div className="mt-6 flex flex-col items-center gap-3">
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={handleCopyLink}
              aria-label="Copy Nomad Passport Link"
              data-testid="copy-nomad-passport-link-btn"
              className={`inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all shadow-md focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2 focus:ring-offset-slate-900 ${
                copyStatus === "success"
                  ? "bg-emerald-600 text-white shadow-emerald-500/20 hover:bg-emerald-500"
                  : "bg-cyan-600 text-white shadow-cyan-500/20 hover:bg-cyan-500 active:scale-95"
              }`}
            >
              {copyStatus === "success" ? (
                <>
                  <Check className="h-4 w-4 text-white" aria-hidden="true" />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 text-white" aria-hidden="true" />
                  <span>Copy Nomad Passport Link</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleDownloadBadge}
              aria-label="Download Nomad Passport Badge (PNG)"
              data-testid="download-passport-badge-btn"
              disabled={downloadStatus === "downloading"}
              className={`inline-flex items-center justify-center gap-2 rounded-xl border px-5 py-2.5 text-sm font-semibold transition-all shadow-md focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2 focus:ring-offset-slate-900 ${
                downloadStatus === "success"
                  ? "border-emerald-500/50 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/50"
                  : downloadStatus === "error"
                    ? "border-rose-500/50 bg-rose-950/40 text-rose-300 hover:bg-rose-900/50"
                    : "border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white active:scale-95"
              } disabled:opacity-60`}
            >
              {downloadStatus === "downloading" ? (
                <>
                  <Loader2
                    className="h-4 w-4 animate-spin text-cyan-400"
                    aria-hidden="true"
                  />
                  <span>Generating PNG...</span>
                </>
              ) : downloadStatus === "success" ? (
                <>
                  <Check
                    className="h-4 w-4 text-emerald-400"
                    aria-hidden="true"
                  />
                  <span>Badge Downloaded!</span>
                </>
              ) : downloadStatus === "error" ? (
                <>
                  <AlertCircle
                    className="h-4 w-4 text-rose-400"
                    aria-hidden="true"
                  />
                  <span>Download Failed</span>
                </>
              ) : (
                <>
                  <Download
                    className="h-4 w-4 text-cyan-400"
                    aria-hidden="true"
                  />
                  <span>Download Badge (PNG)</span>
                </>
              )}
            </button>
          </div>

          {/* Visual confirmation pill below button */}
          {copyStatus === "success" && (
            <p
              className="text-xs font-medium text-emerald-400 animate-fadeIn"
              data-testid="copy-success-badge"
            >
              Profile link copied to clipboard!
            </p>
          )}

          {/* Manual Copy Fallback when clipboard API fails */}
          {showManualFallback && (
            <div
              data-testid="manual-copy-fallback"
              className="mt-2 w-full max-w-sm rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-left"
            >
              <div className="flex items-center gap-1.5 text-xs font-medium text-amber-300">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <label htmlFor={fallbackInputId} className="cursor-pointer">
                  Copy link manually:
                </label>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  id={fallbackInputId}
                  type="text"
                  readOnly
                  value={canonicalUrl}
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                  aria-label="Nomad Passport Link URL"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 select-all focus:border-cyan-400 focus:outline-none"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default NomadPassportCertificate;
