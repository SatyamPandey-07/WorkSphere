"use client";

import { useState } from "react";
import { refreshCsrfToken } from "@/hooks/useCsrfToken";
import { CSRF_HEADER_NAME } from "@/lib/csrf";

interface ResendOtpButtonProps {
  email?: string;
  /** Cooldown in seconds before the button re-enables. Defaults to 60. */
  cooldownSeconds?: number;
  className?: string;
}

export function ResendOtpButton({
  email,
  cooldownSeconds = 60,
  className,
}: ResendOtpButtonProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "error">(
    "idle",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const startCooldown = () => {
    setSecondsLeft(cooldownSeconds);
    const interval = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(interval);
          setStatus("idle");
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  };

  const handleResend = async () => {
    setStatus("loading");
    setErrorMsg(null);

    // Always fetch a fresh CSRF token before the resend POST — this is what
    // the issue explicitly requires: explicitly refresh via the CSRF endpoint
    // before dispatching the resend request, on all platforms.
    const csrfToken = await refreshCsrfToken();

    try {
      const res = await fetch("/api/auth/resend-otp", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { [CSRF_HEADER_NAME]: csrfToken } : {}),
        },
        body: JSON.stringify({ email }),
      });

      if (res.status === 429) {
        const data = await res.json();
        setErrorMsg(data.error ?? "Too many requests. Please wait.");
        setStatus("error");
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorMsg(data.error ?? "Failed to resend code. Please try again.");
        setStatus("error");
        return;
      }

      setStatus("sent");
      startCooldown();
    } catch {
      setErrorMsg("Network error. Please check your connection and try again.");
      setStatus("error");
    }
  };

  const isDisabled = status === "loading" || secondsLeft > 0;

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={handleResend}
        disabled={isDisabled}
        className={className}
      >
        {status === "loading"
          ? "Sending…"
          : secondsLeft > 0
            ? `Resend in ${secondsLeft}s`
            : "Resend Verification Code"}
      </button>
      {status === "sent" && (
        <p className="text-sm text-green-500">A new code has been sent.</p>
      )}
      {status === "error" && errorMsg && (
        <p className="text-sm text-red-500">{errorMsg}</p>
      )}
    </div>
  );
}
