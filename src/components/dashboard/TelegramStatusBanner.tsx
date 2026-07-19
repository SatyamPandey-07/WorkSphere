"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface UserSettings {
  telegramConfigured: boolean;
}

export function TelegramStatusBanner() {
  const router = useRouter();
  const [data, setData] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      // Using cache: 'no-store' ensures we always get the freshest data directly from the server.
      const response = await fetch("/api/user/settings", {
        cache: "no-store",
        signal,
      });

      if (response.status === 401) {
        setData(null);
        return;
      }

      if (!response.ok) {
        throw new Error("Failed to fetch settings");
      }

      const json = await response.json();
      setData(json);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        return; // Ignore abort errors
      }
      setError(
        err instanceof Error
          ? err.message
          : "An error occurred while fetching settings.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchSettings(controller.signal);

    return () => {
      controller.abort();
    };
  }, [fetchSettings]);

  if (loading && !data && !error) {
    return (
      <div
        aria-busy="true"
        aria-label="Loading Telegram status"
        className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 sm:p-6 shadow-sm flex items-center justify-between animate-pulse"
      >
        <div className="flex items-center gap-4 w-full">
          <Skeleton className="w-10 h-10 rounded-full flex-shrink-0" />
          <div className="space-y-2 w-full max-w-[200px] sm:max-w-[300px]">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
        <Skeleton className="h-10 w-32 rounded-md hidden sm:block flex-shrink-0" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="w-full bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 text-red-800 dark:text-red-200 rounded-xl p-4 sm:p-6 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-all"
      >
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-6 h-6 flex-shrink-0 text-red-600 dark:text-red-400" />
          <div>
            <h3 className="font-semibold text-sm sm:text-base text-red-900 dark:text-red-300">
              Failed to load Telegram status
            </h3>
            <p className="text-sm text-red-700 dark:text-red-400/80">
              Please try again or check your connection.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => fetchSettings()}
          disabled={loading}
          className="w-full sm:w-auto bg-white dark:bg-zinc-950 border-red-200 dark:border-red-900/50 hover:bg-red-50 dark:hover:bg-red-900/30 transition-transform active:scale-[0.98]"
        >
          <RefreshCw
            className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`}
          />
          {loading ? "Retrying..." : "Retry"}
        </Button>
      </div>
    );
  }

  if (!data) return null;

  const { telegramConfigured } = data;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`w-full border rounded-xl p-4 sm:p-6 shadow-sm transition-all duration-300 ease-in-out animate-in fade-in flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${
        telegramConfigured
          ? "bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-900/30"
          : "bg-orange-50 dark:bg-orange-900/10 border-orange-200 dark:border-orange-900/30"
      }`}
    >
      <div className="flex items-start sm:items-center gap-4">
        <div
          className={`p-2 rounded-full flex-shrink-0 transition-colors ${
            telegramConfigured
              ? "bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400"
              : "bg-orange-100 dark:bg-orange-900/40 text-orange-600 dark:text-orange-400"
          }`}
        >
          {telegramConfigured ? (
            <CheckCircle2 className="w-6 h-6" aria-hidden="true" />
          ) : (
            <AlertTriangle className="w-6 h-6" aria-hidden="true" />
          )}
        </div>
        <div>
          <h3
            className={`font-semibold text-lg ${
              telegramConfigured
                ? "text-green-900 dark:text-green-300"
                : "text-orange-900 dark:text-orange-300"
            }`}
          >
            {telegramConfigured
              ? "Telegram Configured"
              : "Telegram Not Configured"}
          </h3>
          <p
            className={`text-sm mt-1 ${
              telegramConfigured
                ? "text-green-700 dark:text-green-400/80"
                : "text-orange-700 dark:text-orange-400/80"
            }`}
          >
            {telegramConfigured
              ? "Telegram webhook has been configured. Complete verification if required to receive alerts."
              : "Configure Telegram to enable real-time alerts."}
          </p>
        </div>
      </div>
      <Button
        onClick={() => router.push("/dashboard/webhooks")}
        className={`w-full sm:w-auto transition-transform hover:scale-[1.02] active:scale-[0.98] ${
          telegramConfigured
            ? "bg-green-600 hover:bg-green-700 text-white dark:bg-green-700 dark:hover:bg-green-600"
            : "bg-orange-600 hover:bg-orange-700 text-white dark:bg-orange-700 dark:hover:bg-orange-600"
        }`}
      >
        {telegramConfigured ? "Manage Telegram" : "Configure Telegram"}
        <ArrowRight className="w-4 h-4 ml-2" aria-hidden="true" />
      </Button>
    </div>
  );
}
