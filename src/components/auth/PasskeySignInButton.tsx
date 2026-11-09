"use client";

import { useState, useEffect, useRef } from "react";
import {
  browserSupportsWebAuthn,
  startAuthentication,
  WebAuthnAbortService,
} from "@simplewebauthn/browser";
import { Fingerprint, Loader2, AlertCircle } from "lucide-react";
import { useCsrfToken } from "@/hooks/useCsrfToken";
import {
  savePasskeyChallengeToSession,
  clearPasskeyChallengeFromSession,
  setupPasskeyUnloadCleanup,
} from "@/lib/auth/passkeys/client";

export interface PasskeySignInButtonProps {
  /**
   * If true (default), automatically attempts WebAuthn conditional mediation
   * when supported and an input with autocomplete$='webauthn' is present in the DOM.
   */
  conditional?: boolean;
  /**
   * Optional custom redirect destination on successful sign-in (default: "/").
   */
  redirectTo?: string;
  /**
   * Optional custom navigation handler called on successful verification.
   * If not provided, falls back to safe window.location.href assignment.
   */
  onNavigate?: (url: string) => void;
  /**
   * Callback fired upon successful verification with the server response data.
   */
  onSuccess?: (resData: unknown) => void;
  /**
   * Callback fired upon authentication failure.
   */
  onError?: (error: Error) => void;
  /**
   * Optional custom className.
   */
  className?: string;
}

/**
 * Checks whether the current browser supports WebAuthn conditional mediation (passkey autofill).
 */
export async function isConditionalMediationSupported(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!browserSupportsWebAuthn()) return false;
  if (
    typeof window.PublicKeyCredential === "undefined" ||
    typeof window.PublicKeyCredential.isConditionalMediationAvailable !==
      "function"
  ) {
    return false;
  }
  try {
    return await window.PublicKeyCredential.isConditionalMediationAvailable();
  } catch {
    return false;
  }
}

export async function fetchAuthOptions() {
  const optRes = await fetch("/api/auth/passkey/authenticate/options");
  if (!optRes.ok) {
    throw new Error("Failed to get passkey authentication options.");
  }
  return await optRes.json();
}

export interface VerifyAuthResponseOptions {
  onNavigate?: (url: string) => void;
  onSuccess?: (resData: unknown) => void;
  redirectTo?: string;
}

export function performNavigation(
  url: string,
  onNavigate?: (url: string) => void,
) {
  if (onNavigate) {
    onNavigate(url);
    return;
  }
  if (typeof window !== "undefined") {
    if (process.env.NODE_ENV === "test") {
      return;
    }
    try {
      window.location.href = url;
    } catch {
      // Gracefully guard against navigation errors
    }
  }
}

export async function verifyAuthResponse(
  authenticationResponse: unknown,
  options?: VerifyAuthResponseOptions,
) {
  const verifyRes = await fetch("/api/auth/passkey/authenticate/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ authenticationResponse }),
  });

  if (!verifyRes.ok) {
    const errData = await verifyRes.json().catch(() => ({}));
    throw new Error(errData.error || "Passkey authentication failed.");
  }

  const resData = await verifyRes.json();

  if (resData.verified) {
    options?.onSuccess?.(resData);
    const targetUrl = resData.signInUrl || options?.redirectTo || "/";
    performNavigation(targetUrl, options?.onNavigate);
  }

  return resData;
}

