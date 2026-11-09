"use client";

import { useState, useEffect, useCallback } from "react";
import {
  offlineConflictService,
  type ConflictedQueueItem,
  type ConflictResolutionStrategy,
} from "@/lib/offline/conflictService";

export interface UseOfflineConflictsReturn {
  conflicts: ConflictedQueueItem[];
  conflictCount: number;
  isLoading: boolean;
  resolveItem: (
    item: ConflictedQueueItem,
    strategy: ConflictResolutionStrategy,
    customPayload?: Record<string, unknown>,
  ) => Promise<boolean>;
  bulkResolve: (strategy: "CLIENT_WINS" | "SERVER_WINS") => Promise<void>;
  refresh: () => Promise<void>;
}

export function useOfflineConflicts(): UseOfflineConflictsReturn {
  const [conflicts, setConflicts] = useState<ConflictedQueueItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (typeof window === "undefined") return;
    setIsLoading(true);
    try {
      const items = await offlineConflictService.getConflictedItems();
      setConflicts(items);
    } catch (e) {
      console.error("[useOfflineConflicts] refresh error:", e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();

    const handleSyncEvent = () => {
      void refresh();
    };

    window.addEventListener("online", handleSyncEvent);
    window.addEventListener("trigger-sync", handleSyncEvent);

    return () => {
      window.removeEventListener("online", handleSyncEvent);
      window.removeEventListener("trigger-sync", handleSyncEvent);
    };
  }, [refresh]);

  const resolveItem = useCallback(
    async (
      item: ConflictedQueueItem,
      strategy: ConflictResolutionStrategy,
      customPayload?: Record<string, unknown>,
    ): Promise<boolean> => {
      const ok = await offlineConflictService.resolveConflict(item, strategy, customPayload);
      if (ok) {
        await refresh();
      }
      return ok;
    },
    [refresh],
  );

  const bulkResolve = useCallback(
    async (strategy: "CLIENT_WINS" | "SERVER_WINS") => {
      if (conflicts.length === 0) return;
      setIsLoading(true);
      try {
        await offlineConflictService.bulkResolve(conflicts, strategy);
        await refresh();
      } finally {
        setIsLoading(false);
      }
    },
    [conflicts, refresh],
  );

  return {
    conflicts,
    conflictCount: conflicts.length,
    isLoading,
    resolveItem,
    bulkResolve,
    refresh,
  };
}
