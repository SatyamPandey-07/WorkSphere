"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Loader2, Mail, X } from "lucide-react";

export type PasskeyOtpAction = "rotate" | "rename" | "revoke";

const RESEND_COOLDOWN_SECONDS = 30;

const ACTION_COPY: Record<PasskeyOtpAction, { title: string; submit: string }> = {
  rotate: { title: "Rotate passkey", submit: "Verify & rotate" },
  rename: { title: "Rename passkey", submit: "Verify & rename" },
  revoke: { title: "Remove passkey", submit: "Verify & remove" },
};

interface PasskeyOtpDialogProps {
  action: PasskeyOtpAction;
  credentialId: string;
  passkeyName: string;
  onCancel: () => void;
  /** Perform the action with the verified code. Throw to show an error. */
  onSubmit: (code: string) => Promise<void>;
}

/**
 * Email OTP step-up dialog for sensitive passkey actions (#1991).
 * Sends a code on open, then hands the entered code to `onSubmit`.
 */
export function PasskeyOtpDialog({
  action,
  credentialId,
  passkeyName,
  onCancel,
  onSubmit,
}: PasskeyOtpDialogProps) {
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const sendCode = useCallback(async () => {
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/passkey/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, credentialId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 429 && typeof data.retryAfter === "number") {
          setCooldown(Math.min(data.retryAfter, 3600));
        }
        throw new Error(data.error || "Failed to send verification code.");
      }
      setSentTo(data.sentTo ?? null);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      inputRef.current?.focus();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to send verification code.");
    } finally {
      setSending(false);
    }
  }, [action, credentialId]);

  useEffect(() => {
    void sendCode();
  }, [sendCode]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, submitting]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(code);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const copy = ACTION_COPY[action];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-sm rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 id={titleId} className="text-lg font-semibold text-zinc-900 dark:text-white">
              {copy.title}
            </h3>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">{passkeyName}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            aria-label="Cancel"
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 flex items-start gap-2 text-sm text-zinc-600 dark:text-zinc-300">
          <Mail className="h-4 w-4 mt-0.5 shrink-0 text-blue-600 dark:text-blue-400" />
          <span aria-live="polite">
            {sending && !sentTo
              ? "Sending a verification code to your email…"
              : sentTo
                ? `Enter the 6-digit code we sent to ${sentTo}.`
                : "Request a verification code to continue."}
          </span>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <label htmlFor={`${titleId}-code`} className="sr-only">
            Verification code
          </label>
          <input
            id={`${titleId}-code`}
            ref={inputRef}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="••••••"
            className="w-full px-3.5 py-2.5 text-center text-xl tracking-[0.5em] font-mono rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          />

          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          {action === "rotate" && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              After verifying, your browser will ask you to create the replacement
              passkey. The old one is removed only once the new one is saved.
            </p>
          )}

          <button
            type="submit"
            disabled={code.length !== 6 || submitting}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-medium text-sm disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {copy.submit}
          </button>

          <button
            type="button"
            onClick={() => void sendCode()}
            disabled={sending || cooldown > 0 || submitting}
            className="w-full text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:text-zinc-400 disabled:no-underline"
          >
            {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
          </button>
        </form>
      </div>
    </div>
  );
}
