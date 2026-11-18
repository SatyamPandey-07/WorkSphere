"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Zap,
  Coins,
  CreditCard,
  QrCode,
  CheckCircle2,
  Copy,
  Check,
  Clock,
  Play,
  Square,
  ShieldCheck,
  TrendingUp,
  Receipt,
  Sparkles,
  Layers,
  ArrowRight,
  AlertCircle,
} from "lucide-react";
import {
  PaymentRail,
  MicroBillingSession,
  PaymentInvoice,
  LIVE_EXCHANGE_RATES,
  MicroPaymentEngine,
} from "@/lib/payments/microPaymentEngine";

/**
 * Validates and initiates a Satoshi payment.
 * Rejects negative, zero, non-finite, and NaN satoshi amounts (requires Math.floor(amountInSats) >= 1).
 */
export function initiateSatoshiPayment(amountInSats: number): boolean {
  if (
    typeof amountInSats !== "number" ||
    !Number.isFinite(amountInSats) ||
    isNaN(amountInSats) ||
    Math.floor(amountInSats) < 1
  ) {
    return false;
  }
  return true;
}

export interface MultiCurrencyMicroCheckoutProps {
  initialHourlyRate?: number;
  initialRail?: PaymentRail;
  initialAdjustmentUsd?: number;
  onPaymentInitiated?: (sats: number) => void;
  className?: string;
}

