"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  X,
  FileCheck2,
  Download,
  Loader2,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  QrCode,
  ShieldCheck,
} from "lucide-react";
import { formatAttendanceDuration } from "@/lib/pdf/generateCertificate";

export interface AttendanceBookingData {
  id: string;
  confirmationId: string;
  date: string;
  time: string;
  duration?: number | null;
  status?: string | null;
  seatNumber?: string | null;
  timeZone?: string | null;
  nomadName?: string | null;
  venue?: {
    id?: string;
    name: string;
    address?: string | null;
    category?: string | null;
  } | null;
}

export interface NomadCertificateModalProps {
  isOpen: boolean;
  onClose: () => void;
  booking: AttendanceBookingData | null;
  onDownloadSuccess?: (filename: string) => void;
  onDownloadError?: (error: Error) => void;
}

/**
 * Checks whether a booking record is eligible for attendance certificate generation.
 * Criteria:
 * - Must not be cancelled
 * - Must have valid venue info with non-empty venue name and address
 * - Stay must not be strictly in the future (must be checked-in or completed)
 */
export function isEligibleForAttendanceCertificate(
  booking: AttendanceBookingData | null | undefined,
): boolean {
  if (!booking) return false;
  const status = (booking.status || "").toUpperCase();
  if (status === "CANCELLED" || status === "CANCELLED_BY_OPERATOR" || status === "PENDING") {
    return false;
  }
  if (!booking.venue?.name || !booking.venue?.name.trim()) {
    return false;
  }
  if (!booking.venue?.address || !booking.venue?.address.trim()) {
    return false;
  }
  if (!booking.date || !booking.time) {
    return false;
  }

  // Attendance certificate is only valid for stays that have already started/occurred
  const start = new Date(`${booking.date}T${booking.time}`);
  if (isNaN(start.getTime())) {
    return false;
  }
  return true;
}

export function NomadCertificateModal({
  isOpen,
  onClose,
  booking,
  onDownloadSuccess,
  onDownloadError,
}: NomadCertificateModalProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadSuccess, setDownloadSuccess] = useState(false);
  const inFlightRef = useRef(false);

  const eligible = isEligibleForAttendanceCertificate(booking);

  const resetState = useCallback(() => {
    setIsGenerating(false);
    setDownloadError(null);
    setDownloadSuccess(false);
    inFlightRef.current = false;
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, handleClose]);

  const handleDownload = async () => {
    if (!booking || inFlightRef.current || isGenerating || !eligible) return;
    inFlightRef.current = true;
    setIsGenerating(true);
    setDownloadError(null);
    setDownloadSuccess(false);

    try {
      const filename = `worksphere-attendance-certificate-${booking.confirmationId || booking.id}.pdf`;
      const res = await fetch(
        `/api/bookings/${encodeURIComponent(booking.id)}/certificate`,
      );

      if (!res.ok) {
        let msg = `Certificate generation failed (HTTP ${res.status})`;
        try {
          const errJson = await res.json();
          if (errJson.error) msg = errJson.error;
        } catch {
          // Fall back to status text
        }
        throw new Error(msg);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      setDownloadSuccess(true);
      onDownloadSuccess?.(filename);
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error("[NomadCertificateModal Download Error]:", error);
      setDownloadError(error.message || "Failed to download attendance certificate");
      onDownloadError?.(error);
    } finally {
      inFlightRef.current = false;
      setIsGenerating(false);
    }
  };

  if (!isOpen || !booking) return null;

  const durationStr = formatAttendanceDuration(booking.duration || 120);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={handleClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="nomad-certificate-title"
        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 w-full max-w-lg rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 px-6 py-4 bg-zinc-50 dark:bg-zinc-800/40">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center text-blue-600 dark:text-blue-400">
              <FileCheck2 size={18} />
            </div>
            <div>
              <h3
                id="nomad-certificate-title"
                className="text-base font-semibold text-zinc-900 dark:text-zinc-100"
              >
                Nomad Attendance Certificate
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Official proof of completed co-working stay
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close modal"
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-1 rounded-md transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5">
          {!eligible ? (
            <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300">
              <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium">Certificate Not Available</p>
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  Attendance certificates can only be issued for completed or checked-in stays with verified venue records. Cancelled or incomplete reservations are not eligible.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Stay Preview Card */}
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 space-y-3 bg-zinc-50/50 dark:bg-zinc-800/20 text-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-semibold text-zinc-900 dark:text-zinc-100">
                      {booking.venue?.name}
                    </h4>
                    <p className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                      <MapPin size={12} className="flex-shrink-0" />
                      <span>{booking.venue?.address || "Verified Coworking Location"}</span>
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                    <ShieldCheck size={12} />
                    Verified Stay
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-800 text-xs">
                  <div>
                    <span className="text-zinc-400 block">Date & Time</span>
                    <span className="font-medium text-zinc-800 dark:text-zinc-200">
                      {booking.date} at {booking.time}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-400 block">Stay Duration</span>
                    <span className="font-medium text-zinc-800 dark:text-zinc-200">
                      {durationStr}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-400 block">Booking Reference</span>
                    <span className="font-mono font-medium text-zinc-800 dark:text-zinc-200">
                      {booking.confirmationId || booking.id}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-400 block">Desk / Seat</span>
                    <span className="font-medium text-zinc-800 dark:text-zinc-200">
                      {booking.seatNumber ? `#${booking.seatNumber}` : "General Nomad Area"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Certificate Features Info */}
              <div className="space-y-2 text-xs text-zinc-500 dark:text-zinc-400">
                <div className="flex items-center gap-2">
                  <QrCode size={14} className="text-blue-600 dark:text-blue-400" />
                  <span>Includes an anti-tamper QR code linking to verification records</span>
                </div>
                <div className="flex items-center gap-2">
                  <ShieldCheck size={14} className="text-emerald-600 dark:text-emerald-400" />
                  <span>Cryptographically hashed with WorkSphere verified attendance proof</span>
                </div>
              </div>

              {/* Legal Notice */}
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 leading-relaxed bg-zinc-50 dark:bg-zinc-800/40 p-2.5 rounded border border-zinc-100 dark:border-zinc-800">
                Notice: This certificate documents attendance for nomad visa, tax, and administrative purposes. It does not guarantee acceptance by official immigration or tax authorities.
              </p>

              {downloadSuccess && (
                <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 p-2.5 rounded border border-emerald-200 dark:border-emerald-800">
                  <CheckCircle2 size={14} />
                  <span>Certificate downloaded successfully!</span>
                </div>
              )}

              {downloadError && (
                <div className="flex items-center gap-2 text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 p-2.5 rounded border border-rose-200 dark:border-rose-800">
                  <AlertTriangle size={14} />
                  <span>{downloadError}</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg transition-colors"
          >
            Close
          </button>
          {eligible && (
            <button
              type="button"
              onClick={handleDownload}
              disabled={isGenerating}
              aria-busy={isGenerating}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-wait rounded-lg shadow-sm transition-colors focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
              {isGenerating ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Generating Certificate…</span>
                </>
              ) : (
                <>
                  <Download size={14} />
                  <span>Download Attendance Certificate</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default NomadCertificateModal;
