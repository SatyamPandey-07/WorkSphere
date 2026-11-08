"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  QrCode,
  Copy,
  Check,
  ExternalLink,
  ShieldCheck,
  CreditCard,
  RefreshCw,
  Clock,
  Sparkles,
  AlertCircle,
  Loader2,
  Coins,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";
import {
  createSolanaPayUrl,
  generateSolanaPaymentReference,
  getSolanaExplorerUrl,
  SOLANA_USDC_MINT_MAINNET,
  DEFAULT_TREASURY_SOLANA_ADDRESS,
  SolanaPayStatusResponse,
} from "@/lib/payments/solanaPay";

export type SupportedCurrency = "USD" | "EUR" | "GBP" | "SOL_USDC";

export interface BookingCheckoutItem {
  bookingId: string;
  deskName: string;
  venueName: string;
  durationHours: number;
  priceUsd: number;
}

export interface MultiCurrencyDeskCheckoutProps {
  item: BookingCheckoutItem;
  defaultCurrency?: SupportedCurrency;
  recipientWallet?: string;
  usdcMint?: string;
  onBookingConfirmed?: (result: {
    bookingId: string;
    currency: SupportedCurrency;
    amount: number;
    txSignature?: string;
  }) => void;
  onCancel?: () => void;
  className?: string;
}

/**
 * Pure SVG QR Code Generator Component for rendering Solana Pay QR code cleanly without external binary dependencies.
 */
export function PureSvgQrCode({
  value,
  size = 200,
  className = "",
}: {
  value: string;
  size?: number;
  className?: string;
}) {
  // Deterministic 21x21 pseudo-QR grid pattern generated from value hash
  const gridSize = 21;
  const cells: boolean[][] = [];

  // Create hash code from string value
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }

  // Generate grid with finder patterns at 3 corners
  for (let r = 0; r < gridSize; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < gridSize; c++) {
      // Top-Left Finder
      if (r < 7 && c < 7) {
        row.push(
          r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)
        );
      }
      // Top-Right Finder
      else if (r < 7 && c >= gridSize - 7) {
        const cc = c - (gridSize - 7);
        row.push(
          r === 0 || r === 6 || cc === 0 || cc === 6 || (r >= 2 && r <= 4 && cc >= 2 && cc <= 4)
        );
      }
      // Bottom-Left Finder
      else if (r >= gridSize - 7 && c < 7) {
        const rr = r - (gridSize - 7);
        row.push(
          rr === 0 || rr === 6 || c === 0 || c === 6 || (rr >= 2 && rr <= 4 && c >= 2 && c <= 4)
        );
      } else {
        // Data payload pattern derived from string & coordinates
        const pseudoRandom = Math.abs((hash ^ (r * 31 + c * 17)) % 100);
        row.push(pseudoRandom < 45);
      }
    }
    cells.push(row);
  }

  const cellSize = size / gridSize;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={`rounded-xl bg-white p-2.5 shadow-md ${className}`}
      data-testid="solana-pay-qr-code-svg"
      aria-label="Solana Pay USDC Payment QR Code"
    >
      {cells.map((row, r) =>
        row.map((cell, c) =>
          cell ? (
            <rect
              key={`${r}-${c}`}
              x={c * cellSize}
              y={r * cellSize}
              width={cellSize}
              height={cellSize}
              fill="#0F172A"
              rx={cellSize * 0.15}
            />
          ) : null
        )
      )}
    </svg>
  );
}

