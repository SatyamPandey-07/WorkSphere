"use client";

import { useEffect } from "react";
import usePartySocket from "partysocket/react";
import { useAuth } from "@clerk/nextjs";
import {
  attachJitteredBackoff,
  PARTY_SOCKET_RECONNECT_OPTIONS,
} from "@/lib/partySocketReconnect";

type PartySocketOptions = Parameters<typeof usePartySocket>[0];

/**
 * PartySocket with capped retries + jittered exponential backoff.
 * Drop-in for `partysocket/react`'s usePartySocket.
 * Automatically intercepts 4001 token expiration codes, fetches a fresh Clerk JWT, and reconnects seamlessly.
 */
export default function usePartySocketReconnect(options: PartySocketOptions) {
  const { getToken } = useAuth();
  const socket = usePartySocket({
    ...PARTY_SOCKET_RECONNECT_OPTIONS,
    ...options,
  });

  const attachedSocket = attachJitteredBackoff(socket);

  useEffect(() => {
    if (
      !attachedSocket ||
      typeof (attachedSocket as any).addEventListener !== "function"
    )
      return;

    const handleClose = async (event: any) => {
      if (event?.code === 4001) {
        try {
          const freshToken = await getToken({ skipCache: true });
          if (freshToken) {
            if ((attachedSocket as any).query) {
              (attachedSocket as any).query.token = freshToken;
            }
            (attachedSocket as any).__worksphereForceReconnect?.();
          }
        } catch (err) {
          console.error(
            "[PartySocket] Failed to refresh expired Clerk token:",
            err,
          );
        }
      }
    };

    (attachedSocket as any).addEventListener("close", handleClose);
    return () => {
      if (typeof (attachedSocket as any).removeEventListener === "function") {
        (attachedSocket as any).removeEventListener("close", handleClose);
      }
    };
  }, [attachedSocket, getToken]);

  return attachedSocket;
}
