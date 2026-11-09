"use client";

import React, { useMemo } from "react";
import { AlertCircle, ShieldCheck, X } from "lucide-react";
import { FocusTrap } from "@/components/ui/FocusTrap";
import { CopyToClipboardButton } from "@/components/ui/CopyToClipboardButton";
import { generateQRMatrix } from "@/lib/qr/svgQr";
import { matrixToSvgPath } from "@/lib/qr/matrixPath";
import {
  buildOtpauthUri,
  formatSecretForDisplay,
  normalizeTotpSecret,
} from "@/lib/auth/totp";
import { isModalBackdropClick } from "@/lib/modal-interactions";

/** Blank border around the code, in modules (the QR specification asks for 4). */
const QUIET_ZONE_MODULES = 4;
const DEFAULT_ISSUER = "WorkSphere";

export interface TotpSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Base32 TOTP secret created by the server for this user. */
  secret: string;
  /** Account label shown in the authenticator app, usually the user's email. */
  accountName: string;
  /** One-time recovery codes created by the server. */
  recoveryCodes?: readonly string[];
  issuer?: string;
  /** Whether clicking on the backdrop closes the modal (default: true). */
  closeOnBackdropClick?: boolean;
}

/**
 * Two-factor setup dialog: a scalable SVG QR code for authenticator apps, the
 * setup key with a one-click copy button as a fallback, and a grid of recovery
 * codes. It only displays values it is given; the secret and recovery codes
 * must be generated and stored on the server.
 */
export function TotpSetupModal({
  isOpen,
  onClose,
  secret,
  accountName,
  recoveryCodes = [],
  issuer = DEFAULT_ISSUER,
  closeOnBackdropClick = true,
}: TotpSetupModalProps) {
  const normalizedSecret = useMemo(() => normalizeTotpSecret(secret), [secret]);

  const qr = useMemo(() => {
    if (!isOpen || !normalizedSecret) return null;
    const uri = buildOtpauthUri({
      issuer,
      account: accountName,
      secret: normalizedSecret,
    });
    if (!uri) return null;
    try {
      const matrix = generateQRMatrix(uri);
      return {
        size: matrix.length + QUIET_ZONE_MODULES * 2,
        path: matrixToSvgPath(matrix),
      };
    } catch {
      // The encoder rejects data it cannot fit; the setup key still works.
      return null;
    }
  }, [isOpen, normalizedSecret, issuer, accountName]);

  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!closeOnBackdropClick) return;
    if (isModalBackdropClick(e)) {
      onClose();
    }
  };

  return (
    <div
      data-testid="totp-setup-overlay"
      onClick={handleBackdropClick}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    >
      <FocusTrap
        data-testid="totp-setup-modal"
        className="max-h-[90vh] w-full max-w-md space-y-5 overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-6 text-slate-100 shadow-2xl"
        aria-labelledby="totp-setup-title"
        aria-describedby="totp-setup-description"
        initialFocusSelector="[data-initial-focus]"
        onEscape={onClose}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck
              className="h-5 w-5 text-emerald-400"
              aria-hidden="true"
            />
            <h2
              id="totp-setup-title"
              data-testid="totp-setup-title"
              className="text-lg font-bold text-white"
            >
              Set up two-factor authentication
            </h2>
          </div>
          <button
            type="button"
            data-testid="totp-setup-close-btn"
            data-initial-focus
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <p
          id="totp-setup-description"
          data-testid="totp-setup-description"
          className="text-sm text-slate-300"
        >
          Scan the QR code with an authenticator app such as Google
          Authenticator or 1Password. If you cannot scan it, enter the setup key
          manually.
        </p>

        {!normalizedSecret ? (
          <p
            role="alert"
            data-testid="totp-secret-error-alert"
            className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200"
          >
            <AlertCircle
              className="mt-0.5 h-4 w-4 shrink-0"
              aria-hidden="true"
            />
            <span>
              The setup key is invalid, so two-factor setup cannot continue.
              Please close this dialog and try again.
            </span>
          </p>
        ) : (
          <>
            <div className="flex justify-center" data-testid="totp-qr-container">
              {qr ? (
                <svg
                  role="img"
                  data-testid="totp-qr-svg"
                  aria-label="QR code for authenticator app setup"
                  viewBox={`0 0 ${qr.size} ${qr.size}`}
                  shapeRendering="crispEdges"
                  className="h-48 w-48 rounded-lg"
                >
                  <rect width={qr.size} height={qr.size} fill="#ffffff" />
                  <path
                    d={qr.path}
                    fill="#000000"
                    transform={`translate(${QUIET_ZONE_MODULES} ${QUIET_ZONE_MODULES})`}
                  />
                </svg>
              ) : (
                <p
                  data-testid="totp-qr-unavailable-msg"
                  className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-center text-sm text-amber-200"
                >
                  The QR code is unavailable. Enter the setup key below in your
                  authenticator app instead.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <span className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                Setup key
              </span>
              <code
                data-testid="totp-secret"
                className="block select-all break-all rounded-xl border border-slate-700 bg-slate-950 p-3 text-center font-mono text-base tracking-widest text-emerald-300"
              >
                {formatSecretForDisplay(normalizedSecret)}
              </code>
              <div className="flex justify-center">
                <CopyToClipboardButton
                  textToCopy={normalizedSecret}
                  label="Copy Secret Key"
                  ariaLabel="Copy Secret Key"
                  toastMessage="Secret key copied!"
                />
              </div>
            </div>

            {recoveryCodes.length > 0 && (
              <div className="space-y-2" data-testid="totp-recovery-section">
                <span className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Recovery codes
                </span>
                <p className="text-xs text-slate-400">
                  Store these somewhere safe. Each code can be used once if you
                  lose access to your authenticator app.
                </p>
                <ul
                  aria-label="Recovery codes"
                  data-testid="totp-recovery-codes-list"
                  className="grid grid-cols-2 gap-2"
                >
                  {recoveryCodes.map((code) => (
                    <li
                      key={code}
                      data-testid="totp-recovery-code-item"
                      className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-center font-mono text-sm tracking-wider text-slate-200"
                    >
                      {code}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        <div className="flex justify-end border-t border-slate-800 pt-4">
          <button
            type="button"
            data-testid="totp-setup-done-btn"
            onClick={onClose}
            className="rounded-xl bg-slate-700 px-5 py-2 text-sm font-bold text-white hover:bg-slate-600"
          >
            Done
          </button>
        </div>
      </FocusTrap>
    </div>
  );
}

export default TotpSetupModal;
