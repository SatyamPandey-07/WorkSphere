"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Fingerprint,
  Mail,
  AlertTriangle,
  Loader2,
  Lock,
  ArrowRight,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import {
  performWebAuthnStepUp,
  requestStepUpEmailOtp,
  verifyStepUpEmailOtp,
  isWebAuthnSupported,
  isPlatformAuthenticatorAvailable,
  type StepUpAction,
  type StepUpAuthResult,
} from "@/lib/auth/webauthnPasskey";

export interface SolanaPayButtonProps {
  amount: number;
  recipient?: string;
  currency?: "SOL" | "USDC";
  action?: StepUpAction;
  onSuccess: (result: { stepUpToken?: string; transactionConfirmed: boolean }) => void;
  onError?: (error: Error) => void;
  onCancel?: () => void;
  /**
   * Threshold above which step-up authentication is mandatory.
   * Defaults to 1.0 (SOL or equivalent).
   */
  highValueThreshold?: number;
  disabled?: boolean;
  className?: string;
  label?: string;
}

export type AuthStage =
  | "idle"
  | "checking_requirements"
  | "prompt_passkey"
  | "verifying_passkey"
  | "otp_fallback_requesting"
  | "otp_fallback_input"
  | "verifying_otp"
  | "authenticated"
  | "error";

