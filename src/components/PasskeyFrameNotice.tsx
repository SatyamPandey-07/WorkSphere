"use client";

import { useEffect, useState } from "react";
import { ShieldAlert, X } from "lucide-react";
import {
  getFrameWebAuthnStatus,
  installWebAuthnFrameGuard,
} from "@/lib/webauthn-frame";

/**
 * Shows a small dismissible notice when WorkSphere is embedded in a
 * cross-origin iframe and passkey (WebAuthn) sign-in is unlikely to work.
 * Also installs a guard that catches the resulting browser SecurityError so
 * it never bubbles up as an unhandled rejection / confusing crash, and turns
 * it into the same friendly message if the user tries anyway.
 */
export function PasskeyFrameNotice() {
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const status = getFrameWebAuthnStatus();
    if (status.shouldBlockPasskeys) {
      setVisible(true);
    }

    const cleanup = installWebAuthnFrameGuard(() => setVisible(true));
    return cleanup;
  }, []);

  if (!visible || dismissed) return null;

  return (
    <div
      role="status"
      className="mb-4 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
    >
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="flex-1">
        Passkey sign-in isn&apos;t available in this embedded view. Open
        WorkSphere in its own tab to use a passkey, or sign in with email
        instead.
      </p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="shrink-0 text-amber-300/70 hover:text-amber-200"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}