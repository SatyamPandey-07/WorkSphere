"use client";

import usePartySocket from "partysocket/react";
import {
  attachJitteredBackoff,
  PARTY_SOCKET_RECONNECT_OPTIONS,
} from "@/lib/partySocketReconnect";

type PartySocketOptions = Parameters<typeof usePartySocket>[0];

/**
 * PartySocket with capped retries + jittered exponential backoff.
 * Drop-in for `partysocket/react`'s usePartySocket.
 */
export default function usePartySocketReconnect(options: PartySocketOptions) {
  const socket = usePartySocket({
    ...PARTY_SOCKET_RECONNECT_OPTIONS,
    ...options,
  });

  return attachJitteredBackoff(socket);
}
