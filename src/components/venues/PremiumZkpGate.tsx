"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { ShieldCheck, Loader2, Copy, Check } from "lucide-react";
import { provePremiumAccess, type ZkpProgressStage } from "@/lib/zkp/client";
import { cn } from "@/lib/utils";

export interface PremiumZkpGateProps {
  venueId: string;
  venueName: string;
  className?: string;
  onSuccess?: (accessToken: string) => void;
  onError?: (error: string) => void;
}

export function PremiumZkpGate({
  venueId,
  venueName,
  className,
  onSuccess,
  onError,
}: PremiumZkpGateProps) {
  const [token, setToken] = useState("");
  const [stage, setStage] = useState<"idle" | "proving" | "verifying" | "done">(
    "idle",
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const copyTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const onProgress = useCallback((s: ZkpProgressStage) => {
    setStage(s === "generating" ? "proving" : "verifying");
  }, []);

  async function onProve() {
    if (!token.trim()) return;
    setStage("proving");
    setMsg(null);
    setAccessToken(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = await provePremiumAccess({
        identityToken: token.trim(),
        venueId,
        onProgress,
        signal: controller.signal,
      });

      if (result.allowed) {
        const key = result.accessToken ?? "";
        setStage("done");
        setAccessToken(key || null);
        const successMsg = `Verified in ${result.proveMs}ms. Access granted to ${venueName}.`;
        setMsg(successMsg);
        setToken("");
        onSuccess?.(key);
      } else {
        const errorMsg = result.error ?? "Access denied.";
        setStage("idle");
        setMsg(errorMsg);
        onError?.(errorMsg);
      }
    } catch (err: unknown) {
      if (controller.signal.aborted) {
        setStage("idle");
        return;
      }
      const errorMsg =
        err instanceof Error ? err.message : "Failed to prove membership.";
      setStage("idle");
      setMsg(errorMsg);
      onError?.(errorMsg);
    } finally {
      abortRef.current = null;
    }
  }

  function onCancel() {
    abortRef.current?.abort();
    setStage("idle");
  }

  const copyToken = () => {
    if (!accessToken) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(accessToken).catch(() => {
          // Clipboard API write rejected
        });
      }
    } catch {
      // Clipboard API not available or permission denied
    }
    setCopied(true);
    if (copyTimerRef.current) {
      clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
  };

  const busy = stage === "proving" || stage === "verifying";

  return (
    <div
      data-testid="premium-zkp-gate"
      className={cn(
        "rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 p-4 space-y-3",
        className
      )}
    >
      <div className="flex items-center gap-2 text-sm font-bold">
        <ShieldCheck className="h-4 w-4 text-blue-600" />
        Premium access (zero-knowledge)
      </div>
      <p className="text-xs text-zinc-500">
        Prove membership without sending your identity token to the server.
      </p>

      {stage === "done" && accessToken ? (
        <div
          data-testid="premium-zkp-success-banner"
          className="space-y-2"
        >
          <p className="text-sm font-medium text-green-600 dark:text-green-400">
            {msg}
          </p>
          <div className="flex items-center gap-2">
            <code
              data-testid="premium-zkp-access-token"
              className="flex-1 truncate rounded-lg bg-green-50 dark:bg-green-900/20 px-3 py-2 text-xs font-mono text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800"
            >
              {accessToken}
            </code>
            <button
              type="button"
              data-testid="premium-zkp-copy-btn"
              onClick={copyToken}
              className="shrink-0 rounded-lg bg-green-600 hover:bg-green-700 text-white p-2"
              title="Copy access token"
              aria-label="Copy access token"
            >
              {copied ? (
                <Check
                  data-testid="premium-zkp-copied-icon"
                  className="h-4 w-4"
                />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      ) : (
        <>
          <input
            data-testid="premium-zkp-token-input"
            type="password"
            inputMode="numeric"
            placeholder="Membership token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            disabled={busy}
            className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm disabled:opacity-50"
          />
          <div className="flex gap-2">
            <button
              data-testid="premium-zkp-prove-btn"
              type="button"
              disabled={busy || !token.trim()}
              onClick={() => void onProve()}
              className="flex-1 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-black uppercase tracking-widest py-3 flex items-center justify-center gap-2"
            >
              {busy ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>{stage === "proving" ? "Proving…" : "Verifying…"}</span>
                </>
              ) : (
                "Prove & unlock"
              )}
            </button>
            {busy && (
              <button
                data-testid="premium-zkp-cancel-btn"
                type="button"
                onClick={onCancel}
                className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 text-xs font-medium px-4 py-3"
              >
                Cancel
              </button>
            )}
          </div>
          {msg && (
            <p
              data-testid="premium-zkp-error-msg"
              className="text-xs text-rose-500"
            >
              {msg}
            </p>
          )}
        </>
      )}
    </div>
  );
}

export default PremiumZkpGate;