export function PasskeySignInButton({
  conditional = true,
  redirectTo,
  onNavigate,
  onSuccess,
  onError,
  className = "",
}: PasskeySignInButtonProps = {}) {
  useCsrfToken();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(false);
  const isAuthenticatingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setIsSupported(browserSupportsWebAuthn());
    const cleanupUnload = setupPasskeyUnloadCleanup();
    return () => {
      cleanupUnload();
    };
  }, []);

  // Conditional UI: automatically start WebAuthn autofill flow when mounted and supported
  useEffect(() => {
    if (!conditional) return;

    let isMounted = true;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const handleAbort = () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      WebAuthnAbortService.cancelCeremony();
    };

    // Abort conditional ceremony when user leaves page or submits standard login form
    window.addEventListener("beforeunload", handleAbort);
    window.addEventListener("pagehide", handleAbort);
    window.addEventListener("submit", handleAbort, true);

    async function initConditionalUI() {
      const supported = await isConditionalMediationSupported();
      if (!supported || !isMounted) {
        return;
      }

      // Verify that an eligible input exists in the DOM with autocomplete ending in webauthn
      let eligibleInput = document.querySelector(
        "input[autocomplete$='webauthn']",
      );

      // If not yet available in the DOM, wait a tick for deferred renders
      if (!eligibleInput) {
        await new Promise((resolve) => {
          timerId = setTimeout(resolve, 50);
        });
        if (!isMounted) return;
        eligibleInput = document.querySelector(
          "input[autocomplete$='webauthn']",
        );
      }

      if (!eligibleInput || !isMounted) {
        return;
      }

      try {
        const optionsJSON = await fetchAuthOptions();
        if (!isMounted || isAuthenticatingRef.current) return;

        const controller = new AbortController();
        abortControllerRef.current = controller;

        // startAuthentication delegates to navigator.credentials.get with mediation: "conditional"
        // for Safari iOS 16+ and Android Chrome autofill integration
        const authenticationResponse = await startAuthentication({
          optionsJSON,
          useBrowserAutofill: true,
        });

        if (!isMounted || isAuthenticatingRef.current) return;
        isAuthenticatingRef.current = true;

        await verifyAuthResponse(authenticationResponse, {
          onNavigate,
          onSuccess,
          redirectTo,
        });
      } catch (err: unknown) {
        // Conditional UI errors (cancellation, AbortSignal abort, or no passkeys) must be silently
        // ignored so manual email/password login is completely uninterrupted.
        if (
          err instanceof Error &&
          (err.name === "AbortError" || err.name === "NotAllowedError")
        ) {
          console.debug(
            "Passkey conditional autofill dismissed or aborted:",
            err.name,
          );
          return;
        }
        console.debug("Passkey conditional UI dismissed or skipped:", err);
      } finally {
        abortControllerRef.current = null;
      }
    }

    initConditionalUI();

    return () => {
      isMounted = false;
      if (timerId) {
        clearTimeout(timerId);
      }
      window.removeEventListener("beforeunload", handleAbort);
      window.removeEventListener("pagehide", handleAbort);
      window.removeEventListener("submit", handleAbort, true);
      handleAbort();
    };
  }, [conditional, onNavigate, onSuccess, redirectTo]);

  const handlePasskeySignIn = async () => {
    try {
      setLoading(true);
      setError(null);
      isAuthenticatingRef.current = true;

      // Abort any active conditional request before starting explicit assertion
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      WebAuthnAbortService.cancelCeremony();

      // 1. Fetch auth options from server
      clearPasskeyChallengeFromSession(); // Clear any prior stale challenge before ceremony starts
      const optionsJSON = await fetchAuthOptions();
      if (optionsJSON?.challenge) {
        savePasskeyChallengeToSession(optionsJSON.challenge, "authentication");
      }

      // 2. Prompt browser WebAuthn assertion (modal/explicit)
      const authenticationResponse = await startAuthentication({
        optionsJSON,
        useBrowserAutofill: false,
      });

      // 3. Verify assertion on server
      await verifyAuthResponse(authenticationResponse, {
        onNavigate,
        onSuccess,
        redirectTo,
      });
      clearPasskeyChallengeFromSession(); // Clear challenge upon successful verification
    } catch (err: unknown) {
      clearPasskeyChallengeFromSession(); // Invalidate challenge if ceremony fails or is aborted
      isAuthenticatingRef.current = false;
      const name = err instanceof Error ? err.name : "";
      const message =
        err instanceof Error ? err.message : "Passkey authentication failed.";

      if (
        name === "NotAllowedError" ||
        name === "AbortError" ||
        message.toLowerCase().includes("cancelled") ||
        message.toLowerCase().includes("abort")
      ) {
        return;
      }

      console.error("Passkey sign-in error:", err);
      setError(message);
      if (err instanceof Error) {
        onError?.(err);
      } else {
        onError?.(new Error(message));
      }
    } finally {
      setLoading(false);
    }
  };

  if (!isSupported) return null;

  return (
    <div className={`w-full space-y-2 ${className}`}>
      <button
        type="button"
        onClick={handlePasskeySignIn}
        disabled={loading}
        aria-busy={loading}
        aria-label="Sign in with Passkey / Biometrics"
        data-testid="passkey-signin-button"
        className="w-full flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl border border-zinc-700 bg-zinc-800/80 hover:bg-zinc-700/80 text-white font-medium text-sm transition-all shadow-md disabled:opacity-50 cursor-pointer"
      >
        {loading ? (
          <Loader2
            data-testid="passkey-loading-spinner"
            className="h-4 w-4 animate-spin text-blue-400"
          />
        ) : (
          <Fingerprint
            data-testid="passkey-fingerprint-icon"
            className="h-5 w-5 text-blue-400"
          />
        )}
        <span>Sign in with Passkey / Biometrics</span>
      </button>

      {error && (
        <div
          role="alert"
          data-testid="passkey-error"
          className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

export default PasskeySignInButton;