export function SolanaPayButton({
  amount,
  recipient,
  currency = "SOL",
  action = "wallet_transfer",
  onSuccess,
  onError,
  onCancel,
  highValueThreshold = 1.0,
  disabled = false,
  className = "",
  label = "Confirm Payment",
}: SolanaPayButtonProps) {
  const [stage, setStage] = useState<AuthStage>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState<string>("");
  const [maskedEmail, setMaskedEmail] = useState<string>("");
  const [_stepUpToken, setStepUpToken] = useState<string | null>(null);
  const [hasWebAuthnSupport, setHasWebAuthnSupport] = useState<boolean>(true);
  const [isPlatformAuthAvailable, setIsPlatformAuthAvailable] = useState<boolean>(true);

  // Check whether this specific operation mandates step-up authentication
  const isHighValue = amount >= highValueThreshold;
  const isProtectedAction = action === "escrow_settle" || action === "refund" || isHighValue;

  useEffect(() => {
    const supported = isWebAuthnSupported();
    setHasWebAuthnSupport(supported);
    if (supported) {
      isPlatformAuthenticatorAvailable().then(setIsPlatformAuthAvailable);
    } else {
      setIsPlatformAuthAvailable(false);
    }
  }, []);

  const handleRequestOtpFallback = useCallback(async () => {
    setErrorMessage(null);
    setStage("otp_fallback_requesting");

    const res = await requestStepUpEmailOtp({
      action,
      amount,
      recipient,
    });

    if (res.success) {
      setMaskedEmail(res.maskedEmail || "your registered email");
      setStage("otp_fallback_input");
    } else {
      setErrorMessage(res.error || "Failed to request email verification code.");
      setStage("error");
      if (onError) {
        onError(new Error(res.error || "OTP request failed"));
      }
    }
  }, [action, amount, recipient, onError]);

  const handleStartStepUp = useCallback(async () => {
    setErrorMessage(null);

    // If not a protected high-value transaction, bypass step-up directly
    if (!isProtectedAction) {
      setStage("authenticated");
      onSuccess({ transactionConfirmed: true });
      return;
    }

    setStage("prompt_passkey");

    // If WebAuthn is completely unsupported, transition directly to email OTP fallback
    if (!hasWebAuthnSupport || !isPlatformAuthAvailable) {
      handleRequestOtpFallback();
      return;
    }

    setStage("verifying_passkey");
    const result: StepUpAuthResult = await performWebAuthnStepUp({
      action,
      amount,
      recipient,
      currency,
    });

    if (result.success && result.stepUpToken) {
      setStepUpToken(result.stepUpToken);
      setStage("authenticated");
      onSuccess({
        stepUpToken: result.stepUpToken,
        transactionConfirmed: true,
      });
    } else {
      // If user cancelled, rejected, or unsupported, provide explicit OTP fallback option
      setErrorMessage(result.error || "Authentication was not completed.");
      setStage("error");
    }
  }, [
    isProtectedAction,
    hasWebAuthnSupport,
    isPlatformAuthAvailable,
    handleRequestOtpFallback,
    action,
    amount,
    recipient,
    currency,
    onSuccess,
  ]);

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode.trim()) return;

    setErrorMessage(null);
    setStage("verifying_otp");

    const result = await verifyStepUpEmailOtp({
      code: otpCode.trim(),
      action,
      amount,
      recipient,
    });

    if (result.success && result.stepUpToken) {
      setStepUpToken(result.stepUpToken);
      setStage("authenticated");
      onSuccess({
        stepUpToken: result.stepUpToken,
        transactionConfirmed: true,
      });
    } else {
      setErrorMessage(result.error || "Invalid verification code.");
      setStage("otp_fallback_input");
      if (onError) {
        onError(new Error(result.error || "OTP verification failed"));
      }
    }
  };

  const handleResetOrCancel = () => {
    setStage("idle");
    setErrorMessage(null);
    setOtpCode("");
    if (onCancel) onCancel();
  };

  return (
    <div className={`solana-pay-button-container ${className}`}>
      {/* Idle / Standard Confirmation State */}
      {stage === "idle" && (
        <button
          type="button"
          onClick={handleStartStepUp}
          disabled={disabled}
          className="flex items-center justify-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold rounded-lg shadow-md transition-all duration-200"
        >
          {isProtectedAction ? <Lock className="w-4 h-4 text-amber-300" /> : null}
          <span>{label}</span>
          <ArrowRight className="w-4 h-4 ml-1" />
        </button>
      )}

      {/* Prompting / Verifying Passkey State */}
      {(stage === "prompt_passkey" || stage === "verifying_passkey") && (
        <div className="p-4 bg-slate-900 border border-indigo-500/30 rounded-xl max-w-sm text-center shadow-lg text-white">
          <div className="flex justify-center mb-3">
            <div className="p-3 bg-indigo-500/20 rounded-full animate-pulse">
              <Fingerprint className="w-8 h-8 text-indigo-400" />
            </div>
          </div>
          <h4 className="text-base font-semibold text-slate-100">Step-Up Authentication</h4>
          <p className="text-xs text-slate-400 mt-1 mb-4">
            High-value transfer of {amount} {currency}. Please confirm your identity using Touch ID,
            Face ID, or your security key.
          </p>
          <div className="flex items-center justify-center gap-2 text-sm text-indigo-300 mb-4">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Waiting for authenticator...</span>
          </div>
          <button
            type="button"
            onClick={handleRequestOtpFallback}
            className="text-xs text-indigo-400 hover:text-indigo-300 underline block mx-auto mb-2"
          >
            Use Email OTP instead
          </button>
          <button
            type="button"
            onClick={handleResetOrCancel}
            className="text-xs text-slate-500 hover:text-slate-400 block mx-auto"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Requesting OTP State */}
      {stage === "otp_fallback_requesting" && (
        <div className="p-4 bg-slate-900 border border-slate-700 rounded-xl max-w-sm text-center shadow-lg text-white">
          <Loader2 className="w-6 h-6 animate-spin mx-auto text-indigo-400 mb-2" />
          <p className="text-sm font-medium">Sending email verification code...</p>
        </div>
      )}

      {/* OTP Input Form State */}
      {(stage === "otp_fallback_input" || stage === "verifying_otp") && (
        <div className="p-4 bg-slate-900 border border-slate-700 rounded-xl max-w-sm text-center shadow-lg text-white">
          <div className="flex justify-center mb-2">
            <Mail className="w-7 h-7 text-indigo-400" />
          </div>
          <h4 className="text-base font-semibold text-slate-100">Email Verification</h4>
          <p className="text-xs text-slate-400 mt-1 mb-3">
            Enter the 6-digit code sent to <span className="text-indigo-300">{maskedEmail}</span>.
          </p>

          <form onSubmit={handleVerifyOtp} className="space-y-3">
            <input
              type="text"
              pattern="[0-9]*"
              inputMode="numeric"
              maxLength={6}
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              aria-label="Verification Code"
              className="w-full text-center tracking-widest text-lg font-mono px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-indigo-500"
              autoFocus
            />

            {errorMessage && (
              <p className="text-xs text-rose-400 flex items-center justify-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>{errorMessage}</span>
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleResetOrCancel}
                className="w-1/2 py-2 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={otpCode.length < 6 || stage === "verifying_otp"}
                className="w-1/2 py-2 text-xs bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-lg flex items-center justify-center gap-1.5"
              >
                {stage === "verifying_otp" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <span>Verify Code</span>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Authenticated / Success State */}
      {stage === "authenticated" && (
        <div className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-lg text-sm">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>Step-up authentication verified!</span>
        </div>
      )}

      {/* Error / Fallback State */}
      {stage === "error" && (
        <div className="p-4 bg-slate-900 border border-rose-500/30 rounded-xl max-w-sm text-center shadow-lg text-white">
          <div className="flex justify-center mb-2">
            <XCircle className="w-7 h-7 text-rose-400" />
          </div>
          <h4 className="text-base font-semibold text-rose-300">Authentication Failed</h4>
          <p className="text-xs text-slate-300 mt-1 mb-4">{errorMessage}</p>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleRequestOtpFallback}
              className="py-2 text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg"
            >
              Verify with Email OTP Instead
            </button>
            <button
              type="button"
              onClick={handleResetOrCancel}
              className="py-2 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-lg"
            >
              Cancel Transaction
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
