"use client";

import { useState, useRef, useCallback } from "react";
import { ShieldCheck, Loader2, Copy, Check } from "lucide-react";
import { provePremiumAccess, type ZkpProgressStage } from "@/lib/zkp/client";

type Props = {
  venueId: string;
  venueName: string;
};

export default function PremiumZkpGate({ venueId, venueName }: Props) {
  const [token, setToken] = useState("");
  const [stage, setStage] = useState<"idle" | "proving" | "verifying" | "done">(
    "idle",
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

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
        setStage("done");
        setAccessToken(result.accessToken ?? null);
        setMsg(
          `Verified in ${result.proveMs}ms. Access granted to ${venueName}.`,
        );
        setToken("");
      } else {
        setStage("idle");
        setMsg(result.error ?? "Access denied.");
      }
    } finally {
      abortRef.current = null;
    }
  }

  function onCancel() {
    abortRef.current?.abort();
    setStage("idle");
  }

  async function copyToken() {
    if (!accessToken) return;
    try {
      await navigator.clipboard.writeText(accessToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available or permission denied
    }
  }

  const busy = stage === "proving" || stage === "verifying";

  return (
    <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-bold">
        <ShieldCheck className="h-4 w-4 text-blue-600" />
        Premium access (zero-knowledge)
      </div>
      <p className="text-xs text-zinc-500">
        Prove membership without sending your identity token to the server.
      </p>

      {stage === "done" && accessToken ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-green-600 dark:text-green-400">
            {msg}
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg bg-green-50 dark:bg-green-900/20 px-3 py-2 text-xs font-mono text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800">
              {accessToken}
            </code>
            <button
              type="button"
              onClick={copyToken}
              className="shrink-0 rounded-lg bg-green-600 hover:bg-green-700 text-white p-2"
              title="Copy access token"
            >
              {copied ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      ) : (
        <>
          <input
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
              type="button"
              disabled={busy || !token.trim()}
              onClick={() => void onProve()}
              className="flex-1 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-black uppercase tracking-widest py-3 flex items-center justify-center gap-2"
            >
              {busy ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {stage === "proving" ? "Proving…" : "Verifying…"}
                </>
              ) : (
                "Prove & unlock"
              )}
            </button>
            {busy && (
              <button
                type="button"
                onClick={onCancel}
                className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 text-xs font-medium px-4 py-3"
              >
                Cancel
              </button>
            )}
          </div>
          {msg && <p className="text-xs text-rose-500">{msg}</p>}
        </>
      )}
    </div>
  );
}
