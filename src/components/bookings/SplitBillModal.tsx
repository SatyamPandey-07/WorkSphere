"use client";

import { useEffect, useState } from "react";
import {
  X,
  CreditCard,
  DollarSign,
  Share2,
  Copy,
  Check,
  Send,
  Mail,
  MessageSquare,
  Users,
  Loader2,
  Sparkles,
  ExternalLink,
  ShieldCheck,
} from "lucide-react";
import type { BookingSummary } from "./BookingList";
import type { SplitBillSummary, GuestShare } from "@/lib/billing/splitPayment";

export interface SplitBillModalProps {
  booking: BookingSummary;
  isOpen: boolean;
  onClose: () => void;
}

export function SplitBillModal({
  booking,
  isOpen,
  onClose,
}: SplitBillModalProps) {
  const [splitData, setSplitData] = useState<SplitBillSummary | null>(null);
  const [totalAmount, setTotalAmount] = useState<number>(30);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    async function loadSplit() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/bookings/${booking.id}/split-bill`);
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error || "Failed to load split bill");
        }
        setSplitData(json.split);
        if (json.split?.totalAmount) {
          setTotalAmount(json.split.totalAmount);
        }
      } catch (err: any) {
        setError(err.message || "Could not calculate split bill");
      } finally {
        setLoading(false);
      }
    }

    loadSplit();
  }, [booking.id, isOpen]);

  const handleUpdateTotal = async (newTotal: number) => {
    setTotalAmount(newTotal);
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
    } catch {}
  };

  const handleCopy = (url: string, id: string) => {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="split-bill-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-200"
    >
      <div className="w-full max-w-xl rounded-2xl bg-zinc-950 border border-zinc-800 text-zinc-100 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
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
                {booking.venue?.name ?? "Workspace"} · {booking.date}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6 space-y-6">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center text-zinc-400">
              <Loader2 className="w-6 h-6 animate-spin text-violet-400 mb-2" />
              <p className="text-xs">Calculating auto-payment split links...</p>
            </div>
          ) : error ? (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-300">
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
                      value={totalAmount}
                      onChange={(e) => handleUpdateTotal(Number(e.target.value))}
                      className="w-24 rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-right text-sm font-bold text-white focus:outline-none focus:ring-1 focus:ring-violet-500 font-mono"
                    />
                    <span className="text-xs text-zinc-500 font-medium">USD</span>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-zinc-800/80 pt-3 text-xs">
                  <span className="text-zinc-400">
                    Your Share (Host):
                  </span>
                  <span className="font-bold text-emerald-400 font-mono">
                    ${splitData?.hostShare.toFixed(2)} USD
                  </span>
                </div>
              </div>

              {/* Guest Shares List */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5" /> Guest Auto-Payment Links (
                    {splitData?.guestShares.length || 0})
                  </h3>
                  {splitData?.paidCount !== undefined && (
                    <span className="text-xs text-zinc-400 font-mono">
                      {splitData.paidCount}/{splitData.guestShares.length} Paid
                    </span>
                  )}
                </div>

                {splitData?.guestShares.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-zinc-800 p-6 text-center text-zinc-500 space-y-1">
                    <p className="text-xs font-medium text-zinc-300">
                      No guests added to this booking yet
                    </p>
                    <p className="text-[11px]">
                      Add guest email addresses during reservation to auto-generate split payment links.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {splitData?.guestShares.map((guest) => {
                      const isCopied = copiedId === guest.guestId;
                      return (
                        <div
                          key={guest.guestId}
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
                                ${guest.amount.toFixed(2)} USD
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
                            <a
                              href={guest.shareLinks.whatsapp}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 text-xs font-semibold transition-colors"
                            >
                              <MessageSquare className="w-3.5 h-3.5" />
                              WhatsApp
                            </a>

                            <a
                              href={guest.shareLinks.email}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold transition-colors"
                            >
                              <Mail className="w-3.5 h-3.5" />
                              Email
                            </a>

                            <button
                              type="button"
                              onClick={() => handleCopy(guest.paymentUrl, guest.guestId)}
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
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-medium transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