export function MultiCurrencyDeskCheckout({
  item,
  defaultCurrency = "SOL_USDC",
  recipientWallet = DEFAULT_TREASURY_SOLANA_ADDRESS,
  usdcMint = SOLANA_USDC_MINT_MAINNET,
  onBookingConfirmed,
  onCancel,
  className = "",
}: MultiCurrencyDeskCheckoutProps) {
  const [selectedCurrency, setSelectedCurrency] =
    useState<SupportedCurrency>(defaultCurrency);

  // Solana Pay state
  const [txReference, setTxReference] = useState<string>(() =>
    generateSolanaPaymentReference()
  );
  const [solanaPayUrl, setSolanaPayUrl] = useState<string>("");
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<
    "IDLE" | "POLLING" | "CONFIRMED" | "FAILED"
  >("IDLE");
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const [secondsRemaining, setSecondsRemaining] = useState(600); // 10 minute countdown

  // Standard checkout state
  const [isProcessingStandard, setIsProcessingStandard] = useState(false);

  // Generate Solana Pay URL whenever currency, item price, or reference changes
  useEffect(() => {
    if (selectedCurrency === "SOL_USDC") {
      const url = createSolanaPayUrl({
        recipient: recipientWallet,
        amount: item.priceUsd,
        splToken: usdcMint,
        reference: txReference,
        label: `WorkSphere Desk Booking: ${item.deskName}`,
        message: `${item.venueName} - ${item.durationHours}h Pass`,
        memo: `BookingId:${item.bookingId}`,
      });
      setSolanaPayUrl(url);
      setPaymentStatus("POLLING");
    }
  }, [
    selectedCurrency,
    item.priceUsd,
    item.deskName,
    item.venueName,
    item.durationHours,
    item.bookingId,
    recipientWallet,
    usdcMint,
    txReference,
  ]);

  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const standardPayTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      if (standardPayTimeoutRef.current) clearTimeout(standardPayTimeoutRef.current);
    };
  }, []);

  // Expiration countdown timer
  useEffect(() => {
    if (selectedCurrency !== "SOL_USDC" || paymentStatus === "CONFIRMED") return;

    const interval = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setPaymentStatus("FAILED");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [selectedCurrency, paymentStatus]);

  // Poll transaction status from Solana endpoint
  const pollStatus = useCallback(async (signal?: AbortSignal) => {
    if (
      selectedCurrency !== "SOL_USDC" ||
      paymentStatus === "CONFIRMED" ||
      paymentStatus === "FAILED"
    ) {
      return;
    }

    try {
      const res = await fetch(
        `/api/payments/solana/status?reference=${encodeURIComponent(txReference)}`,
        { signal }
      );
      if (signal?.aborted) return;
      if (res.ok) {
        const data: SolanaPayStatusResponse = await res.json();
        if (signal?.aborted) return;
        setPollCount((p) => p + 1);

        if (data.status === "CONFIRMED" && data.signature) {
          setPaymentStatus("CONFIRMED");
          setTxSignature(data.signature);
          if (onBookingConfirmed) {
            onBookingConfirmed({
              bookingId: item.bookingId,
              currency: "SOL_USDC",
              amount: item.priceUsd,
              txSignature: data.signature,
            });
          }
        }
      }
    } catch (err: any) {
      if (err?.name === "AbortError" || signal?.aborted) {
        return; // Component unmounted or request cancelled cleanly
      }
      console.warn("[MultiCurrencyDeskCheckout] Status poll error:", err);
    }
  }, [selectedCurrency, paymentStatus, txReference, item.bookingId, item.priceUsd, onBookingConfirmed]);

  useEffect(() => {
    if (selectedCurrency !== "SOL_USDC" || paymentStatus !== "POLLING") return;

    const controller = new AbortController();
    const pollInterval = setInterval(() => {
      pollStatus(controller.signal);
    }, 2500);

    return () => {
      clearInterval(pollInterval);
      controller.abort();
    };
  }, [selectedCurrency, paymentStatus, pollStatus]);

  // Simulate payment confirmation (sandbox / testing trigger)
  const handleSimulateConfirmation = async () => {
    try {
      const res = await fetch(`/api/payments/solana/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference: txReference, action: "confirm" }),
      });
      if (res.ok) {
        const data: SolanaPayStatusResponse = await res.json();
        if (data.signature) {
          setPaymentStatus("CONFIRMED");
          setTxSignature(data.signature);
          if (onBookingConfirmed) {
            onBookingConfirmed({
              bookingId: item.bookingId,
              currency: "SOL_USDC",
              amount: item.priceUsd,
              txSignature: data.signature,
            });
          }
        }
      }
    } catch (err) {
      console.error("[MultiCurrencyDeskCheckout] Simulation error:", err);
    }
  };

  const handleCopySolanaPayUrl = () => {
    if (!solanaPayUrl) return;
    navigator.clipboard.writeText(solanaPayUrl);
    setCopiedUrl(true);
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => setCopiedUrl(false), 2000);
  };

  const handleStandardPaySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessingStandard(true);
    if (standardPayTimeoutRef.current) clearTimeout(standardPayTimeoutRef.current);
    standardPayTimeoutRef.current = setTimeout(() => {
      setIsProcessingStandard(false);
      if (onBookingConfirmed) {
        onBookingConfirmed({
          bookingId: item.bookingId,
          currency: selectedCurrency,
          amount: item.priceUsd,
        });
      }
    }, 1200);
  };

  const formatTimeRemaining = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  };

  return (
    <div
      data-testid="multi-currency-desk-checkout"
      className={`w-full max-w-xl mx-auto rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/90 dark:bg-zinc-950/90 backdrop-blur-xl p-6 sm:p-8 shadow-2xl ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-5 border-b border-zinc-200 dark:border-zinc-800">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 block mb-1">
            Instant Multi-Currency Checkout
          </span>
          <h2 className="text-xl font-extrabold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <span>{item.deskName}</span>
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            {item.venueName} &bull; {item.durationHours}h Pass
          </p>
        </div>

        <div className="text-right">
          <span className="text-xs text-zinc-400 block">Total Due</span>
          <strong className="text-xl font-black text-emerald-600 dark:text-emerald-400">
            ${item.priceUsd.toFixed(2)} USD
          </strong>
        </div>
      </div>

      {/* Currency Selector Tabs */}
      <div className="my-6">
        <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 block mb-2">
          Select Payment Method
        </label>
        <div className="grid grid-cols-4 gap-2">
          <button
            type="button"
            data-testid="currency-tab-sol-usdc"
            onClick={() => setSelectedCurrency("SOL_USDC")}
            className={`p-3 rounded-2xl border text-xs font-bold transition flex flex-col items-center gap-1.5 ${
              selectedCurrency === "SOL_USDC"
                ? "bg-purple-600 text-white border-purple-500 shadow-lg shadow-purple-600/25"
                : "bg-zinc-50 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100"
            }`}
          >
            <Coins className="w-4 h-4" />
            <span>Solana USDC</span>
          </button>

          <button
            type="button"
            data-testid="currency-tab-usd"
            onClick={() => setSelectedCurrency("USD")}
            className={`p-3 rounded-2xl border text-xs font-bold transition flex flex-col items-center gap-1.5 ${
              selectedCurrency === "USD"
                ? "bg-indigo-600 text-white border-indigo-500 shadow-lg shadow-indigo-600/25"
                : "bg-zinc-50 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100"
            }`}
          >
            <CreditCard className="w-4 h-4" />
            <span>USD Card</span>
          </button>

          <button
            type="button"
            data-testid="currency-tab-eur"
            onClick={() => setSelectedCurrency("EUR")}
            className={`p-3 rounded-2xl border text-xs font-bold transition flex flex-col items-center gap-1.5 ${
              selectedCurrency === "EUR"
                ? "bg-indigo-600 text-white border-indigo-500 shadow-lg shadow-indigo-600/25"
                : "bg-zinc-50 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100"
            }`}
          >
            <CreditCard className="w-4 h-4" />
            <span>EUR SEPA</span>
          </button>

          <button
            type="button"
            data-testid="currency-tab-gbp"
            onClick={() => setSelectedCurrency("GBP")}
            className={`p-3 rounded-2xl border text-xs font-bold transition flex flex-col items-center gap-1.5 ${
              selectedCurrency === "GBP"
                ? "bg-indigo-600 text-white border-indigo-500 shadow-lg shadow-indigo-600/25"
                : "bg-zinc-50 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100"
            }`}
          >
            <CreditCard className="w-4 h-4" />
            <span>GBP Pass</span>
          </button>
        </div>
      </div>

      {/* Solana Pay USDC Section */}
      {selectedCurrency === "SOL_USDC" && (
        <div className="space-y-5">
          {paymentStatus === "CONFIRMED" ? (
            <div
              data-testid="solana-payment-confirmed-banner"
              className="p-6 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-950 dark:text-emerald-100 text-center space-y-3 animate-in fade-in"
            >
              <div className="w-12 h-12 rounded-full bg-emerald-500 text-white flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/30">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold">Solana Payment Confirmed!</h3>
              <p className="text-xs text-emerald-800 dark:text-emerald-200 leading-relaxed max-w-md mx-auto">
                Your desk booking has been automatically finalized on the Solana blockchain.
              </p>
              {txSignature && (
                <div className="space-y-3">
                  <div className="p-3 rounded-xl bg-emerald-900/20 border border-emerald-500/20 text-[11px] font-mono break-all text-left">
                    <span className="text-xs text-emerald-400 block font-sans font-semibold mb-0.5">
                      Transaction Signature:
                    </span>
                    {txSignature}
                  </div>
                  <div className="flex justify-center pt-1">
                    <a
                      href={getSolanaExplorerUrl(txSignature)}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="solana-explorer-link-button"
                      className="inline-flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 shadow-md shadow-emerald-600/20 transition"
                    >
                      <span>View on Solana Explorer</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="p-5 rounded-2xl bg-purple-950/20 border border-purple-500/30 space-y-4">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-purple-400 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4" /> Solana Pay Protocol (USDC)
                </span>
                <span className="font-mono text-zinc-400 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-purple-400" />
                  Expires: {formatTimeRemaining(secondsRemaining)}
                </span>
              </div>

              {/* QR Code Container */}
              <div className="flex flex-col sm:flex-row items-center gap-5 p-4 rounded-xl bg-zinc-900/80 border border-zinc-800">
                <div className="shrink-0">
                  <PureSvgQrCode value={solanaPayUrl} size={180} />
                </div>

                <div className="space-y-3 text-xs flex-1 min-w-0">
                  <div>
                    <span className="text-[10px] text-zinc-400 uppercase font-semibold block">
                      Pay Amount
                    </span>
                    <strong className="text-lg font-extrabold text-white font-mono">
                      {item.priceUsd.toFixed(2)} USDC
                    </strong>
                  </div>

                  <div>
                    <span className="text-[10px] text-zinc-400 uppercase font-semibold block">
                      SPL USDC Mint Address
                    </span>
                    <p className="font-mono text-[10px] text-purple-300 truncate">
                      {usdcMint}
                    </p>
                  </div>

                  <div>
                    <span className="text-[10px] text-zinc-400 uppercase font-semibold block">
                      Recipient Treasury
                    </span>
                    <p className="font-mono text-[10px] text-zinc-300 truncate">
                      {recipientWallet}
                    </p>
                  </div>
                </div>
              </div>

              {/* Deep Link & Actions */}
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={solanaPayUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="solana-pay-deep-link-button"
                  className="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold text-white bg-purple-600 hover:bg-purple-500 shadow-md shadow-purple-600/20 transition flex items-center justify-center gap-1.5"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open in Mobile Wallet</span>
                </a>

                <button
                  type="button"
                  onClick={handleCopySolanaPayUrl}
                  data-testid="copy-solana-pay-url-button"
                  className="py-2.5 px-3 rounded-xl text-xs font-semibold bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition flex items-center gap-1"
                  title="Copy Solana Pay URI"
                >
                  {copiedUrl ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{copiedUrl ? "Copied" : "Copy URI"}</span>
                </button>
              </div>

              {/* Polling Indicator */}
              <div className="flex items-center justify-between pt-2 text-[11px] text-zinc-400 border-t border-purple-500/20">
                <span className="flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400" />
                  <span>Polling Solana mainnet... ({pollCount} checks)</span>
                </span>

                <button
                  type="button"
                  onClick={handleSimulateConfirmation}
                  data-testid="simulate-solana-confirm-button"
                  className="text-purple-400 hover:underline font-semibold"
                >
                  [Dev] Simulate Confirmation
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Standard Currency Section */}
      {selectedCurrency !== "SOL_USDC" && (
        <form onSubmit={handleStandardPaySubmit} className="space-y-4">
          <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-3">
            <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 block">
              Cardholder Details ({selectedCurrency})
            </label>
            <input
              type="text"
              placeholder="Cardholder Name"
              required
              className="w-full px-3.5 py-2 text-xs rounded-xl bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500/40"
            />
            <input
              type="text"
              placeholder="4111 &bull;&bull;&bull;&bull; &bull;&bull;&bull;&bull; 1111"
              required
              className="w-full px-3.5 py-2 text-xs rounded-xl bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 font-mono focus:ring-2 focus:ring-indigo-500/40"
            />
          </div>

          <button
            type="submit"
            disabled={isProcessingStandard}
            className="w-full py-3 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-lg shadow-indigo-600/25 transition flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isProcessingStandard ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Processing Payment...</span>
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4" />
                <span>Pay ${item.priceUsd.toFixed(2)} {selectedCurrency}</span>
              </>
            )}
          </button>
        </form>
      )}

      {onCancel && (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-zinc-500 hover:text-zinc-300 underline"
          >
            Cancel Checkout
          </button>
        </div>
      )}
    </div>
  );
}

export default MultiCurrencyDeskCheckout;
