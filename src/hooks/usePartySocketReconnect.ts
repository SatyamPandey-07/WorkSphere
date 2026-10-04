"use client";

import usePartySocket from "./usePartySocket";
export type { PartySocketOptions } from "./usePartySocket";

/**
 * PartySocket with capped retries + jittered exponential backoff
 * and multi-tab BroadcastChannel leadership election (#3767).
 * Drop-in for `partysocket/react`'s usePartySocket.
 */
export default function usePartySocketReconnect(options: any) {
  return usePartySocket(options);
}

