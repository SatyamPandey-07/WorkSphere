"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  DraftStore,
  BOOKING_DRAFT_EVENTS,
  BOOKING_DRAFTS_BROADCAST_CHANNEL,
} from "@/worker/bookingSync/DraftStore";

let sharedDraftStoreInstance: DraftStore | null = null;

function getSharedDraftStore(): DraftStore {
  if (!sharedDraftStoreInstance) {
    sharedDraftStoreInstance = new DraftStore();
  }
  return sharedDraftStoreInstance;
}

export function useOfflineDraftCount(customStore?: DraftStore) {
  const [count, setCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const isMountedRef = useRef(true);

  const draftStore = customStore || getSharedDraftStore();

  const refreshCount = useCallback(async () => {
    try {
      const pendingCount = await draftStore.getPendingDraftCount();
      if (isMountedRef.current) {
        setCount(pendingCount);
        setIsLoading(false);
      }
      return pendingCount;
    } catch (error) {
      console.error("[useOfflineDraftCount] Failed to refresh count:", error);
      if (isMountedRef.current) {
        setIsLoading(false);
      }
      return 0;
    }
  }, [draftStore]);

  useEffect(() => {
    isMountedRef.current = true;
    void refreshCount();

    const handleDraftEvent = () => {
      void refreshCount();
    };

    let broadcastChannel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      try {
        broadcastChannel = new BroadcastChannel(BOOKING_DRAFTS_BROADCAST_CHANNEL);
        broadcastChannel.onmessage = () => {
          void refreshCount();
        };
      } catch {
        // BroadcastChannel unsupported or blocked
      }
    }

    if (typeof window !== "undefined") {
      window.addEventListener(BOOKING_DRAFT_EVENTS.CHANGED, handleDraftEvent);
      window.addEventListener(BOOKING_DRAFT_EVENTS.SYNCED, handleDraftEvent);
      window.addEventListener("online", handleDraftEvent);
    }

    return () => {
      isMountedRef.current = false;
      if (typeof window !== "undefined") {
        window.removeEventListener(BOOKING_DRAFT_EVENTS.CHANGED, handleDraftEvent);
        window.removeEventListener(BOOKING_DRAFT_EVENTS.SYNCED, handleDraftEvent);
        window.removeEventListener("online", handleDraftEvent);
      }
      if (broadcastChannel) {
        try {
          broadcastChannel.close();
        } catch {
          // ignore close errors
        }
      }
    };
  }, [refreshCount]);

  return { count, isLoading, refreshCount };
}
