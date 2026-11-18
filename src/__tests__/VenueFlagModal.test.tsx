"use client";

import React, { useState, useEffect, useRef } from "react";
import { Flag, X, AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  sanitizeVenueFlagDetails,
  type VenueFlagReason,
} from "@/lib/validations/venueFlag";

export const FLAG_DETAILS_MIN_LENGTH = 10;
export const FLAG_DETAILS_MAX_LENGTH = 500;

export const FLAG_REASON_OPTIONS: { value: VenueFlagReason; label: string }[] = [
  { value: "closed", label: "Venue Permanently or Temporarily Closed" },
  { value: "incorrect_info", label: "Incorrect Hours, Address, or Info" },
  { value: "loud_noise", label: "Excessive Noise / Not Work-Friendly" },
  { value: "wifi_broken", label: "Broken or Unusable WiFi" },
  { value: "other", label: "Other Issue" },
];

export interface VenueFlagModalProps {
  isOpen: boolean;
  onClose: () => void;
  venueId: string;
  venueName?: string;
  initialReason?: VenueFlagReason;
  initialDetails?: string;
  onSubmit?: (payload: {
    venueId: string;
    reason: VenueFlagReason;
    details: string;
  }) => Promise<void> | void;
  className?: string;
  "data-testid"?: string;
}

/**
 * VenueFlagModal
 *
 * Modal dialog allowing users to flag inaccurate or problematic venue listings.
 * Sanitizes flag details before client-side preview rendering and form submission
 * to prevent stored or reflected XSS payloads.
 */
export function VenueFlagModal({
  isOpen,
  onClose,
  venueId,
  venueName = "Workspace",
  initialReason = "incorrect_info",
  initialDetails = "",
  onSubmit,
  className,
  "data-testid": dataTestId = "venue-flag-modal",
}: VenueFlagModalProps) {
  const [reason, setReason] = useState<VenueFlagReason>(initialReason);
  const [details, setDetails] = useState<string>(initialDetails);
  const [isTouched, setIsTouched] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setReason(initialReason);
      setDetails(initialDetails);
      setIsTouched(false);
      setIsSubmitting(false);
    }
  }, [isOpen, initialReason, initialDetails]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const sanitizedDetails = sanitizeVenueFlagDetails(details);
  const isLengthValid =
    sanitizedDetails.length >= FLAG_DETAILS_MIN_LENGTH &&
    sanitizedDetails.length <= FLAG_DETAILS_MAX_LENGTH;
  const isSubmitDisabled = !isLengthValid || isSubmitting;

  const showError =
    (isTouched || details.length > 0) &&
    (sanitizedDetails.length < FLAG_DETAILS_MIN_LENGTH ||
      sanitizedDetails.length > FLAG_DETAILS_MAX_LENGTH);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsTouched(true);

    if (isSubmitDisabled) return;

    setIsSubmitting(true);
    try {
      await onSubmit?.({
        venueId,
        reason,
        details: sanitizedDetails,
      });
      onClose();
    } catch {
      // Handled by parent error boundary or toast notifications
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="venue-flag-modal-title"
      data-testid={dataTestId}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div
        className="fixed inset-0 -z-10"
        aria-hidden="true"
        onClick={onClose}
        data-testid="venue-flag-modal-backdrop"
      />

      <div
        ref={modalRef}
        className={cn(
          "w-full max-w-lg rounded-3xl border border-zinc-200 dark:border-zinc-800",
          "bg-white dark:bg-zinc-900 p-6 sm:p-7 shadow-2xl space-y-6 relative",
          className,
        )}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Flag className="w-5 h-5" />
            </div>
            <div>
              <h3
                id="venue-flag-modal-title"
                className="text-lg font-bold text-zinc-900 dark:text-zinc-100"
              >
                Flag {venueName}
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Help moderators keep workspace details accurate and safe.
              </p>
            </div>
          </div>
          <button
            type="button"
            data-testid="venue-flag-modal-close"
            onClick={onClose}
            aria-label="Close flag modal"
            className="rounded-xl p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <label
              htmlFor="venue-flag-reason"
              className="block text-xs font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-400"
            >
              Reason for Flagging
            </label>
            <select
              id="venue-flag-reason"
              data-testid="venue-flag-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value as VenueFlagReason)}
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {FLAG_REASON_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="venue-flag-details"
              className="block text-xs font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-400"
            >
              Details
            </label>
            <textarea
              id="venue-flag-details"
              data-testid="venue-flag-details"
              rows={4}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              onBlur={() => setIsTouched(true)}
              placeholder="Describe the issue in detail (minimum 10 characters)..."
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-primary"
            />

            <div className="flex items-center justify-between text-xs">
              {showError ? (
                <span
                  data-testid="venue-flag-error"
                  className="flex items-center gap-1 text-red-500"
                >
                  <AlertCircle className="w-3.5 h-3.5" />
                  {sanitizedDetails.length > FLAG_DETAILS_MAX_LENGTH
                    ? "Details cannot exceed 500 characters."
                    : "Details must be at least 10 characters after removing HTML tags."}
                </span>
              ) : (
                <span className="text-zinc-400">
                  HTML and script tags are automatically stripped.
                </span>
              )}
              <span className="text-zinc-400">
                {sanitizedDetails.length}/{FLAG_DETAILS_MAX_LENGTH}
              </span>
            </div>
          </div>

          {sanitizedDetails.length > 0 && (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/70 p-3 space-y-1">
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                Sanitized Preview
              </span>
              <p
                data-testid="venue-flag-preview"
                className="text-xs text-zinc-700 dark:text-zinc-300 break-words"
              >
                {sanitizedDetails}
              </p>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              data-testid="venue-flag-submit"
              disabled={isSubmitDisabled}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              Submit Flag
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