export function MultiCurrencyDeskCheckout({
  initialHourlyRate = 4.5,
  initialRail = "lightning",
  initialAdjustmentUsd = 0,
  onPaymentInitiated,
  className = "",
}: MultiCurrencyMicroCheckoutProps = {}) {
  const [selectedRail, setSelectedRail] = useState<PaymentRail>(initialRail);
  const [hourlyRate, setHourlyRate] = useState(initialHourlyRate); // $4.50/hr
  const [session, setSession] = useState<MicroBillingSession | null>(null);
  const [activeInvoice, setActiveInvoice] = useState<PaymentInvoice | null>(null);
  const [copied, setCopied] = useState(false);
  const [settledReceipt, setSettledReceipt] = useState<{
    proofHash: string;
    amountPaidUsd: number;
    amountPaidCrypto: string;
    rail: string;
  } | null>(null);

  // Custom gratuity / promotional discount adjustment state
  const [adjustmentInput, setAdjustmentInput] = useState<string>(
    initialAdjustmentUsd !== 0 ? String(initialAdjustmentUsd) : ""
  );
  const [adjustmentUsd, setAdjustmentUsd] = useState<number>(initialAdjustmentUsd);
  const [validationError, setValidationError] = useState<string | null>(null);

  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  // Live session tick
  useEffect(() => {
    if (!session || session.status !== "active") return;

    const interval = setInterval(() => {
      setSession((prev) => (prev ? MicroPaymentEngine.tickSession(prev) : null));
    }, 1000);

    return () => clearInterval(interval);
  }, [session?.status, session?.sessionId]);

  const initiateSatoshiPaymentLocal = (amountInSats: number): boolean => {
    const isValid = initiateSatoshiPayment(amountInSats);
    if (!isValid) {
      setValidationError(
        "Payment amount must be at least 1 Satoshi (cannot be zero, negative, or NaN)."
      );
      return false;
    }
    setValidationError(null);
    if (onPaymentInitiated) {
      onPaymentInitiated(Math.floor(amountInSats));
    }
    return true;
  };

  const handleAdjustmentChange = (valueStr: string) => {
    setAdjustmentInput(valueStr);
    if (valueStr.trim() === "") {
      setAdjustmentUsd(0);
      setValidationError(null);
      return;
    }

    const val = parseFloat(valueStr);
    if (isNaN(val)) {
      setAdjustmentUsd(NaN);
      setValidationError("Invalid discount or tip amount: please enter a valid number.");
      return;
    }

    setAdjustmentUsd(val);
    const netUsd = (session?.totalAccruedUsd ?? 0) + val;
    const netSats = Math.floor(netUsd * LIVE_EXCHANGE_RATES.satsPerUsd);

    if (selectedRail === "lightning") {
      if (netSats < 1 || isNaN(netSats)) {
        setValidationError(
          "Payment amount must be at least 1 Satoshi (cannot be zero, negative, or NaN)."
        );
      } else {
        setValidationError(null);
      }
    } else {
      if (netUsd <= 0) {
        setValidationError("Payment amount must be greater than zero.");
      } else {
        setValidationError(null);
      }
    }
  };

  const startSession = () => {
    const newSession: MicroBillingSession = {
      sessionId: `sess-${Date.now()}`,
      deskId: "desk-sf-14",
      deskName: "Ergonomic Standing Desk #14",
      venueName: "SoMa Focus Hub & Roastery",
      paymentRail: selectedRail,
      status: "active",
      startTime: Date.now(),
      lastHeartbeatTime: Date.now(),
      elapsedSeconds: 0,
      hourlyRateUsd: hourlyRate,
      totalAccruedUsd: 0,
      totalAccruedSats: 0,
      totalAccruedUsdc: 0,
      depositHoldUsd: 10.0,
    };
    setSession(newSession);
    setSettledReceipt(null);
  };

  const endAndSettle = () => {
    if (!session) return;
    const finalSession = MicroPaymentEngine.tickSession(session);
    finalSession.status = "settled";

    const totalToSettleUsd = finalSession.totalAccruedUsd + adjustmentUsd;
    const calculatedSats = Math.floor(totalToSettleUsd * LIVE_EXCHANGE_RATES.satsPerUsd);

    if (selectedRail === "lightning") {
      const isValid = initiateSatoshiPaymentLocal(calculatedSats);
      if (!isValid) {
        // Prevent Lightning invoice generation
        return;
      }
    } else if (totalToSettleUsd <= 0) {
      setValidationError("Total settlement amount must be greater than zero.");
      return;
    }

    const proofHash = MicroPaymentEngine.generatePaymentReceiptHash(
      finalSession.sessionId,
      finalSession.paymentRail,
      totalToSettleUsd
    );
    finalSession.paymentProofHash = proofHash;

    const invoice = MicroPaymentEngine.createMicroInvoice(
      finalSession.sessionId,
      totalToSettleUsd,
      selectedRail
    );

    setActiveInvoice(invoice);
    setSession(finalSession);
    setSettledReceipt({
      proofHash,
      amountPaidUsd: totalToSettleUsd,
      amountPaidCrypto:
        selectedRail === "lightning"
          ? `${calculatedSats.toLocaleString()} Sats`
          : `$${totalToSettleUsd.toFixed(2)} USDC`,
      rail: selectedRail,
    });
  };

  const copyToClipboard = (text: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopied(true);
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
    }
  };

  const formatTimer = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  };

  return (
    <div className="w-full max-w-5xl mx-auto space-y-6 text-slate-100">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-slate-900/80 backdrop-blur-md rounded-2xl border border-slate-800 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-yellow-500/10 text-yellow-400 rounded-xl border border-yellow-500/20 shadow-sm">
            <Zap className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              Multi-Currency Micro-Payments
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-300 font-mono">
                LIGHTNING & USDC
              </span>
            </h2>
            <p className="text-sm text-slate-400">
              Pay-as-you-go per-minute desk metering with streaming micro-settlement
            </p>
          </div>
        </div>

        {/* Live Exchange Rate Pill */}
        <div className="flex items-center gap-2 bg-slate-800/80 px-3.5 py-2 rounded-xl border border-slate-700/60 text-xs font-mono">
          <span className="text-slate-400">1 USD =</span>
          <span className="text-yellow-400 font-bold">{LIVE_EXCHANGE_RATES.satsPerUsd} Sats</span>
          <span className="text-slate-500">|</span>
          <span className="text-cyan-400 font-bold">1.00 USDC</span>
        </div>
      </div>

      {/* Payment Rail Selector */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            rail: "lightning" as PaymentRail,
            label: "Bitcoin Lightning",
            sub: "Instant BOLT11 / WebLN",
            icon: <Zap className="w-4 h-4 text-yellow-400" />,
          },
          {
            rail: "usdc_base" as PaymentRail,
            label: "USDC (Base L2)",
            sub: "Low-fee EVM transfer",
            icon: <Coins className="w-4 h-4 text-blue-400" />,
          },
          {
            rail: "usdc_solana" as PaymentRail,
            label: "USDC (Solana)",
            sub: "Sub-second SPL micropay",
            icon: <Sparkles className="w-4 h-4 text-purple-400" />,
          },
          {
            rail: "fiat_stripe" as PaymentRail,
            label: "Credit Card / Apple Pay",
            sub: "Standard fiat processing",
            icon: <CreditCard className="w-4 h-4 text-emerald-400" />,
          },
        ].map((item) => (
          <button
            key={item.rail}
            onClick={() => setSelectedRail(item.rail)}
            className={`p-4 rounded-xl border text-left transition-all ${
              selectedRail === item.rail
                ? "bg-slate-800/90 border-yellow-500/60 shadow-lg shadow-yellow-950/20"
                : "bg-slate-900/60 border-slate-800 hover:border-slate-700"
            }`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-bold text-white text-xs">{item.label}</span>
              {item.icon}
            </div>
            <p className="text-[11px] text-slate-400">{item.sub}</p>
          </button>
        ))}
      </div>

      {/* Main Streaming Meter Card */}
      <div className="p-8 bg-gradient-to-b from-slate-900/90 to-slate-950/90 backdrop-blur-md rounded-2xl border border-slate-800 shadow-xl space-y-6 text-center">
        <div className="space-y-1">
          <span className="text-xs uppercase tracking-widest text-slate-400 font-mono">
            Active Desk Micro-Meter
          </span>
          <h3 className="text-2xl font-bold text-white">Ergonomic Standing Desk #14</h3>
          <p className="text-xs text-slate-400">
            Rate: ${hourlyRate.toFixed(2)}/hr (${(hourlyRate / 60).toFixed(4)}/min • ~
            {Math.ceil((hourlyRate / 60) * LIVE_EXCHANGE_RATES.satsPerUsd)} Sats/min)
          </p>
        </div>

        {/* Big Counter Display */}
        <div className="py-6 flex flex-col items-center justify-center space-y-2">
          <div className="text-5xl sm:text-6xl font-black font-mono tracking-tight text-white">
            {session ? formatTimer(session.elapsedSeconds) : "00:00:00"}
          </div>

          <div className="flex items-center gap-3 pt-2">
            <span className="text-2xl sm:text-3xl font-bold font-mono text-yellow-400">
              ${session ? (session.totalAccruedUsd + adjustmentUsd).toFixed(4) : adjustmentUsd.toFixed(4)} USD
            </span>
            <span className="text-slate-500 font-mono">≈</span>
            <span className="text-lg sm:text-xl font-bold font-mono text-cyan-400">
              {session
                ? Math.floor((session.totalAccruedUsd + adjustmentUsd) * LIVE_EXCHANGE_RATES.satsPerUsd).toLocaleString()
                : Math.floor(adjustmentUsd * LIVE_EXCHANGE_RATES.satsPerUsd).toLocaleString()}{" "}
              Sats
            </span>
          </div>
        </div>

        {/* Custom Gratuity / Promo Discount Adjustment */}
        <div className="max-w-xs mx-auto text-left space-y-1.5">
          <label
            htmlFor="custom-adjustment-input"
            className="text-xs font-semibold text-slate-300 block"
          >
            Custom Gratuity / Promo Discount ($)
          </label>
          <div className="relative">
            <input
              id="custom-adjustment-input"
              data-testid="custom-adjustment-input"
              type="number"
              step="0.01"
              value={adjustmentInput}
              onChange={(e) => handleAdjustmentChange(e.target.value)}
              placeholder="e.g. 1.00 or -5.00"
              className="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-950 border border-slate-700 text-white font-mono focus:ring-2 focus:ring-yellow-500/40"
            />
          </div>
        </div>

        {/* Validation Warning Alert */}
        {validationError && (
          <div
            data-testid="satoshi-validation-error"
            role="alert"
            className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center justify-center gap-2 max-w-md mx-auto"
          >
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{validationError}</span>
          </div>
        )}

        {/* Action Controls */}
        <div className="flex justify-center items-center gap-4">
          {!session || session.status === "settled" ? (
            <button
              onClick={startSession}
              data-testid="start-session-button"
              disabled={Boolean(validationError)}
              className="px-8 py-3.5 bg-gradient-to-r from-yellow-500 to-amber-600 hover:from-yellow-400 hover:to-amber-500 text-slate-950 font-black text-sm rounded-xl transition-all shadow-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Play className="w-5 h-5 fill-slate-950" /> Start Streaming Desk Session
            </button>
          ) : (
            <button
              onClick={endAndSettle}
              data-testid="settle-payment-button"
              disabled={Boolean(
                validationError ||
                (selectedRail === "lightning" &&
                  Math.floor((session.totalAccruedUsd + adjustmentUsd) * LIVE_EXCHANGE_RATES.satsPerUsd) < 1) ||
                session.totalAccruedUsd + adjustmentUsd <= 0
              )}
              className={`px-8 py-3.5 bg-rose-600 hover:bg-rose-500 text-white font-black text-sm rounded-xl transition-all shadow-lg flex items-center gap-2 ${
                validationError ||
                (selectedRail === "lightning" &&
                  Math.floor((session.totalAccruedUsd + adjustmentUsd) * LIVE_EXCHANGE_RATES.satsPerUsd) < 1) ||
                session.totalAccruedUsd + adjustmentUsd <= 0
                  ? "opacity-50 cursor-not-allowed"
                  : "animate-pulse"
              }`}
            >
              <Square className="w-4 h-4 fill-white" /> End Session & Settle Payment
            </button>
          )}
        </div>
      </div>

      {/* Invoice & Settlement Receipt Section */}
      {activeInvoice && settledReceipt && (
        <div className="p-6 bg-slate-900/90 backdrop-blur-md rounded-2xl border border-yellow-500/40 space-y-6 shadow-2xl animate-fadeIn">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <h4 className="font-bold text-white text-base">Payment Receipt & Cryptographic Proof</h4>
            </div>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono">
              SETTLED
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
            {/* Payment Details */}
            <div className="space-y-3 text-xs">
              <div className="p-3.5 bg-slate-800/60 rounded-xl border border-slate-700/50 space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-400">Total Billed:</span>
                  <span className="font-mono font-bold text-white">
                    ${settledReceipt.amountPaidUsd.toFixed(2)} USD
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Crypto Amount:</span>
                  <span className="font-mono font-bold text-yellow-400">
                    {settledReceipt.amountPaidCrypto}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Payment Rail:</span>
                  <span className="font-mono text-cyan-300 uppercase">
                    {settledReceipt.rail.replace("_", " ")}
                  </span>
                </div>
              </div>

              {/* Proof Hash */}
              <div className="space-y-1">
                <label className="text-[11px] text-slate-400 block font-mono">
                  Settlement Preimage / Proof Hash:
                </label>
                <div className="p-2.5 bg-black/50 border border-slate-800 rounded-xl font-mono text-[11px] text-emerald-400 break-all select-all flex items-center justify-between">
                  <span>{settledReceipt.proofHash}</span>
                  <button
                    onClick={() => copyToClipboard(settledReceipt.proofHash)}
                    className="p-1 hover:text-white text-slate-400 ml-2"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>

            {/* QR Code Pass */}
            <div className="flex flex-col items-center justify-center p-4 bg-slate-800/50 rounded-xl border border-slate-700/50 space-y-3">
              <div className="p-3 bg-white rounded-xl text-slate-900 shadow-md">
                <QrCode className="w-28 h-28" />
              </div>
              <p className="text-[11px] text-slate-400 text-center">
                Scan with your WebLN, Alby, Phantom, or MetaMask wallet to verify on-chain settlement.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MultiCurrencyDeskCheckout;
