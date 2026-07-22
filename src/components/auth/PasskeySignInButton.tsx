"use client";

import { useState, useEffect } from "react";
import {
  browserSupportsWebAuthn,
  startAuthentication,
} from "@simplewebauthn/browser";
import { Fingerprint, Loader2, AlertCircle } from "lucide-react";
import { useCsrfToken } from "@/hooks/useCsrfToken";

export function PasskeySignInButton() {
  useCsrfToken();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    setIsSupported(browserSupportsWebAuthn());
  }, []);

  const handlePasskeySignIn = async () => {
    try {
      setLoading(true);
      setError(null);

      // 1. Fetch auth options from server
      const optRes = await fetch("/api/auth/passkey/authenticate/options");
      if (!optRes.ok) {
        throw new Error("Failed to get passkey authentication options.");
      }
      const optionsJSON = await optRes.json();

      // 2. Prompt browser WebAuthn assertion
      const authenticationResponse = await startAuthentication({ optionsJSON });

      // 3. Verify assertion on server
      const verifyRes = await fetch("/api/auth/passkey/authenticate/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authenticationResponse }),
      });

      if (!verifyRes.ok) {
        const errData = await verifyRes.json();
        throw new Error(errData.error || "Passkey authentication failed.");
      }

      const resData = await verifyRes.json();

      if (resData.verified) {
        if (resData.signInUrl) {
          window.location.href = resData.signInUrl;
        } else {
          // Redirect to homepage/dashboard on successful authentication
          window.location.href = "/";
        }
      }
    } catch (err: unknown) {
      console.error("Passkey sign-in error:", err);
      const message =
        err instanceof Error ? err.message : "Passkey authentication failed.";
      if (!message.includes("cancelled") && !message.includes("abort")) {
        setError(message);
      }
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
