"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
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
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const isSubmittingRef = useRef(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  const startCooldown = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    setSecondsLeft(cooldownSeconds);
    intervalRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          setStatus("idle");
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  };

  const handleResend = async () => {
    if (isLoading || isSubmittingRef.current || secondsLeft > 0) {
      return;
    }

    isSubmittingRef.current = true;
    setIsLoading(true);
    setStatus("loading");
    setErrorMsg(null);

    try {
      // Always fetch a fresh CSRF token before the resend POST
      const csrfToken = await refreshCsrfToken();

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
        const data = await res.json().catch(() => ({}));
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
    } finally {
      isSubmittingRef.current = false;
      setIsLoading(false);
    }
  };

  const isDisabled = isLoading || status === "loading" || secondsLeft > 0;

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        data-testid="resend-otp-button"
        onClick={handleResend}
        disabled={isDisabled}
        aria-busy={isLoading}
        aria-disabled={isDisabled}
        className={className}
      >
        {isLoading || status === "loading" ? (
          <span
            className="inline-flex items-center justify-center gap-1.5"
            data-testid="resend-otp-loading"
          >
            <Loader2
              data-testid="resend-otp-spinner"
              className="w-4 h-4 animate-spin shrink-0"
              aria-hidden="true"
            />
            <span>Sending…</span>
          </span>
        ) : secondsLeft > 0 ? (
          `Resend in ${secondsLeft}s`
        ) : (
          "Resend Verification Code"
        )}
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
