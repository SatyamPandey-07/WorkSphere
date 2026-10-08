"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { useToast } from "@/components/ui/Toast";
import type {
  ConflictResolutionStrategy,
  QueuedReviewItem,
  ReviewConflictWorkerInboundMessage,
  ReviewConflictWorkerOutboundMessage,
} from "@/workers/reviewConflictSync.worker";

export interface ReviewConflictItem {
  id: string;
  venueId: string;
  venueName?: string;
  conflictDetails?: Record<string, unknown>;
  localReview?: QueuedReviewItem;
}

export function useReviewConflictWorker() {
  const { getToken } = useAuth();
  const { toast } = useToast();

  const workerRef = useRef<Worker | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [conflicts, setConflicts] = useState<ReviewConflictItem[]>([]);
  const [activeConflict, setActiveConflict] = useState<ReviewConflictItem | null>(null);
  const [lastChecked, setLastChecked] = useState<number | null>(null);

  const getTokenRef = useRef(getToken);
  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const fetchCsrfToken = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch("/api/auth/csrf-token");
      if (res.ok) {
        const data = await res.json();
        return data.csrfToken || null;
      }
    } catch {}
    return null;
  }, []);

  const triggerSync = useCallback(async () => {
    if (!workerRef.current) return;
    const token = await getTokenRef.current().catch(() => null);
    const csrfToken = await fetchCsrfToken();

    workerRef.current.postMessage({
      type: "TRIGGER_SYNC",
      token: token ?? undefined,
      csrfToken: csrfToken ?? undefined,
    } satisfies ReviewConflictWorkerInboundMessage);
  }, [fetchCsrfToken]);

  const resolveConflict = useCallback(
    async (
      id: string,
      resolution: ConflictResolutionStrategy,
      customData?: QueuedReviewItem["data"],
    ) => {
      if (!workerRef.current) return;
      const token = await getTokenRef.current().catch(() => null);
      const csrfToken = await fetchCsrfToken();

      workerRef.current.postMessage({
        type: "RESOLVE_CONFLICT",
        id,
        resolution,
        customData,
        token: token ?? undefined,
        csrfToken: csrfToken ?? undefined,
      } satisfies ReviewConflictWorkerInboundMessage);
    },
    [fetchCsrfToken],
  );

  useEffect(() => {
    if (typeof window === "undefined" || !window.Worker) return;

    const worker = new Worker(
      new URL("../workers/reviewConflictSync.worker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;

    const handleMessage = (event: MessageEvent<ReviewConflictWorkerOutboundMessage>) => {
      const msg = event.data;
      if (!msg || !msg.type) return;

      switch (msg.type) {
        case "SYNC_STARTED": {
          setIsSyncing(true);
          break;
        }

        case "SYNC_SUCCESS": {
          toast(
            `Offline review for ${msg.venueName || "venue"} synced successfully!`,
            "success",
          );
          setConflicts((prev) => prev.filter((c) => c.id !== msg.id));
          break;
        }

        case "CONFLICT_DETECTED": {
          const conflictItem: ReviewConflictItem = {
            id: msg.id,
            venueId: msg.venueId,
            venueName: msg.venueName,
            conflictDetails: msg.conflictDetails as Record<string, unknown>,
            localReview: msg.localReview,
          };

          setConflicts((prev) => {
            if (prev.some((c) => c.id === msg.id)) return prev;
            return [...prev, conflictItem];
          });

          setActiveConflict(conflictItem);

          toast(
            `Review conflict on ${msg.venueName || "venue"}. Multi-device edit collision detected.`,
            "warning",
            {
              label: "Resolve Merge",
              onClick: () => setActiveConflict(conflictItem),
            },
          );
          break;
        }

        case "CONFLICT_RESOLVED": {
          if (msg.success) {
            setConflicts((prev) => prev.filter((c) => c.id !== msg.id));
            setActiveConflict((prev) => (prev?.id === msg.id ? null : prev));
            toast("Review conflict resolved.", "success");
          } else {
            toast("Failed to resolve review conflict.", "warning");
          }
          break;
        }

        case "PERIODIC_CHECK_COMPLETE": {
          setIsSyncing(false);
          setLastChecked(msg.timestamp);
          break;
        }

        case "SYNC_ERROR": {
          setIsSyncing(false);
          break;
        }
      }
    };

    worker.addEventListener("message", handleMessage);

    // Start periodic background check
    void (async () => {
      const token = await getTokenRef.current().catch(() => null);
      const csrfToken = await fetchCsrfToken();

      worker.postMessage({
        type: "START_PERIODIC_CHECK",
        intervalMs: 30000,
        token: token ?? undefined,
        csrfToken: csrfToken ?? undefined,
      } satisfies ReviewConflictWorkerInboundMessage);
    })();

    // Wake up on network reconnection or visibility restore
    const handleOnline = () => {
      void triggerSync();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void triggerSync();
      }
    };

    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      workerRef.current = null;
      worker.removeEventListener("message", handleMessage);
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      worker.postMessage({ type: "STOP_PERIODIC_CHECK" } satisfies ReviewConflictWorkerInboundMessage);
      worker.terminate();
    };
  }, [fetchCsrfToken, resolveConflict, toast, triggerSync]);

  return {
    isSyncing,
    conflicts,
    activeConflict,
    setActiveConflict,
    lastChecked,
    triggerSync,
    resolveConflict,
  };
}
