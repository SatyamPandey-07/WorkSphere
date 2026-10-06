"use client";

import React, { useState } from "react";
import { User, Check, AlertCircle, Loader2 } from "lucide-react";
import { sanitizeDisplayName, validateDisplayName } from "@/lib/profileSanitizer";

interface DisplayNameFormProps {
  initialDisplayName?: string;
  onSaveSuccess?: (newName: string) => void;
}

export function DisplayNameForm({
  initialDisplayName = "",
  onSaveSuccess,
}: DisplayNameFormProps) {
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const validation = validateDisplayName(displayName);
    if (!validation.isValid) {
      setError(validation.error || "Invalid display name");
      return;
    }

    const sanitized = validation.sanitized;
    setDisplayName(sanitized);

    try {
      setLoading(true);
      const res = await fetch("/api/user/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: sanitized }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Failed to update display name");
      }

      setSuccess("Display name updated successfully");
      onSaveSuccess?.(sanitized);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "An error occurred";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-950/50 border border-purple-100 dark:border-purple-900/50 flex items-center justify-center text-purple-600 dark:text-purple-400 shrink-0">
          <User className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Display Name
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Customize how your name appears across WorkSphere headers &amp; avatars
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
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
              type="text"
              value={displayName}
              onChange={handleChange}
              placeholder="e.g. Satyam Pandey"
              maxLength={50}
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
          {success && (
            <p
              aria-live="polite"
              data-testid="display-name-success"
              className="mt-1.5 text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1"
            >
              <Check className="w-3.5 h-3.5 shrink-0" />
              {success}
            </p>
          )}
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
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
