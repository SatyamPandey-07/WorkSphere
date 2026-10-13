"use client";

import React, { useState, useEffect } from "react";
import { User, Check, AlertCircle, Loader2, Plane } from "lucide-react";
import {
  validateDisplayName,
  validateCallsign,
  formatDisplayNameWithCallsign,
  MAX_CALLSIGN_LENGTH,
} from "@/lib/profileSanitizer";


export const CALLSIGN_STORAGE_KEY = "worksphere_flight_callsign";

export interface DisplayNameFormProps {
  initialDisplayName?: string;
  initialCallsign?: string;
  onSaveSuccess?: (newName: string, callsign?: string) => void;
}

export function DisplayNameForm({
  initialDisplayName = "",
  initialCallsign,
  onSaveSuccess,
}: DisplayNameFormProps) {
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [callsign, setCallsign] = useState(initialCallsign ?? "");
  const [error, setError] = useState<string | null>(null);
  const [callsignError, setCallsignError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Load callsign from localStorage if not explicitly provided via props
  useEffect(() => {
    if (initialCallsign === undefined && typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(CALLSIGN_STORAGE_KEY);
        if (saved) {
          setCallsign(saved);
        }
      } catch {
        // Ignore localStorage error in private browsing/sandboxes
      }
    }
  }, [initialCallsign]);


  const handleDisplayNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawVal = e.target.value;
    setDisplayName(rawVal);

    if (error) {
      const validation = validateDisplayName(rawVal);
      if (validation.isValid) {
        setError(null);
      }
    }
    if (success) {
      setSuccess(null);
    }
  };

  const handleCallsignChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawVal = e.target.value;
    setCallsign(rawVal);

    const validation = validateCallsign(rawVal);
    if (!validation.isValid) {
      setCallsignError(validation.error || null);
    } else {
      setCallsignError(null);
    }
    if (success) {
      setSuccess(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setCallsignError(null);
    setSuccess(null);

    const dnValidation = validateDisplayName(displayName);
    const csValidation = validateCallsign(callsign);

    let hasValidationFailure = false;
    if (!dnValidation.isValid) {
      setError(dnValidation.error || "Invalid display name");
      hasValidationFailure = true;
    }

    if (!csValidation.isValid) {
      setCallsignError(csValidation.error || "Invalid callsign");
      hasValidationFailure = true;
    }

    if (hasValidationFailure) {
      return;
    }

    const sanitizedName = dnValidation.sanitized;
    const sanitizedCs = csValidation.sanitized;
    setDisplayName(sanitizedName);
    setCallsign(sanitizedCs);

    try {
      setLoading(true);
      const res = await fetch("/api/user/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: sanitizedName,
          callsign: sanitizedCs,
        }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Failed to update display name");
      }

      if (typeof window !== "undefined") {
        try {
          if (sanitizedCs) {
            localStorage.setItem(CALLSIGN_STORAGE_KEY, sanitizedCs);
          } else {
            localStorage.removeItem(CALLSIGN_STORAGE_KEY);
          }
          window.dispatchEvent(
            new CustomEvent("worksphere_flight_callsign_change", {
              detail: sanitizedCs,
            }),
          );
        } catch {
          // Ignore storage issues
        }
      }

      setSuccess("Profile display information updated successfully");
      onSaveSuccess?.(sanitizedName, sanitizedCs);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "An error occurred";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const activeName = displayName.trim() || initialDisplayName.trim() || (callsign.trim() ? "Hal Jordan" : "Hal Jordan");
  const previewFormattedName = formatDisplayNameWithCallsign(activeName, callsign.trim());

  return (
    <div
      data-testid="display-name-form"
      className="p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm"
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-950/50 border border-purple-100 dark:border-purple-900/50 flex items-center justify-center text-purple-600 dark:text-purple-400 shrink-0">
          <User className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Display Name &amp; Test Pilot Callsign
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Customize how your name and aviation callsign appear across WorkSphere headers, avatars &amp; leaderboards
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Full Display Name Input */}
        <div>
          <label
            htmlFor="custom-display-name-input"
            className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1"
          >
            Full Display Name
          </label>
          <div className="relative">
            <input
              id="custom-display-name-input"
              data-testid="display-name-input"
              type="text"
              value={displayName}
              onChange={handleDisplayNameChange}
              placeholder="e.g. Hal Jordan"
              maxLength={60}
              className={`w-full px-3.5 py-2 rounded-xl text-sm border bg-zinc-50 dark:bg-zinc-800/60 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 transition-all ${
                error
                  ? "border-red-500 focus:ring-red-500/20"
                  : "border-zinc-200 dark:border-zinc-700 focus:ring-purple-500/20 focus:border-purple-500"
              }`}
            />
          </div>
          {error && (
            <p
              aria-live="polite"
              data-testid="display-name-error"
              className="mt-1.5 text-xs text-red-500 dark:text-red-400 flex items-center gap-1"
            >
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </p>
          )}
        </div>

        {/* Flight Callsign Input Field */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label
              htmlFor="custom-callsign-input"
              className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
            >
              Flight Callsign (Optional)
            </label>
            <span
              data-testid="callsign-char-count"
              className="text-[11px] font-mono text-zinc-400 dark:text-zinc-500"
            >
              {callsign.length}/{MAX_CALLSIGN_LENGTH}
            </span>
          </div>
          <div className="relative">
            <input
              id="custom-callsign-input"
              name="callsign"
              data-testid="callsign-input"
              type="text"
              value={callsign}
              onChange={handleCallsignChange}
              placeholder="e.g. Highball, Maverick, Emerald"
              maxLength={MAX_CALLSIGN_LENGTH}
              className={`w-full px-3.5 py-2 rounded-xl text-sm border bg-zinc-50 dark:bg-zinc-800/60 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 transition-all ${
                callsignError
                  ? "border-red-500 focus:ring-red-500/20"
                  : "border-zinc-200 dark:border-zinc-700 focus:ring-purple-500/20 focus:border-purple-500"
              }`}
            />
          </div>
          {callsignError && (
            <p
              aria-live="polite"
              data-testid="callsign-error"
              className="mt-1.5 text-xs text-red-500 dark:text-red-400 flex items-center gap-1"
            >
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {callsignError}
            </p>
          )}
          <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            Alphanumeric characters and hyphens only (e.g. &quot;Highball&quot;, &quot;Maverick&quot;, &quot;Emerald&quot;).
          </p>
        </div>

        {/* Live Preview Card */}
        <div
          data-testid="callsign-preview-card"
          className="p-4 rounded-xl border border-purple-100 dark:border-purple-900/40 bg-gradient-to-br from-purple-50/60 via-zinc-50 to-white dark:from-purple-950/20 dark:via-zinc-900 dark:to-zinc-900/80 shadow-sm"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-purple-700 dark:text-purple-400">
              <Plane className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Community Leaderboard Preview</span>
            </div>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live Preview
            </span>
          </div>

          <div className="flex items-center gap-3 py-1">
            <div className="w-9 h-9 rounded-xl bg-purple-600 text-white font-bold text-xs flex items-center justify-center shadow-sm shrink-0">
              {displayName.trim() ? displayName.trim().charAt(0).toUpperCase() : "H"}
            </div>
            <div className="min-w-0 flex-1">
              <p
                data-testid="callsign-preview-name"
                className="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate"
              >
                {previewFormattedName}
              </p>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Community Leaderboard &bull; Sector 2814 Coworking
              </p>
            </div>

            {callsign.trim() && (
              <span
                data-testid="callsign-preview-badge"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-mono font-semibold bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-purple-800 shrink-0"
              >
                ✈ {callsign.trim().toUpperCase()}
              </span>
            )}
          </div>
        </div>

        {/* Global Feedback */}
        {success && (
          <p
            aria-live="polite"
            data-testid="display-name-success"
            className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1"
          >
            <Check className="w-3.5 h-3.5 shrink-0" />
            {success}
          </p>
        )}

        {/* Submit Button */}
        <div className="flex justify-end pt-1">
          <button
            type="submit"
            data-testid="save-display-name-button"
            disabled={loading}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50 transition-colors flex items-center gap-1.5 shadow-sm"
          >
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save Display Name
          </button>
        </div>
      </form>
    </div>
  );
}

