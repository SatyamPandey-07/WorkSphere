"use client";

import React, { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { AtSign, Check, AlertCircle, Loader2 } from "lucide-react";
import {
  sanitizeUsername,
  validateUsername,
  MIN_USERNAME_LENGTH,
  MAX_USERNAME_LENGTH,
} from "@/lib/profileSanitizer";

export interface UsernameFormProps {
  initialUsername?: string;
  onSaveSuccess?: (newUsername: string) => void;
  className?: string;
  "data-testid"?: string;
}

export function UsernameForm({
  initialUsername = "",
  onSaveSuccess,
  className,
  ...props
}: UsernameFormProps) {
  const [username, setUsername] = useState(initialUsername || "");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawVal = e.target.value;
    setUsername(rawVal);

    if (error) {
      const validation = validateUsername(rawVal);
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
    if (loading) return;

    setError(null);
    setSuccess(null);

    // Client-side minimum character length & formatting validation
    const validation = validateUsername(username);
    if (!validation.isValid) {
      setError(
        validation.error ||
          `Username must be at least ${MIN_USERNAME_LENGTH} characters long.`,
      );
      return;
    }

    const sanitized = validation.sanitized;
    setUsername(sanitized);

    try {
      setLoading(true);
      const res = await fetch("/api/user/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: sanitized }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Failed to update username");
      }

      if (!isMounted.current) return;
      setSuccess("Username updated successfully");
      onSaveSuccess?.(sanitized);
    } catch (err: unknown) {
      if (!isMounted.current) return;
      const message =
        err instanceof Error ? err.message : "An error occurred while updating username";
      setError(message);
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  };

  return (
    <div
      data-testid={props["data-testid"] || "username-form"}
      className={cn(
        "p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm",
        className
      )}
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/50 border border-blue-100 dark:border-blue-900/50 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
          <AtSign className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Username Handle
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Your unique @handle used for collaborative notes and booking reservations
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label
            htmlFor="custom-username-input"
            className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1"
          >
            Username (min {MIN_USERNAME_LENGTH} chars)
          </label>
          <div className="relative flex items-center">
            <span className="absolute left-3.5 text-xs text-zinc-400 font-mono select-none">
              @
            </span>
            <input
              id="custom-username-input"
              data-testid="username-input"
              type="text"
              value={username}
              onChange={handleChange}
              placeholder="e.g. nomad_dev"
              minLength={MIN_USERNAME_LENGTH}
              maxLength={MAX_USERNAME_LENGTH}
              className={cn(
                "w-full pl-8 pr-3.5 py-2 rounded-xl text-sm font-mono border bg-zinc-50 dark:bg-zinc-800/60 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 transition-all",
                error
                  ? "border-red-500 focus:ring-red-500/20"
                  : "border-zinc-200 dark:border-zinc-700 focus:ring-blue-500/20 focus:border-blue-500"
              )}
            />
          </div>
          {error && (
            <p
              aria-live="polite"
              data-testid="username-error"
              className="mt-1.5 text-xs text-red-500 dark:text-red-400 flex items-center gap-1"
            >
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </p>
          )}
          {success && (
            <p
              aria-live="polite"
              data-testid="username-success"
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
            data-testid="save-username-btn"
            disabled={loading}
            aria-busy={loading}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer"
          >
            {loading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                <span>Saving...</span>
              </>
            ) : (
              <span>Save Username</span>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

export default UsernameForm;
