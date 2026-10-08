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
  Shield,
  HardDrive,
  Calendar,
  X,
  Check,
} from "lucide-react";
import {
  detectDeviceDetails,
  inferDeviceNickname,
  DEVICE_NICKNAME_PRESETS,
} from "@/lib/auth/passkeys/deviceDetection";

export interface PasskeyCredentialItem {
  id: string;
  credentialId: string;
  name: string;
  deviceType: string;
  backedUp: boolean;
  transports: string[];
  createdAt: string;
  lastUsedAt: string;
}

export function formatRelativeOrDate(dateString?: string | null): string {
  if (!dateString) return "Never used";
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return "Unknown";

  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHour / 24);

  if (diffSec < 60) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatFullDate(dateString?: string | null): string {
  if (!dateString) return "N/A";
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return "N/A";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PasskeySettings() {
  const [passkeys, setPasskeys] = useState<PasskeyCredentialItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(false);

  // New passkey registration modal / input state
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [customNickname, setCustomNickname] = useState("");

  // Inline rename state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNickname, setEditNickname] = useState("");
  const [savingRenameId, setSavingRenameId] = useState<string | null>(null);

  // Deletion / Revocation state
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const fetchPasskeys = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/auth/passkey/credentials");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to load registered passkeys.");
      }
      const data = await res.json();
      setPasskeys(data.credentials || []);
    } catch (err) {
      console.error("Error fetching passkeys:", err);
      setError(err instanceof Error ? err.message : "Failed to load passkeys.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setIsSupported(browserSupportsWebAuthn());
    fetchPasskeys();
  }, [fetchPasskeys]);

  // Open registration modal with intelligent pre-filled nickname
  const handleOpenRegister = () => {
    const suggested = inferDeviceNickname();
    setCustomNickname(suggested);
    setError(null);
    setSuccess(null);
    setShowRegisterModal(true);
  };

  const handleRegisterPasskey = async () => {
    try {
      setRegistering(true);
      setError(null);
      setSuccess(null);

      // 1. Fetch registration challenge options
      const optRes = await fetch("/api/auth/passkey/register/options");
      if (!optRes.ok) {
        const data = await optRes.json().catch(() => ({}));
        throw new Error(data.error || "Failed to initialize registration challenge.");
      }
      const optionsJSON = await optRes.json();

      // 2. Trigger browser authenticator (Touch ID, Face ID, Windows Hello, etc.)
      const registrationResponse = await startRegistration({ optionsJSON });

      // 3. Verify on server and persist custom nickname
      const verifyRes = await fetch("/api/auth/passkey/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          registrationResponse,
          nickname: customNickname.trim() || undefined,
          name: customNickname.trim() || undefined,
        }),
      });

      if (!verifyRes.ok) {
        const data = await verifyRes.json().catch(() => ({}));
        throw new Error(data.error || "Verification failed.");
      }

      const verifyData = await verifyRes.json();
      const savedName = verifyData.credential?.nickname || verifyData.credential?.name || "Passkey";
      setSuccess(`Passkey "${savedName}" successfully registered!`);
      setShowRegisterModal(false);
      setCustomNickname("");
      await fetchPasskeys();
    } catch (err: unknown) {
      console.error("Passkey registration failed:", err);
      const msg = err instanceof Error ? err.message : "Passkey registration failed.";
      if (msg.includes("cancelled") || msg.includes("abort")) {
        setError("Registration cancelled.");
      } else {
        setError(msg);
      }
    } finally {
      setRegistering(false);
    }
  };

  const handleStartRename = (pk: PasskeyCredentialItem) => {
    setEditingId(pk.id);
    setEditNickname(pk.name);
    setError(null);
  };

  const handleCancelRename = () => {
    setEditingId(null);
    setEditNickname("");
  };

  const handleSaveRename = async (pk: PasskeyCredentialItem) => {
    const trimmed = editNickname.trim();
    if (!trimmed || trimmed === pk.name) {
      handleCancelRename();
      return;
    }

    const previousName = pk.name;
    // Immediate optimistic update
    setPasskeys((prev) =>
      prev.map((item) => (item.id === pk.id ? { ...item, name: trimmed } : item)),
    );
    setEditingId(null);
    setSavingRenameId(pk.id);
    setError(null);

    try {
      const res = await fetch(`/api/auth/passkey/credentials/${pk.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update nickname.");
      }

      setSuccess(`Passkey renamed to "${trimmed}".`);
    } catch (err) {
      // Revert optimistic update on failure
      setPasskeys((prev) =>
        prev.map((item) => (item.id === pk.id ? { ...item, name: previousName } : item)),
      );
      setError(err instanceof Error ? err.message : "Failed to rename passkey.");
    } finally {
      setSavingRenameId(null);
    }
  };

  const handleDeletePasskey = async (id: string) => {
    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/auth/passkey/credentials/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete passkey.");
      }

      setPasskeys((prev) => prev.filter((p) => p.id !== id));
      setSuccess("Passkey revoked successfully.");
      setConfirmDeleteId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete passkey.");
    } finally {
      setDeletingId(null);
    }
  };

  const getDeviceIcon = (item: PasskeyCredentialItem) => {
    const detected = detectDeviceDetails("", item.transports);
    if (detected.iconType === "laptop" || /mac|windows/i.test(item.name)) {
      return <Laptop className="h-5 w-5 text-indigo-500" />;
    }
    if (detected.iconType === "phone" || /iphone|android/i.test(item.name)) {
      return <Smartphone className="h-5 w-5 text-emerald-500" />;
    }
    if (detected.iconType === "key" || /yubi|titan|security key/i.test(item.name)) {
      return <KeyRound className="h-5 w-5 text-amber-500" />;
    }
    return <Fingerprint className="h-5 w-5 text-blue-500" />;
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6" data-testid="passkey-settings">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 rounded-2xl bg-gradient-to-r from-blue-50/70 via-indigo-50/50 to-purple-50/70 dark:from-slate-900 dark:via-indigo-950/30 dark:to-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
              Biometric Passkeys & Security Keys
            </h2>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Sign in instantly using Touch ID, Face ID, Windows Hello, or hardware security keys without passwords.
          </p>
        </div>

        {isSupported && (
          <button
            type="button"
            onClick={handleOpenRegister}
            disabled={registering || loading}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-50 transition-colors shadow-sm cursor-pointer"
            data-testid="add-passkey-btn"
          >
            <Plus className="h-4 w-4" />
            Add New Passkey
          </button>
        )}
      </div>

      {/* Unsupported Notice */}
      {!isSupported && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-300 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-200 text-sm">
          <AlertCircle className="h-5 w-5 shrink-0 text-amber-600 mt-0.5" />
          <div>
            <p className="font-semibold">WebAuthn not supported</p>
            <p>Your current browser does not support biometric passkeys. Please use a modern browser like Safari, Chrome, Edge, or Firefox.</p>
          </div>
        </div>
      )}

      {/* Notifications */}
      {error && (
        <div className="flex items-center gap-2.5 p-3.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2.5 p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300 text-sm">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {/* Passkey List */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-850 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-900 dark:text-white">Registered Passkeys</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {passkeys.length} {passkeys.length === 1 ? "device" : "devices"} configured for passwordless authentication
            </p>
          </div>
          <button
            type="button"
            onClick={fetchPasskeys}
            disabled={loading}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Refresh passkeys"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {loading ? (
          <div className="py-16 flex flex-col items-center justify-center gap-3 text-slate-400">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
            <p className="text-sm">Loading registered credentials...</p>
          </div>
        ) : passkeys.length === 0 ? (
          <div className="py-14 text-center px-4 space-y-4">
            <div className="mx-auto w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-900 flex items-center justify-center text-slate-400">
              <KeyRound className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <p className="text-base font-semibold text-slate-900 dark:text-white">No passkeys registered yet</p>
              <p className="text-sm text-slate-500 max-w-sm mx-auto">
                Add your Touch ID, Face ID, or security key for one-touch authentication on this account.
              </p>
            </div>
            {isSupported && (
              <button
                type="button"
                onClick={handleOpenRegister}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Register First Passkey
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-850">
            {passkeys.map((pk) => {
              const isEditing = editingId === pk.id;
              const isDeleting = deletingId === pk.id;
              const isConfirming = confirmDeleteId === pk.id;

              return (
                <div
                  key={pk.id}
                  className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/50 dark:hover:bg-slate-900/50 transition-colors"
                  data-testid={`passkey-row-${pk.id}`}
                >
                  <div className="flex items-start gap-4">
                    <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-900 shrink-0 mt-0.5">
                      {getDeviceIcon(pk)}
                    </div>

                    <div className="space-y-1">
                      {/* Nickname Title & Inline Edit */}
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={editNickname}
                            onChange={(e) => setEditNickname(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleSaveRename(pk);
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                handleCancelRename();
                              }
                            }}
                            className="px-2.5 py-1 text-sm rounded-lg border border-indigo-400 dark:border-indigo-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            placeholder="Enter device nickname"
                            maxLength={64}
                            autoFocus
                            data-testid={`rename-input-${pk.id}`}
                            aria-label="Edit passkey nickname"
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveRename(pk)}
                            disabled={savingRenameId === pk.id}
                            className="p-1 rounded-md text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 disabled:opacity-50 cursor-pointer"
                            title="Save"
                            data-testid={`save-rename-${pk.id}`}
                          >
                            {savingRenameId === pk.id ? (
                              <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
                            ) : (
                              <Check className="h-4 w-4" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={handleCancelRename}
                            disabled={savingRenameId === pk.id}
                            className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                            title="Cancel"
                            data-testid={`cancel-rename-${pk.id}`}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 group/name">
                          <h4
                            onDoubleClick={() => handleStartRename(pk)}
                            className="font-semibold text-slate-900 dark:text-white text-base cursor-pointer select-none"
                            title="Double-click to edit nickname"
                            data-testid={`passkey-name-${pk.id}`}
                          >
                            {pk.name}
                          </h4>
                          <button
                            type="button"
                            onClick={() => handleStartRename(pk)}
                            className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 p-1 rounded transition-colors opacity-70 hover:opacity-100 cursor-pointer"
                            title="Rename device nickname"
                            aria-label={`Rename passkey ${pk.name}`}
                            data-testid={`edit-nickname-btn-${pk.id}`}
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}

                      {/* Timestamps & Metadata Badges */}
                      <div className="flex flex-wrap items-center gap-y-1 gap-x-3 text-xs text-slate-500 dark:text-slate-400">
                        {/* Creation Date */}
                        <span className="flex items-center gap-1" title={formatFullDate(pk.createdAt)}>
                          <Calendar className="h-3.5 w-3.5 text-slate-400" />
                          Added {formatRelativeOrDate(pk.createdAt)}
                        </span>

                        <span>•</span>

                        {/* Last Used Date */}
                        <span className="flex items-center gap-1 font-medium text-slate-700 dark:text-slate-300" title={formatFullDate(pk.lastUsedAt)}>
                          <Clock className="h-3.5 w-3.5 text-indigo-500" />
                          Last used: {formatRelativeOrDate(pk.lastUsedAt)}
                        </span>

                        <span>•</span>

                        {/* Device / Sync Badge */}
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 dark:bg-slate-850 text-slate-600 dark:text-slate-300">
                          {pk.deviceType === "multiDevice" ? (
                            <>
                              <Shield className="h-3 w-3 text-emerald-500" />
                              Synced Passkey
                            </>
                          ) : (
                            <>
                              <HardDrive className="h-3 w-3 text-amber-500" />
                              Hardware Bound
                            </>
                          )}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons: Delete / Revoke */}
                  <div className="flex items-center gap-2 shrink-0 sm:self-center">
                    {isConfirming ? (
                      <div className="flex items-center gap-2 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 px-3 py-1.5 rounded-xl">
                        <span className="text-xs text-red-700 dark:text-red-300 font-medium">Revoke?</span>
                        <button
                          type="button"
                          onClick={() => handleDeletePasskey(pk.id)}
                          disabled={isDeleting}
                          className="px-2 py-0.5 text-xs font-semibold rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          {isDeleting ? "Revoking..." : "Yes, Revoke"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(pk.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors cursor-pointer"
                        title="Revoke passkey"
                        data-testid={`delete-passkey-btn-${pk.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Revoke
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Registration Modal Dialog */}
      {showRegisterModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-xl space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400">
                  <KeyRound className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                  Add New Passkey
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowRegisterModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="text-sm text-slate-600 dark:text-slate-400">
              Give your passkey a recognizable nickname so you know which device it belongs to.
            </p>

            <div className="space-y-3">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Device Nickname
              </label>
              <input
                type="text"
                value={customNickname}
                onChange={(e) => setCustomNickname(e.target.value)}
                placeholder="e.g. MacBook Pro Touch ID, Office YubiKey"
                maxLength={64}
                className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-850 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white dark:focus:bg-slate-900 transition-all"
                autoFocus
              />

              {/* Nickname preset pills */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-medium text-slate-400">Quick Suggestions:</span>
                <div className="flex flex-wrap gap-1.5">
                  {DEVICE_NICKNAME_PRESETS.slice(0, 5).map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setCustomNickname(preset.label)}
                      className="px-2.5 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setShowRegisterModal(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRegisterPasskey}
                disabled={registering}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                data-testid="confirm-register-btn"
              >
                {registering ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Touch Authenticator...
                  </>
                ) : (
                  <>
                    <Fingerprint className="h-4 w-4" />
                    Continue with Biometrics
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PasskeySettings;
