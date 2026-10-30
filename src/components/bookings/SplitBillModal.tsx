"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import {
  X,
  CreditCard,
  Copy,
  Check,
  Mail,
  MessageSquare,
  Users,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import type { BookingSummary } from "./BookingList";
import type { SplitBillSummary, GuestShare } from "@/lib/billing/splitPayment";

export interface SplitBillModalProps {
  booking: BookingSummary;
  isOpen: boolean;
  onClose: () => void;
  className?: string;
  testId?: string;
}

function formatCurrency(val: number | undefined | null): string {
  if (typeof val !== "number" || isNaN(val)) return "0.00";
  return val.toFixed(2);
}

export function SplitBillModal({
  booking,
  isOpen,
  onClose,
  className = "",
  testId = "split-bill-modal",
}: SplitBillModalProps) {
  const [splitData, setSplitData] = useState<SplitBillSummary | null>(null);
  const [totalAmount, setTotalAmount] = useState<number>(30);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Clean up copy timeout on unmount
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  // Keyboard navigation: Escape key dismiss
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  // Load split data
  useEffect(() => {
    if (!isOpen) return;

    if (!booking?.id) {
      setLoading(false);
      setError("No booking details provided");
      return;
    }

    const abortController = new AbortController();
    let isSubscribed = true;

    async function loadSplit() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/bookings/${booking.id}/split-bill`, {
          signal: abortController.signal,
        });
        const json = await res.json();
        if (!isSubscribed) return;

        if (!res.ok) {
          throw new Error(json.error || "Failed to load split bill");
        }
        setSplitData(json.split);
        if (typeof json.split?.totalAmount === "number" && !isNaN(json.split.totalAmount)) {
          setTotalAmount(json.split.totalAmount);
        }
      } catch (err: unknown) {
        if (!isSubscribed || abortController.signal.aborted) return;
        const message = err instanceof Error ? err.message : "Could not calculate split bill";
        setError(message);
      } finally {
        if (isSubscribed) {
          setLoading(false);
        }
      }
    }

    loadSplit();

    return () => {
      isSubscribed = false;
      abortController.abort();
    };
  }, [booking?.id, isOpen]);

  const handleUpdateTotal = async (newTotal: number) => {
    if (isNaN(newTotal) || newTotal < 0) return;
    setTotalAmount(newTotal);

    if (!booking?.id) return;

    try {
      const res = await fetch(`/api/bookings/${booking.id}/split-bill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ totalAmount: newTotal }),
      });
      const json = await res.json();
      if (res.ok && json.split) {
        setSplitData(json.split);
      }
    } catch {
      // Ignore network errors on total update debounce
    }
  };

  const handleCopy = (url: string, id: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).catch(() => {});
    }
    setCopiedId(id);

    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }
    copyTimeoutRef.current = setTimeout(() => {
      setCopiedId(null);
    }, 2000);
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  const guestShares = Array.isArray(splitData?.guestShares) ? splitData.guestShares : [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="split-bill-title"
      data-testid={testId}
      onClick={handleBackdropClick}
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-200 ${className}`.trim()}
    >
      <div
        className="w-full max-w-xl rounded-2xl bg-zinc-950 border border-zinc-800 text-zinc-100 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/50">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10 text-violet-400 border border-violet-500/20">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <h2
                id="split-bill-title"
                className="text-base font-semibold text-white"
              >
                Split Bill &amp; Guest Passes
              </h2>
              <p className="text-xs text-zinc-400">
                {booking?.venue?.name ?? "Workspace"} · {booking?.date ?? ""}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            data-testid="split-bill-close-btn"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6 space-y-6">
          {loading ? (
            <div
              data-testid="split-bill-loading"
              className="py-12 flex flex-col items-center justify-center text-zinc-400"
            >
              <Loader2 className="w-6 h-6 animate-spin text-violet-400 mb-2" />
              <p className="text-xs">Calculating auto-payment split links...</p>
            </div>
          ) : error ? (
            <div
              data-testid="split-bill-error"
              className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-300"
            >
              {error}
            </div>
          ) : (
            <>
              {/* Total Amount Adjuster */}
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400 font-medium">
                    Total Booking Cost
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-bold text-zinc-300">$</span>
                    <input
                      type="number"
                      min="5"
                      max="1000"
                      data-testid="split-bill-total-input"
                      value={isNaN(totalAmount) ? "" : totalAmount}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        handleUpdateTotal(isNaN(val) ? 0 : val);
                      }}
                      className="w-24 rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-right text-sm font-bold text-white focus:outline-none focus:ring-1 focus:ring-violet-500 font-mono"
                    />
                    <span className="text-xs text-zinc-500 font-medium">USD</span>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-zinc-800/80 pt-3 text-xs">
                  <span className="text-zinc-400">
                    Your Share (Host):
                  </span>
                  <span
                    data-testid="split-bill-host-share"
                    className="font-bold text-emerald-400 font-mono"
                  >
                    ${formatCurrency(splitData?.hostShare)} USD
                  </span>
                </div>
              </div>

              {/* Guest Shares List */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5" /> Guest Auto-Payment Links (
                    {guestShares.length})
                  </h3>
                  {splitData?.paidCount !== undefined && (
                    <span className="text-xs text-zinc-400 font-mono">
                      {splitData.paidCount}/{guestShares.length} Paid
                    </span>
                  )}
                </div>

                {guestShares.length === 0 ? (
                  <div
                    data-testid="split-bill-empty-guests"
                    className="rounded-2xl border border-dashed border-zinc-800 p-6 text-center text-zinc-500 space-y-1"
                  >
                    <p className="text-xs font-medium text-zinc-300">
                      No guests added to this booking yet
                    </p>
                    <p className="text-[11px]">
                      Add guest email addresses during reservation to auto-generate split payment links.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {guestShares.map((guest) => {
                      const isCopied = copiedId === guest.guestId;
                      return (
                        <div
                          key={guest.guestId}
                          data-testid={`split-guest-card-${guest.guestId}`}
                          className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-3"
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="text-sm font-semibold text-white">
                                {guest.name || guest.email}
                              </div>
                              {guest.name && (
                                <div className="text-xs text-zinc-400">
                                  {guest.email}
                                </div>
                              )}
                            </div>
                            <div className="text-right">
                              <div className="text-sm font-bold text-emerald-400 font-mono">
                                ${formatCurrency(guest.amount)} USD
                              </div>
                              <span
                                className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                  guest.paid
                                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                    : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                                }`}
                              >
                                {guest.paid ? "Paid & Confirmed" : "Pending Payment"}
                              </span>
                            </div>
                          </div>

                          {/* 1-Tap Share Actions */}
                          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-zinc-800/60">
                            {guest.shareLinks?.whatsapp && (
                              <a
                                href={guest.shareLinks.whatsapp}
                                target="_blank"
                                rel="noopener noreferrer"
                                data-testid={`whatsapp-link-${guest.guestId}`}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 text-xs font-semibold transition-colors"
                              >
                                <MessageSquare className="w-3.5 h-3.5" />
                                WhatsApp
                              </a>
                            )}

                            {guest.shareLinks?.email && (
                              <a
                                href={guest.shareLinks.email}
                                data-testid={`email-link-${guest.guestId}`}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold transition-colors"
                              >
                                <Mail className="w-3.5 h-3.5" />
                                Email
                              </a>
                            )}

                            <button
                              type="button"
                              onClick={() => handleCopy(guest.paymentUrl || "", guest.guestId)}
                              data-testid={`copy-btn-${guest.guestId}`}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold transition-colors ml-auto"
                            >
                              {isCopied ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                  <span className="text-emerald-400">Copied!</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5" />
                                  Copy Link
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-zinc-800 bg-zinc-900/50 text-xs text-zinc-400">
          <span className="flex items-center gap-1.5 text-[11px]">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            Automatic pass issuance upon payment
          </span>
          <button
            type="button"
            onClick={onClose}
            data-testid="split-bill-done-btn"
            className="px-4 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-medium transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export default SplitBillModal;
