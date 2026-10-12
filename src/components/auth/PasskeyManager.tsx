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
import { PasskeySecurityAuditLog } from "@/components/auth/PasskeySecurityAuditLog";
import {
  detectDeviceDetails,
  DEVICE_NICKNAME_PRESETS,
} from "@/lib/auth/passkeys/deviceDetection";
import {
  savePasskeyChallengeToSession,
  clearPasskeyChallengeFromSession,
  setupPasskeyUnloadCleanup,
} from "@/lib/auth/passkeys/client";
// Import the new WebAuthn Service
import { WebAuthnService } from "@/lib/auth/WebAuthnService";

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

  // Initialize WebAuthn Service
  const webAuthnService = new WebAuthnService();

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
  const [savingId, setSavingId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [showStepUpModal, setShowStepUpModal] = useState(false);
  const [stepUpAction, setStepUpAction] = useState("passkey_management");
  const [_stepUpVerifiedToken, setStepUpVerifiedToken] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"devices" | "audit">("devices");
  const [detectedInfo, setDetectedInfo] = useState<ReturnType<typeof detectDeviceDetails> | null>(null);

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
    setDetectedInfo(detectDeviceDetails());
    const cleanup = setupPasskeyUnloadCleanup();
    return cleanup;
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
      clearPasskeyChallengeFromSession();

      // Use WebAuthnService to get options
      const options = await webAuthnService.getRegistrationOptions();

      if (options?.challenge) {
        savePasskeyChallengeToSession(options.challenge, "registration");
      }

      // Trigger browser WebAuthn prompt via Service or direct call
      // Note: If WebAuthnService.createPasskey wraps startRegistration, we use it. 
      // Otherwise we fall back to direct startRegistration as per original logic but using service options.
      let registrationResponse;
      try {
        registrationResponse = await webAuthnService.createPasskey(options);
      } catch (e) {
        // Fallback if service method isn't fully implemented or differs
        registrationResponse = await startRegistration({ optionsJSON: options });
      }

      // Verify via Service
      const isValid = await webAuthnService.verifyRegistration(registrationResponse);

      if (isValid) {
        // Finalize with server if needed (original logic had a verify endpoint)
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
          throw new Error(errData.error || "Passkey verification failed on server.");
        }

        clearPasskeyChallengeFromSession();
        setSuccess("Passkey successfully registered and synced!");
        setCustomName("");
        await fetchPasskeys();
      } else {
        throw new Error("Passkey registration verification failed locally.");
      }

    } catch (err: unknown) {
      clearPasskeyChallengeFromSession();
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

  const handleStartEdit = (pk: PasskeyItem) => {
    setEditingId(pk.id);
    setEditName(pk.name);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditName("");
  };

  const handleInlineRename = async (pk: PasskeyItem) => {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === pk.name) {
      handleCancelEdit();
      return;
    }

    const previousName = pk.name;
    // Optimistic update
    setPasskeys((prev) =>
      prev.map((item) =>
        item.id === pk.id ? { ...item, name: trimmed } : item,
      ),
    );
    setEditingId(null);
    setSavingId(pk.id);
    setError(null);

    try {
      const res = await fetch(`/api/auth/passkey/credentials/${pk.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to rename passkey.");
      }

      setSuccess(`Passkey renamed to "${trimmed}".`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: unknown) {
      // Revert optimistic update on failure
      setPasskeys((prev) =>
        prev.map((item) =>
          item.id === pk.id ? { ...item, name: previousName } : item,
        ),
      );
      const msg = err instanceof Error ? err.message : "Failed to rename passkey.";
      setError(msg);
      setTimeout(() => setError(null), 4000);
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = (pk: PasskeyItem) => {
    const credId = pk?.credentialId || pk?.id;
    if (!pk || !credId || typeof credId !== "string" || !credId.trim()) {
      setError("Invalid passkey credential ID. Cannot revoke passkey.");
      return;
    }
    if (!confirm("Are you sure you want to remove this passkey credential?"))
      return;
    setPending({ action: "revoke", id: credId, name: pk.name || "Passkey" });
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
      if (!id || typeof id !== "string" || !id.trim()) {
        setError("Invalid passkey credential ID. Cannot revoke passkey.");
        setPending(null);
        return;
      }
      const res = await fetch(`/api/auth/passkey/credentials/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otp }),
      });
      if (!res.ok) throw await errorFrom(res, "Failed to remove passkey.");
      setSuccess("Passkey removed.");
    } else {
      clearPasskeyChallengeFromSession();
      const optRes = await fetch(
        `/api/auth/passkey/register/options?rotate=${encodeURIComponent(id)}`,
      );
      if (!optRes.ok) throw await errorFrom(optRes, "Failed to start rotation.");
      const optionsJSON = await optRes.json();

      if (optionsJSON?.challenge) {
        savePasskeyChallengeToSession(optionsJSON.challenge, "registration");
      }

      let registrationResponse;
      try {
        registrationResponse = await startRegistration({ optionsJSON });
      } catch {
        clearPasskeyChallengeFromSession();
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
      clearPasskeyChallengeFromSession();
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

      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-800 pb-3 mt-6">
        <button
          onClick={() => setActiveTab("devices")}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${activeTab === "devices"
              ? "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 shadow-md"
              : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
            }`}
        >
          <KeyRound className="w-4 h-4" />
          Registered Devices ({passkeys.length})
        </button>
        <button
          onClick={() => setActiveTab("audit")}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${activeTab === "audit"
              ? "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 shadow-md"
              : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
            }`}
        >
          <Shield className="w-4 h-4 text-blue-500" />
          Security Audit Log
        </button>
      </div>

      {activeTab === "audit" ? (
        <div className="mt-6">
          <PasskeySecurityAuditLog />
        </div>
      ) : (
        <>
          {/* Optional custom label & smart nicknaming helper */}
          <div className="mt-6 p-4 rounded-2xl bg-zinc-50/80 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800/80 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label className="text-xs font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                Device Nickname & Identity
              </label>
              {detectedInfo && (
                <button
                  type="button"
                  onClick={() => setCustomName(detectedInfo.suggestedNickname)}
                  className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 self-start sm:self-auto"
                >
                  <span>✨ Auto-detected:</span>
                  <span className="font-bold">{detectedInfo.suggestedNickname}</span>
                  <span className="text-zinc-400 text-[10px]">(Use)</span>
                </button>
              )}
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <input
                type="text"
                placeholder="Device label (e.g. Work MacBook Touch ID, Personal iPhone)"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                className="w-full max-w-md px-3.5 py-2 text-sm rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <span className="text-[11px] text-zinc-500">
                Applied automatically when clicking "Add New Passkey"
              </span>
            </div>

            {/* Quick Preset Chips */}
            <div>
              <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1.5">
                Quick Nickname Presets
              </div>
              <div className="flex flex-wrap gap-1.5">
                {DEVICE_NICKNAME_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setCustomName(preset.label)}
                    className="text-[11px] px-2.5 py-1 rounded-lg bg-white dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700/60 transition-colors shadow-xs"
                  >
                    + {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Rotation status banner */}
      {activeTab === "devices" && rotationStatuses.some((r) => r.needsRotation) && (
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
      {activeTab === "devices" && (
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
                            autoFocus
                            maxLength={64}
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleInlineRename(pk);
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                handleCancelEdit();
                              }
                            }}
                            className="px-2 py-1 text-sm rounded-lg border border-blue-500 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                            data-testid={`rename-input-${pk.id}`}
                            aria-label="Edit passkey nickname"
                          />
                          <button
                            type="button"
                            onClick={() => handleInlineRename(pk)}
                            disabled={savingId === pk.id}
                            className="text-xs px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors disabled:opacity-50 flex items-center gap-1 cursor-pointer"
                            data-testid={`save-rename-${pk.id}`}
                          >
                            {savingId === pk.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              "Save"
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={handleCancelEdit}
                            disabled={savingId === pk.id}
                            className="text-xs px-2 py-1 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors cursor-pointer"
                            data-testid={`cancel-rename-${pk.id}`}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1.5 group/name">
                            <p
                              onDoubleClick={() => handleStartEdit(pk)}
                              className="font-medium text-sm text-zinc-900 dark:text-zinc-100 cursor-pointer select-none"
                              title="Double-click to rename"
                              data-testid={`passkey-name-${pk.id}`}
                            >
                              {pk.name}
                            </p>
                            <button
                              type="button"
                              onClick={() => handleStartEdit(pk)}
                              title="Rename passkey"
                              aria-label={`Rename passkey ${pk.name}`}
                              className="p-1 text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 rounded transition-colors opacity-70 hover:opacity-100 cursor-pointer"
                              data-testid={`edit-nickname-btn-${pk.id}`}
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                          </div>
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
                      onClick={() => handleStartEdit(pk)}
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
      )}


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
              `Step-up re-authentication verified successfully!${backupHealth ? ` Backup status: ${backupHealth}.` : ""
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
