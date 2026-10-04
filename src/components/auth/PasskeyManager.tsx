"use client";

import { useState, useEffect, useCallback } from "react";
import {
  browserSupportsWebAuthn,
  startRegistration,
} from "@simplewebauthn/browser";
import {
  KeyRound,
  Fingerprint,
  Smartphone,
  Laptop,
  Trash2,
  Edit3,
  ShieldCheck,
  Plus,
  Loader2,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Clock,
  Copy,
  Shield,
  HardDrive,
} from "lucide-react";
import { useCsrfToken } from "@/hooks/useCsrfToken";
import {
  PasskeyOtpDialog,
  type PasskeyOtpAction,
} from "@/components/auth/PasskeyOtpDialog";
import { StepUpReAuthModal } from "@/components/auth/StepUpReAuthModal";

export interface PasskeyItem {
  id: string;
  credentialId: string;
  name: string;
  deviceType: string;
  backedUp: boolean;
  transports: string[];
  attestationFormat?: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
}

export interface RotationStatus {
  credentialId: string;
  name: string;
  expiresAt: string;
  isExpired: boolean;
  daysUntilExpiry: number;
  needsRotation: boolean;
  lastUsedAt: string;
  createdAt: string;
}

interface PendingAction {
  action: PasskeyOtpAction;
  id: string;
  name: string;
  /** New name, for rename */
  newName?: string;
}

async function errorFrom(res: Response, fallback: string): Promise<Error> {
  const data = await res.json().catch(() => ({}));
  return new Error(data.error || fallback);
}

