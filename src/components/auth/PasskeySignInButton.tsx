"use client";

import { useState, useEffect, useRef } from "react";
import {
  browserSupportsWebAuthn,
  startAuthentication,
  WebAuthnAbortService,
} from "@simplewebauthn/browser";
import { Fingerprint, Loader2, AlertCircle } from "lucide-react";
import { useCsrfToken } from "@/hooks/useCsrfToken";

export interface PasskeySignInButtonProps {
  /**
   * If true (default), automatically attempts WebAuthn conditional mediation
   * when supported and an input with autocomplete$='webauthn' is present in the DOM.
   */
  conditional?: boolean;
}

/**
 * Checks whether the current browser supports WebAuthn conditional mediation (passkey autofill).
 */
export async function isConditionalMediationSupported(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!browserSupportsWebAuthn()) return false;
  if (
    typeof window.PublicKeyCredential === "undefined" ||
    typeof window.PublicKeyCredential.isConditionalMediationAvailable !== "function"
  ) {
    return false;
  }
  try {
    return await window.PublicKeyCredential.isConditionalMediationAvailable();
  } catch {
    return false;
  }
}

async function fetchAuthOptions() {
  const optRes = await fetch("/api/auth/passkey/authenticate/options");
  if (!optRes.ok) {
    throw new Error("Failed to get passkey authentication options.");
  }
  return await optRes.json();
}

async function verifyAuthResponse(authenticationResponse: unknown) {
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
    // Hard navigation (not router.push) so the browser picks up the
    // freshly issued session cookie before the next page renders.
    if (resData.signInUrl) {
      window.location.href = resData.signInUrl;
    } else {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/";
    }
  }

  return resData;
}

export function PasskeySignInButton({
  conditional = true,
}: PasskeySignInButtonProps = {}) {
  useCsrfToken();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(false);
  const isAuthenticatingRef = useRef(false);

  useEffect(() => {
    setIsSupported(browserSupportsWebAuthn());
  }, []);

  // Conditional UI: automatically start WebAuthn autofill flow when mounted and supported
  useEffect(() => {
    if (!conditional) return;

    let isMounted = true;
    let timerId: ReturnType<typeof setTimeout> | null = null;

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

        // startAuthentication delegates to navigator.credentials.get with mediation: "conditional"
        // for Safari iOS 16+ and Android Chrome autofill integration
        const authenticationResponse = await startAuthentication({
          optionsJSON,
          useBrowserAutofill: true,
        });

        if (!isMounted || isAuthenticatingRef.current) return;
        isAuthenticatingRef.current = true;

        await verifyAuthResponse(authenticationResponse);
      } catch (err: unknown) {
        // Conditional UI errors (cancellation, AbortSignal abort, or no passkeys) must be silently
        // ignored so manual email/password login is completely uninterrupted.
        if (
          err instanceof Error &&
          (err.name === "AbortError" || err.name === "NotAllowedError")
        ) {
          console.debug("Passkey conditional autofill dismissed or aborted:", err.name);
          return;
        }
        console.debug("Passkey conditional UI dismissed or skipped:", err);
      }
    }

    initConditionalUI();

    return () => {
      isMounted = false;
      if (timerId) {
        clearTimeout(timerId);
      }
      WebAuthnAbortService.cancelCeremony();
    };
  }, [conditional]);

  const handlePasskeySignIn = async () => {
    try {
      setLoading(true);
      setError(null);
      isAuthenticatingRef.current = true;

      // Abort any active conditional request before starting explicit assertion
      WebAuthnAbortService.cancelCeremony();

      // 1. Fetch auth options from server
      const optionsJSON = await fetchAuthOptions();

      // 2. Prompt browser WebAuthn assertion (modal/explicit)
      const authenticationResponse = await startAuthentication({
        optionsJSON,
        useBrowserAutofill: false,
      });

      // 3. Verify assertion on server
      await verifyAuthResponse(authenticationResponse);
    } catch (err: unknown) {
      console.error("Passkey sign-in error:", err);
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

      setError(message);
    } finally {
      setLoading(false);
    }
  };

  if (!isSupported) return null;

  return (
    <div className="w-full space-y-2">
      <button
        onClick={handlePasskeySignIn}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl border border-zinc-700 bg-zinc-800/80 hover:bg-zinc-700/80 text-white font-medium text-sm transition-all shadow-md disabled:opacity-50"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
        ) : (
          <Fingerprint className="h-5 w-5 text-blue-400" />
        )}
        <span>Sign in with Passkey / Biometrics</span>
      </button>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
