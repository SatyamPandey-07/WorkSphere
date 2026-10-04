"use client";

import { useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import {
  ShieldAlert,
  Fingerprint,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  X,
  ShieldCheck,
  HardDrive,
} from "lucide-react";

export interface StepUpReAuthModalProps {
  isOpen: boolean;
  action: string;
  actionTitle?: string;
  actionDescription?: string;
  onSuccess: (stepUpToken: string, backupHealth?: string) => void;
  onCancel: () => void;
}

export function StepUpReAuthModal({
  isOpen,
  action,
  actionTitle = "Security Step-Up Verification",
  actionDescription = "This action requires biometric re-authentication with your registered Passkey to protect your account.",
  onSuccess,
  onCancel,
}: StepUpReAuthModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepUpComplete, setStepUpComplete] = useState(false);
  const [backupInfo, setBackupInfo] = useState<{
    backupHealth: string;
    description: string;
    isSynced: boolean;
  } | null>(null);

  if (!isOpen) return null;

  const handleStartStepUp = async () => {
    try {
      setLoading(true);
      setError(null);

      // 1. Fetch step-up authentication options from the server
      const optRes = await fetch(
        `/api/auth/passkey/step-up/options?action=${encodeURIComponent(action)}`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        },
      );

      if (!optRes.ok) {
        const errData = await optRes.json().catch(() => ({}));
        throw new Error(
          errData.error || "Failed to initiate step-up authentication.",
        );
      }

      const { options } = await optRes.json();

      // 2. Prompt browser WebAuthn authenticator with user verification required
      const authenticationResponse = await startAuthentication({
        optionsJSON: options,
      });

      // 3. Verify step-up assertion on server
      const verifyRes = await fetch("/api/auth/passkey/step-up/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authenticationResponse,
          action,
        }),
      });

      if (!verifyRes.ok) {
        const errData = await verifyRes.json().catch(() => ({}));
        throw new Error(
          errData.error || "Step-up re-authentication verification failed.",
        );
      }

      const result = await verifyRes.json();
      setStepUpComplete(true);
      if (result.backupStatus) {
        setBackupInfo(result.backupStatus);
      }

      // Allow user to see the verification success briefly before resolving
      setTimeout(() => {
        onSuccess(result.stepUpToken, result.backupStatus?.backupHealth);
      }, 750);
    } catch (err: unknown) {
      console.error("Step-up authentication error:", err);
      const msg =
        err instanceof Error
          ? err.message
          : "Biometric step-up re-authentication failed.";
      if (msg.includes("cancelled") || msg.includes("abort")) {
        setError("Re-authentication was cancelled.");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-md rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-2xl">
        <button
          onClick={onCancel}
          disabled={loading}
          className="absolute top-4 right-4 p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          aria-label="Close dialog"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-zinc-900 dark:text-white">
              {actionTitle}
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Protected Action: <span className="font-mono">{action}</span>
            </p>
          </div>
        </div>

        <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
          {actionDescription}
        </p>

        {error && (
          <div className="mt-4 p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 flex items-start gap-2.5 text-xs">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span className="leading-snug">{error}</span>
          </div>
        )}

        {stepUpComplete && (
          <div className="mt-4 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>Identity Verified Successfully</span>
            </div>
            {backupInfo && (
              <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 p-2 rounded-lg">
                {backupInfo.isSynced ? (
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <HardDrive className="h-3.5 w-3.5 shrink-0" />
                )}
                <span>{backupInfo.description}</span>
              </div>
            )}
          </div>
        )}

        <div className="mt-6 flex flex-col gap-2.5">
          {!stepUpComplete && (
            <button
              onClick={handleStartStepUp}
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-medium text-sm shadow-md transition-all disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Prompting Biometric Sensor...</span>
                </>
              ) : (
                <>
                  <Fingerprint className="h-4 w-4" />
                  <span>Verify with Passkey (Touch ID / Face ID)</span>
                </>
              )}
            </button>
          )}

          <button
            onClick={onCancel}
            disabled={loading}
            className="w-full px-4 py-2 text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
