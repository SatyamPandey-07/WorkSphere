"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { proveAndRequestPremiumAccess } from "@/lib/zkp/client";

type Props = {
  venueId: string;
  venueName: string;
};

export default function PremiumZkpGate({ venueId, venueName }: Props) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [allowed, setAllowed] = useState(false);

  async function onProve() {
    setBusy(true);
    setMsg(null);
    try {
      const result = await proveAndRequestPremiumAccess({
        identityToken: token.trim(),
        venueId,
      });
      if (result.allowed) {
        setAllowed(true);
        setMsg(`Verified in ${result.proveMs}ms. Access granted to ${venueName}.`);
        setToken("");
      } else {
        setMsg(result.error ?? "Access denied.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-bold">
        <ShieldCheck className="h-4 w-4 text-blue-600" />
        Premium access (zero-knowledge)
      </div>
      <p className="text-xs text-zinc-500">
        Prove membership without sending your identity token to the server.
      </p>

      {allowed ? (
        <p className="text-sm font-medium text-green-600 dark:text-green-400">
          {msg}
        </p>
      ) : (
        <>
          <input
            type="password"
            inputMode="numeric"
            placeholder="Membership token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={busy || !token.trim()}
            onClick={() => void onProve()}
            className="w-full rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-black uppercase tracking-widest py-3"
          >
            {busy ? "Proving…" : "Prove & unlock"}
          </button>
          {msg && <p className="text-xs text-rose-500">{msg}</p>}
        </>
      )}
    </div>
  );
}
