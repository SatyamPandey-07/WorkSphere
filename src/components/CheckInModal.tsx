"use client";

import React, { useState, useEffect } from "react";
import { X, CheckCircle2, AlertCircle, Loader2, QrCode, Tag, Flame } from "lucide-react";
import confetti from "canvas-confetti";

export interface CheckInModalProps {
  isOpen: boolean;
  onClose: () => void;
  venueName?: string;
  venueId?: string;
  /** Whether browser GPS geolocation location acquisition is currently pending */
  isLocating?: boolean;
  currentStreak?: number;
  onCheckIn?: (data: {
    code: string;
    couponCode?: string;
    location?: { lat: number; lng: number; accuracy?: number } | null;
  }) => Promise<{ currentStreak?: number; message?: string } | void> | void;
}

/**
 * Trims leading/trailing whitespace and converts check-in codes to uppercase.
 */
export function sanitizeCheckInCode(code: string): string {
  return typeof code === "string" ? code.trim().toUpperCase() : "";
}

/**
 * Trims leading/trailing whitespace and converts discount coupons to uppercase.
 */
export function sanitizeCouponCode(coupon: string): string {
  return typeof coupon === "string" ? coupon.trim().toUpperCase() : "";
}

/**
 * CheckInModal with automatic whitespace trimming, uppercase conversion,
 * pure-whitespace validation feedback, pending geolocation accuracy locks,
 * and confetti celebration on successful check-in.
 */
export function CheckInModal({
  isOpen,
  onClose,
  venueName = "Workspace",
  venueId,
  isLocating: isLocatingProp,
  currentStreak,
  onCheckIn,
}: CheckInModalProps) {
  const [checkInCode, setCheckInCode] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [streak, setStreak] = useState<number | null>(currentStreak ?? null);
  const [internalLocating, setInternalLocating] = useState(false);
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);

  const isGpsPending = isLocatingProp !== undefined ? isLocatingProp : internalLocating;

  // Celebrate successful check-in with confetti (respects reduced motion) (#5058)
  useEffect(() => {
    let animationFrameId: number | undefined;
    if (isSuccess) {
      const respectsReducedMotion =
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      if (!respectsReducedMotion) {
        confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 },
          zIndex: 25000,
        });
      }
    }
    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, [isSuccess]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    const trimmedCode = sanitizeCheckInCode(checkInCode);
    const trimmedCoupon = sanitizeCouponCode(couponCode);

    // If submitted input is empty or consists purely of spaces
    if (!trimmedCode) {
      setValidationError("Please enter a valid check-in code.");
      return;
    }

    setIsLoading(true);
    try {
      if (onCheckIn) {
        const res = await onCheckIn({
          code: trimmedCode,
          couponCode: trimmedCoupon || undefined,
        });
        if (res && typeof res === "object" && "currentStreak" in res && typeof res.currentStreak === "number") {
          setStreak(res.currentStreak);
        } else if (currentStreak !== undefined) {
          setStreak(currentStreak + 1);
        }
      } else {
        // Fallback default API call
        const response = await fetch("/api/check-in", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: trimmedCode,
            couponCode: trimmedCoupon || undefined,
            venueId,
          }),
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || "Check-in failed. Please verify your code.");
        }

        const data = await response.json().catch(() => ({}));
        if (data && typeof data.currentStreak === "number") {
          setStreak(data.currentStreak);
        } else if (currentStreak !== undefined) {
          setStreak(currentStreak + 1);
        }
      }

      setIsSuccess(true);
      setTimeout(() => {
        handleClose();
      }, 1800);
    } catch (err: any) {
      setValidationError(err.message || "Failed to process check-in.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setCheckInCode("");
    setCouponCode("");
    setValidationError(null);
    setIsLoading(false);
    setIsSuccess(false);
    setStreak(currentStreak ?? null);
    onClose();
  };

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawVal = e.target.value;
    // Real-time pure-whitespace validation warning
    if (rawVal.length > 0 && rawVal.trim().length === 0) {
      setValidationError("Code cannot consist purely of spaces.");
    } else {
      setValidationError(null);
    }
    setCheckInCode(rawVal);
  };

  const handleCouponChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCouponCode(e.target.value);
  };

  return (
    <div
      data-testid="checkin-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <div className="relative w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden p-6">
        {/* Close Button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 p-1.5 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          aria-label="Close check-in modal"
          data-testid="checkin-modal-close"
        >
          <X className="w-5 h-5" />
        </button>

        {isSuccess ? (
          <div
            data-testid="checkin-success-view"
            className="py-8 flex flex-col items-center justify-center text-center space-y-3 animate-in fade-in duration-200"
          >
            <div className="relative">
              <CheckCircle2 className="w-14 h-14 text-emerald-500 animate-bounce" />
              <div className="absolute -top-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-amber-400 text-amber-950 font-bold text-xs shadow-md">
                🎉
              </div>
            </div>
            <h3 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
              Check-In Successful!
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-xs">
              Welcome to {venueName}. Enjoy your productive session.
            </p>

            {streak !== null && streak > 0 && (
              <div
                data-testid="checkin-streak-banner"
                className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500/15 via-orange-500/15 to-red-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-xs font-bold shadow-sm animate-in fade-in zoom-in duration-300"
              >
                <Flame className="w-4 h-4 text-orange-500 fill-orange-500 animate-pulse" />
                <span>
                  {streak} Day Check-In Streak! 🔥
                </span>
              </div>
            )}
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                <QrCode className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50">
                  Venue Check-In
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Enter your reservation or desk access code for {venueName}.
                </p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Check-In Code Input */}
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Check-In Code <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    data-testid="checkin-code-input"
                    value={checkInCode}
                    onChange={handleCodeChange}
                    placeholder="e.g. WS-PASS-100"
                    disabled={isLoading}
                    className={`w-full px-3.5 py-2.5 bg-zinc-50 dark:bg-zinc-800/80 border rounded-xl text-sm font-mono uppercase tracking-wider text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none transition-all ${
                      validationError
                        ? "border-red-400 dark:border-red-500 focus:ring-2 focus:ring-red-400"
                        : "border-zinc-200 dark:border-zinc-700 focus:ring-2 focus:ring-blue-500"
                    }`}
                  />
                </div>
              </div>

              {/* Coupon / Discount Code (Optional) */}
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5 flex items-center gap-1">
                  <Tag className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Promo / Discount Code (Optional)</span>
                </label>
                <input
                  type="text"
                  data-testid="coupon-code-input"
                  value={couponCode}
                  onChange={handleCouponChange}
                  placeholder="e.g. WORK50"
                  disabled={isLoading}
                  className="w-full px-3.5 py-2.5 bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm font-mono uppercase tracking-wider text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                />
              </div>

              {/* Validation / Error Feedback */}
              {validationError && (
                <div
                  data-testid="checkin-validation-error"
                  className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 flex items-start gap-2 text-xs text-red-600 dark:text-red-400 font-medium"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{validationError}</span>
                </div>
              )}

              {/* Submit Buttons */}
              <div className="pt-2 flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={isLoading}
                  className="w-1/2 py-2.5 px-4 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-bold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isLoading || isGpsPending}
                  data-testid="checkin-submit-btn"
                  className="w-1/2 py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-md shadow-blue-500/20 flex items-center justify-center gap-1.5 transition-all disabled:opacity-50"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Verifying...</span>
                    </>
                  ) : isGpsPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Acquiring location...</span>
                    </>
                  ) : (
                    <span>Confirm Check-In</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
