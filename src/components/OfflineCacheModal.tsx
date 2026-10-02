"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Database, HardDrive, Trash2, WifiOff, Wifi, Loader2, CheckCircle2 } from "lucide-react";
import { getAllVenuesOffline } from "@/lib/offlineStorage";

interface OfflineCacheModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface CacheStats {
  venueCount: number;
  storageMB: number | null;
  isOnline: boolean;
}

export function OfflineCacheModal({ isOpen, onClose }: OfflineCacheModalProps) {
  const [stats, setStats] = useState<CacheStats>({
    venueCount: 0,
    storageMB: null,
    isOnline: true,
  });
  const [isClearing, setIsClearing] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const venues = await getAllVenuesOffline();
      let storageMB: number | null = null;
      if ("storage" in navigator && navigator.storage?.estimate) {
        const { usage } = await navigator.storage.estimate();
        if (usage !== undefined) {
          storageMB = Math.round((usage / 1024 / 1024) * 100) / 100;
        }
      }
      setStats({
        venueCount: venues.length,
        storageMB,
        isOnline: navigator.onLine,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadStats();
      setCleared(false);
      setConfirmClear(false);
    }
  }, [isOpen, loadStats]);

  useEffect(() => {
    const handleOnline = () => setStats((s) => ({ ...s, isOnline: true }));
    const handleOffline = () => setStats((s) => ({ ...s, isOnline: false }));
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const clearCache = async () => {
    setIsClearing(true);
    try {
      // Clear service worker caches
      if ("caches" in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((name) => caches.delete(name)));
      }
      // Clear IndexedDB venue data
      if ("indexedDB" in window) {
        const dbNames = ["WorkSphereOfflineDB"];
        for (const name of dbNames) {
          const req = indexedDB.deleteDatabase(name);
          await new Promise<void>((resolve) => {
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
          });
        }
      }
      setCleared(true);
      setConfirmClear(false);
      await loadStats();
    } finally {
      setIsClearing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="offline-cache-title"
    >
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-sm border border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center justify-between p-6 border-b border-zinc-200 dark:border-zinc-800">
          <h2
            id="offline-cache-title"
            className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2"
          >
            <Database className="w-5 h-5 text-blue-500" />
            Offline Cache
          </h2>
          <div className={`flex items-center gap-1.5 text-xs font-medium ${stats.isOnline ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
            {stats.isOnline ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
            {stats.isOnline ? "Online" : "Offline"}
          </div>
        </div>

        <div className="p-6 space-y-4">
          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-zinc-50 dark:bg-zinc-800 rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                    {stats.venueCount}
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                    Venues cached
                  </p>
                </div>
                <div className="bg-zinc-50 dark:bg-zinc-800 rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                    {stats.storageMB !== null ? `${stats.storageMB}` : "—"}
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                    MB used
                  </p>
                </div>
              </div>

              {cleared && (
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400 text-sm font-medium bg-green-50 dark:bg-green-900/20 rounded-xl px-4 py-3">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  Cache cleared successfully
                </div>
              )}

              {confirmClear ? (
                <div className="space-y-2">
                  <p className="text-sm text-zinc-600 dark:text-zinc-400 text-center">
                    Clear all offline venue data and service worker caches?
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmClear(false)}
                      className="flex-1 px-4 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={clearCache}
                      disabled={isClearing}
                      className="flex-1 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
                    >
                      {isClearing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      {isClearing ? "Clearing…" : "Clear All"}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmClear(true)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-red-200 dark:border-red-800/50 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 text-sm font-medium transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Clear Offline Cache
                </button>
              )}
            </>
          )}
        </div>

        <div className="p-4 border-t border-zinc-200 dark:border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            className="w-full px-4 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-sm font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
