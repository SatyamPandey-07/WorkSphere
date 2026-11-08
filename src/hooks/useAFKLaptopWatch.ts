"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type AFKStatus = "available" | "watching" | "unavailable";

interface UseAFKLaptopWatchOptions {
  venueId: string;
  userId: string | null | undefined;
  socket: WebSocket | null | undefined;
}

interface WatchRequest {
  fromUserId: string;
  fromName: string;
  requestedAt: number;
}

/**
 * "Laptop Watch" buddy system — allows co-located WorkSphere users to
 * send a "Can you watch my laptop?" request to others checked in at the
 * same venue, using the existing PartyKit real-time channel.
 *
 * Message protocol over the PartyKit socket:
 *   → { type: "laptop-watch-request", venueId, fromUserId, fromName }
 *   → { type: "laptop-watch-accept",  venueId, toUserId }
 *   → { type: "laptop-watch-decline", venueId, toUserId }
 *   → { type: "laptop-watch-release", venueId, fromUserId }
 */
export function useAFKLaptopWatch(options: UseAFKLaptopWatchOptions) {
  const { venueId, userId, socket } = options;

  const [afkStatus, setAFKStatus] = useState<AFKStatus>("available");
  const [incomingRequest, setIncomingRequest] = useState<WatchRequest | null>(null);
  const watcherUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!socket || !userId) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.venueId !== venueId) return;

        switch (data.type) {
          case "laptop-watch-request":
            if (data.fromUserId !== userId) {
              setIncomingRequest({
                fromUserId: data.fromUserId,
                fromName: data.fromName || "Someone",
                requestedAt: Date.now(),
              });
            }
            break;

          case "laptop-watch-accept":
            if (data.toUserId === userId) {
              watcherUserIdRef.current = data.fromUserId ?? null;
              setAFKStatus("watching");
              setIncomingRequest(null);
            }
            break;

          case "laptop-watch-decline":
            if (data.toUserId === userId) {
              setIncomingRequest(null);
            }
            break;

          case "laptop-watch-release":
            if (data.fromUserId === watcherUserIdRef.current) {
              watcherUserIdRef.current = null;
              setAFKStatus("available");
            }
            break;
        }
      } catch {
        // Ignore parse errors from other message types
      }
    };

    socket.addEventListener("message", handleMessage);
    return () => socket.removeEventListener("message", handleMessage);
  }, [socket, userId, venueId]);

  const requestWatch = useCallback(() => {
    if (!socket || !userId || socket.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({
        type: "laptop-watch-request",
        venueId,
        fromUserId: userId,
        fromName: "Me",
      }),
    );
    setAFKStatus("unavailable");
  }, [socket, userId, venueId]);

  const acceptRequest = useCallback(() => {
    if (!socket || !userId || !incomingRequest) return;
    socket.send(
      JSON.stringify({
        type: "laptop-watch-accept",
        venueId,
        toUserId: incomingRequest.fromUserId,
        fromUserId: userId,
      }),
    );
    watcherUserIdRef.current = userId;
    setIncomingRequest(null);
  }, [socket, userId, venueId, incomingRequest]);

  const declineRequest = useCallback(() => {
    if (!socket || !userId || !incomingRequest) return;
    socket.send(
      JSON.stringify({
        type: "laptop-watch-decline",
        venueId,
        toUserId: incomingRequest.fromUserId,
      }),
    );
    setIncomingRequest(null);
  }, [socket, userId, venueId, incomingRequest]);

  const releaseWatch = useCallback(() => {
    if (!socket || !userId || socket.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({
        type: "laptop-watch-release",
        venueId,
        fromUserId: userId,
      }),
    );
    setAFKStatus("available");
    watcherUserIdRef.current = null;
  }, [socket, userId, venueId]);

  return {
    afkStatus,
    incomingRequest,
    requestWatch,
    acceptRequest,
    declineRequest,
    releaseWatch,
  };
}