export function PasskeyManager() {
  useCsrfToken();
  const [passkeys, setPasskeys] = useState<PasskeyItem[]>([]);
  const [rotationStatuses, setRotationStatuses] = useState<RotationStatus[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [cleaningUp, setCleaningUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isWebAuthnSupported, setIsWebAuthnSupported] = useState(false);
  const [customName, setCustomName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [showStepUpModal, setShowStepUpModal] = useState(false);
  const [stepUpAction, setStepUpAction] = useState("passkey_management");
  const [stepUpVerifiedToken, setStepUpVerifiedToken] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopyId = async (credentialId: string) => {
    try {
      await navigator.clipboard.writeText(credentialId);
      setCopiedId(credentialId);
      setSuccess("Credential ID copied to clipboard");
      setTimeout(() => {
        setCopiedId(null);
        setSuccess(null);
      }, 3000);
    } catch {
      setError("Failed to copy credential ID");
      setTimeout(() => setError(null), 3000);
    }
  };

  useEffect(() => {
    setIsWebAuthnSupported(browserSupportsWebAuthn());
  }, []);

  const fetchPasskeys = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [credRes, rotRes] = await Promise.all([
        fetch("/api/auth/passkey/credentials"),
        fetch("/api/auth/passkey/rotation"),
      ]);

      if (!credRes.ok) throw new Error("Failed to load passkeys");
      const credData = await credRes.json();
      setPasskeys(credData.credentials || []);

      if (rotRes.ok) {
        const rotData = await rotRes.json();
        setRotationStatuses(rotData.credentials || []);
      }
    } catch (err: unknown) {
      console.error(err);
      setError("Could not load your registered passkeys.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPasskeys();
  }, [fetchPasskeys]);

  const handleAddPasskey = async () => {
    if (!isWebAuthnSupported) {
      setError(
        "WebAuthn biometric passkeys are not supported by this browser.",
      );
      return;
    }

    try {
      setRegistering(true);
      setError(null);
      setSuccess(null);

      // 1. Fetch registration options from server
      const optRes = await fetch("/api/auth/passkey/register/options");
      if (!optRes.ok) {
        const errData = await optRes.json();
        throw new Error(
          errData.error || "Failed to initiate passkey registration.",
        );
      }
      const optionsJSON = await optRes.json();

      // 2. Trigger browser WebAuthn prompt
      const registrationResponse = await startRegistration({ optionsJSON });

      // 3. Send response to server for verification
      const verifyRes = await fetch("/api/auth/passkey/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          registrationResponse,
          name: customName.trim() || undefined,
        }),
      });

      if (!verifyRes.ok) {
        const errData = await verifyRes.json();
        throw new Error(errData.error || "Passkey verification failed.");
      }

      setSuccess("Passkey successfully registered and synced!");
      setCustomName("");
      await fetchPasskeys();
    } catch (err: unknown) {
      console.error("Registration error:", err);
      const message =
        err instanceof Error ? err.message : "Passkey registration failed.";
      if (message.includes("cancelled") || message.includes("abort")) {
        setError("Passkey registration was cancelled.");
      } else {
        setError(message);
      }
    } finally {
      setRegistering(false);
    }
  };

  const handleRename = (pk: PasskeyItem) => {
    const newName = editName.trim();
    if (!newName || newName === pk.name) {
      setEditingId(null);
      return;
    }
    setPending({ action: "rename", id: pk.id, name: pk.name, newName });
  };

  const handleDelete = (pk: PasskeyItem) => {
    if (!confirm("Are you sure you want to remove this passkey credential?"))
      return;
    setPending({ action: "revoke", id: pk.id, name: pk.name });
  };

  const handleRotate = (pk: PasskeyItem) => {
    if (!isWebAuthnSupported) {
      setError("WebAuthn biometric passkeys are not supported by this browser.");
      return;
    }
    setPending({ action: "rotate", id: pk.id, name: pk.name });
  };

  /** Runs the pending action once the user has entered their email OTP (#1991). */
  const performVerifiedAction = async (otp: string) => {
    if (!pending) return;
    const { action, id, newName } = pending;

    if (action === "rename") {
      const res = await fetch(`/api/auth/passkey/credentials/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName, otp }),
      });
      if (!res.ok) throw await errorFrom(res, "Failed to rename passkey.");
      setEditingId(null);
      setEditName("");
      setSuccess("Passkey renamed.");
    } else if (action === "revoke") {
      const res = await fetch(`/api/auth/passkey/credentials/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otp }),
      });
      if (!res.ok) throw await errorFrom(res, "Failed to remove passkey.");
      setSuccess("Passkey removed.");
    } else {
      const optRes = await fetch(
        `/api/auth/passkey/register/options?rotate=${encodeURIComponent(id)}`,
      );
      if (!optRes.ok) throw await errorFrom(optRes, "Failed to start rotation.");
      const optionsJSON = await optRes.json();

      let registrationResponse;
      try {
        registrationResponse = await startRegistration({ optionsJSON });
      } catch {
        // The code is still valid — the user can retry without a new email.
        throw new Error(
          "Passkey creation was cancelled. Submit again to retry with the same code.",
        );
      }

      const res = await fetch("/api/auth/passkey/rotation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "rotate",
          credentialId: id,
          otp,
          registrationResponse,
        }),
      });
      if (!res.ok) throw await errorFrom(res, "Failed to rotate passkey.");
      setSuccess("Passkey rotated. The old credential has been revoked.");
    }

    setPending(null);
    setError(null);
    await fetchPasskeys();
  };

  const handleCleanupExpired = async () => {
    try {
      setCleaningUp(true);
      setError(null);
      const res = await fetch("/api/auth/passkey/rotation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cleanup" }),
      });
      if (!res.ok) throw new Error("Failed to cleanup expired passkeys");
      const data = await res.json();
      setSuccess(
        data.deletedCount > 0
          ? `Removed ${data.deletedCount} expired passkey(s).`
          : "No expired passkeys found.",
      );
      await fetchPasskeys();
    } catch (err: unknown) {
      console.error(err);
      setError("Failed to cleanup expired passkeys.");
    } finally {
      setCleaningUp(false);
    }
  };

  const getRotationInfo = (credentialId: string) =>
    rotationStatuses.find((r) => r.credentialId === credentialId);

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-6 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-zinc-200 dark:border-zinc-800">
        <div>
          <div className="flex items-center gap-2">
            <Fingerprint className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            <h2 className="text-xl font-bold text-zinc-900 dark:text-white">
              Biometric Passkeys & WebAuthn
            </h2>
          </div>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Sign in securely using Touch ID, Face ID, Windows Hello, or hardware
            security keys.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isWebAuthnSupported && (
            <>
              <button
                onClick={() => {
                  setStepUpAction("passkey_management");
                  setShowStepUpModal(true);
                }}
                className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-750 text-zinc-800 dark:text-zinc-200 font-medium text-sm transition-all shrink-0"
                title="Perform biometric step-up re-authentication"
              >
                <Shield className="h-4 w-4 text-blue-500" />
                Step-Up Verify
              </button>

              <button
                onClick={handleAddPasskey}
                disabled={registering}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-medium text-sm shadow-md transition-all disabled:opacity-50 shrink-0"
              >
                {registering ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Add New Passkey
              </button>
            </>
          )}
        </div>
      </div>

      {!isWebAuthnSupported && (
        <div className="mt-4 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center gap-3 text-sm">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>
            WebAuthn is not enabled or supported in your current browser
            environment.
          </span>
        </div>
      )}

      {error && (
        <div className="mt-4 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 flex items-center gap-3 text-sm">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="mt-4 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center gap-3 text-sm">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {/* Optional custom label input */}
      <div className="mt-4 flex items-center gap-2">
        <input
          type="text"
          placeholder="Optional device label (e.g. Work MacBook Touch ID)"
          value={customName}
          onChange={(e) => setCustomName(e.target.value)}
          className="w-full max-w-md px-3.5 py-2 text-sm rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
      </div>

      {/* Rotation status banner */}
      {rotationStatuses.some((r) => r.needsRotation) && (
        <div className="mt-4 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-between gap-3 text-sm">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 shrink-0" />
            <span>
              Some passkeys are due for rotation (90-day security policy). Use
              the rotate button next to a passkey to replace it.
            </span>
          </div>
          <button
            onClick={handleCleanupExpired}
            disabled={cleaningUp}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-700 dark:text-amber-300 font-medium text-xs transition-colors disabled:opacity-50"
          >
            {cleaningUp ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Cleanup Expired
          </button>
        </div>
      )}

      {/* List of Passkeys */}
      <div className="mt-6">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-zinc-400 gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Loading passkeys...</span>
          </div>
        ) : passkeys.length === 0 ? (
          <div className="text-center py-8 border border-dashed border-zinc-300 dark:border-zinc-800 rounded-xl">
            <KeyRound className="h-8 w-8 text-zinc-400 mx-auto mb-2" />
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              No passkeys registered yet
            </p>
            <p className="text-xs text-zinc-500 mt-1">
              Add a passkey to enable instant passwordless biometric sign-in.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {passkeys.map((pk) => (
              <div
                key={pk.id}
                className="flex items-center justify-between p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 hover:border-zinc-300 dark:hover:border-zinc-700 transition-all"
              >
                <div className="flex items-center gap-3.5">
                  <div className="p-2.5 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
                    {pk.deviceType === "singleDevice" ? (
                      <Laptop className="h-5 w-5" />
                    ) : (
                      <Smartphone className="h-5 w-5" />
                    )}
                  </div>
                  <div>
                    {editingId === pk.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          maxLength={64}
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="px-2 py-1 text-sm rounded-lg border border-blue-500 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white"
                        />
                        <button
                          onClick={() => handleRename(pk)}
                          className="text-xs px-2 py-1 rounded-md bg-blue-600 text-white"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="text-xs px-2 py-1 text-zinc-500"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm text-zinc-900 dark:text-zinc-100">
                          {pk.name}
                        </p>
                        {pk.backedUp ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                            <ShieldCheck className="h-3 w-3" /> Synced Passkey
                          </span>
                        ) : pk.deviceType === "singleDevice" || pk.deviceType === "single_device" ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                            <HardDrive className="h-3 w-3" /> Single Device Key
                          </span>
                        ) : null}
                        {(() => {
                          const rot = getRotationInfo(pk.id);
                          if (!rot) return null;
                          if (rot.isExpired) {
                            return (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20">
                                Expired
                              </span>
                            );
                          }
                          if (rot.needsRotation) {
                            return (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                                <Clock className="h-3 w-3" />
                                {rot.daysUntilExpiry}d left
                              </span>
                            );
                          }
                          return (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                              {rot.daysUntilExpiry}d left
                            </span>
                          );
                        })()}
                      </div>
                    )}
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                      Added on {new Date(pk.createdAt).toLocaleDateString()} •
                      Last used {new Date(pk.lastUsedAt).toLocaleDateString()}
                      {pk.attestationFormat &&
                        pk.attestationFormat !== "none" && (
                          <> • Attestation: {pk.attestationFormat}</>
                        )}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      <span className="font-mono bg-zinc-200/50 dark:bg-zinc-800/50 px-1.5 py-0.5 rounded">
                        ID:{" "}
                        {pk.credentialId.length > 12
                          ? `${pk.credentialId.slice(0, 6)}...${pk.credentialId.slice(-6)}`
                          : pk.credentialId}
                      </span>
                      <button
                        onClick={() => handleCopyId(pk.credentialId)}
                        className="p-1 hover:text-zinc-700 dark:hover:text-zinc-300 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                        title="Copy Credential ID"
                      >
                        {copiedId === pk.credentialId ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleRotate(pk)}
                    title="Rotate passkey"
                    aria-label={`Rotate passkey ${pk.name}`}
                    className="p-2 text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 rounded-lg hover:bg-blue-500/10 transition-colors"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => {
                      setEditingId(pk.id);
                      setEditName(pk.name);
                    }}
                    title="Rename passkey"
                    className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-lg hover:bg-zinc-200/50 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <Edit3 className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(pk)}
                    title="Delete passkey"
                    className="p-2 text-zinc-400 hover:text-red-600 dark:hover:text-red-400 rounded-lg hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {pending && (
        <PasskeyOtpDialog
          key={`${pending.action}-${pending.id}`}
          action={pending.action}
          credentialId={pending.id}
          passkeyName={pending.name}
          onCancel={() => setPending(null)}
          onSubmit={performVerifiedAction}
        />
      )}

      {showStepUpModal && (
        <StepUpReAuthModal
          isOpen={showStepUpModal}
          action={stepUpAction}
          onSuccess={(token, backupHealth) => {
            setStepUpVerifiedToken(token);
            setShowStepUpModal(false);
            setSuccess(
              `Step-up re-authentication verified successfully!${
                backupHealth ? ` Backup status: ${backupHealth}.` : ""
              }`,
            );
            setTimeout(() => setSuccess(null), 5000);
          }}
          onCancel={() => setShowStepUpModal(false)}
        />
      )}
    </div>
  );
}
