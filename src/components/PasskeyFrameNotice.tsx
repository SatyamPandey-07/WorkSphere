"use client";

import { useEffect, useState, useRef, type ReactNode } from "react";
import { ShieldAlert, X } from "lucide-react";
import {
  getFrameWebAuthnStatus,
  installWebAuthnFrameGuard,
} from "@/lib/auth/passkeys/client";

export interface PasskeyFrameNoticeProps {
  /** Optional custom CSS classes for the notice banner */
  className?: string;
  /** Optional custom message text or ReactNode override */
  message?: ReactNode;
  /** Optional callback fired when user dismisses the notice */
  onDismiss?: () => void;
  /** Force the notice to display regardless of iframe detection (useful for testing/previews) */
  forceVisible?: boolean;
  /** Optional data-testid override for testing */
  testId?: string;
}

/**
 * Shows a small dismissible notice when WorkSphere is embedded in a
 * cross-origin iframe and passkey (WebAuthn) sign-in is unlikely to work.
 * Also installs a guard that catches the resulting browser SecurityError so
 * it never bubbles up as an unhandled rejection / confusing crash, and turns
 * it into the same friendly message if the user tries anyway.
 */
export function PasskeyFrameNotice({
  className = "",
  message,
  onDismiss,
  forceVisible = false,
  testId = "passkey-frame-notice",
}: PasskeyFrameNoticeProps = {}) {
  const [visible, setVisible] = useState(forceVisible);
  const [dismissed, setDismissed] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    if (forceVisible) {
      setVisible(true);
    } else {
      const status = getFrameWebAuthnStatus();
      if (status?.shouldBlockPasskeys && isMountedRef.current) {
        setVisible(true);
      }
    }

    const cleanup = installWebAuthnFrameGuard(() => {
      if (isMountedRef.current) {
        setVisible(true);
      }
    });

    return () => {
      isMountedRef.current = false;
      if (cleanup) cleanup();
    };
  }, [forceVisible]);

  if (!visible || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  const defaultMessage = (
    <>
      Passkey sign-in isn&apos;t available in this embedded view. Open
      WorkSphere in its own tab to use a passkey, or sign in with email
      instead.
    </>
  );

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={testId}
      className={`mb-4 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 ${className}`.trim()}
    >
      <ShieldAlert
        className="mt-0.5 h-4 w-4 shrink-0"
        data-testid="passkey-frame-notice-icon"
      />
      <p
        className="flex-1"
        data-testid="passkey-frame-notice-message"
      >
        {message || defaultMessage}
      </p>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss passkey embedding notice"
        data-testid="passkey-frame-notice-dismiss"
        className="shrink-0 text-amber-300/70 hover:text-amber-200 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500/50 rounded-lg p-0.5"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export default PasskeyFrameNotice;
