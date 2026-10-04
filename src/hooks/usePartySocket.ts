"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import usePartySocketReact from "partysocket/react";
import { useAuth } from "@clerk/nextjs";
import {
  attachJitteredBackoff,
  PARTY_SOCKET_RECONNECT_OPTIONS,
} from "@/lib/partySocketReconnect";

export type PartySocketOptions = Parameters<typeof usePartySocketReact>[0] & {
  disableLeaderElection?: boolean;
};

interface LeaderHeartbeatMessage {
  type: "LEADER_HEARTBEAT";
  tabId: string;
  room: string;
  timestamp: number;
}

interface LeaderClaimMessage {
  type: "LEADER_CLAIM";
  tabId: string;
  room: string;
  timestamp: number;
}

interface LeaderResignMessage {
  type: "LEADER_RESIGN";
  tabId: string;
  room: string;
}

interface RelayInboundMessage {
  type: "RELAY_INBOUND";
  room: string;
  data: string;
}

interface RelayOutboundMessage {
  type: "RELAY_OUTBOUND";
  room: string;
  data: string;
}

interface RelayStateMessage {
  type: "RELAY_STATE";
  room: string;
  event: "open" | "close";
  details?: any;
}

type CrossTabMessage =
  | LeaderHeartbeatMessage
  | LeaderClaimMessage
  | LeaderResignMessage
  | RelayInboundMessage
  | RelayOutboundMessage
  | RelayStateMessage;

const HEARTBEAT_INTERVAL_MS = 1000;
const HEARTBEAT_TIMEOUT_MS = 2500;

/**
 * Custom PartySocket hook with:
 * 1. Multi-tab leadership coordination via BroadcastChannel (only 1 active WebSocket connection).
 * 2. Automatic leader election and smooth transfer on tab close.
 * 3. Message & presence relay between leader and follower tabs.
 * 4. Token re-authentication interceptor (Clerk 4001).
 * 5. Capped retries + jittered exponential backoff.
 */
export function usePartySocket(options: PartySocketOptions) {
  const { getToken } = useAuth();
  const room = (options as any)?.room ?? "default-room";
  const channelName = `worksphere:partysocket:${room}`;
  const tabIdRef = useRef<string>(
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `tab-${Math.random().toString(36).substring(2, 9)}`,
  );

  const [isLeader, setIsLeader] = useState<boolean>(() => {
    if (typeof window === "undefined" || options.disableLeaderElection) return true;
    return false;
  });

  const isLeaderRef = useRef<boolean>(isLeader);
  isLeaderRef.current = isLeader;

  const channelRef = useRef<BroadcastChannel | null>(null);
  const lastLeaderHeartbeatRef = useRef<number>(0);
  const followerListenersRef = useRef<Map<string, Set<(...args: any[]) => void>>>(
    new Map(),
  );

  // Helper to dispatch mock events to follower socket listeners
  const dispatchFollowerEvent = useCallback((eventName: string, eventObj: any) => {
    const listeners = followerListenersRef.current.get(eventName);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          listener(eventObj);
        } catch (err) {
          console.error(`[PartySocket follower] Error in ${eventName} listener:`, err);
        }
      });
    }
  }, []);

  // Multi-tab leader election & presence coordinator
  useEffect(() => {
    if (typeof window === "undefined" || options.disableLeaderElection) {
      setIsLeader(true);
      return;
    }

    if (typeof BroadcastChannel === "undefined") {
      setIsLeader(true);
      return;
    }

    let channel: BroadcastChannel;
    try {
      channel = new BroadcastChannel(channelName);
      channelRef.current = channel;
    } catch {
      setIsLeader(true);
      return;
    }

    const tabId = tabIdRef.current;

    const handleChannelMessage = (ev: MessageEvent<CrossTabMessage>) => {
      const msg = ev.data;
      if (!msg || msg.room !== room) return;

      if (msg.type === "LEADER_HEARTBEAT") {
        lastLeaderHeartbeatRef.current = Date.now();
        if (msg.tabId !== tabId && isLeaderRef.current) {
          // Collision resolution: lower tab ID wins leadership
          if (msg.tabId < tabId) {
            setIsLeader(false);
          }
        }
      } else if (msg.type === "LEADER_CLAIM") {
        lastLeaderHeartbeatRef.current = Date.now();
        if (msg.tabId !== tabId) {
          setIsLeader(false);
        }
      } else if (msg.type === "LEADER_RESIGN") {
        lastLeaderHeartbeatRef.current = 0;
        // Primary tab closed, claim leadership
        setIsLeader(true);
        channel.postMessage({
          type: "LEADER_CLAIM",
          tabId,
          room,
          timestamp: Date.now(),
        });
      } else if (msg.type === "RELAY_INBOUND") {
        if (!isLeaderRef.current) {
          // Follower tab receives inbound message forwarded by leader
          dispatchFollowerEvent("message", {
            type: "message",
            data: msg.data,
            origin: "",
            lastEventId: "",
            source: null,
            ports: [],
          });
        }
      } else if (msg.type === "RELAY_STATE") {
        if (!isLeaderRef.current) {
          dispatchFollowerEvent(msg.event, {
            type: msg.event,
            ...msg.details,
          });
        }
      }
    };

    channel.addEventListener("message", handleChannelMessage);

    // Initial leader claim check: if no leader seen recently, claim leadership
    const claimTimer = setTimeout(() => {
      if (Date.now() - lastLeaderHeartbeatRef.current > HEARTBEAT_TIMEOUT_MS) {
        setIsLeader(true);
        channel.postMessage({
          type: "LEADER_CLAIM",
          tabId,
          room,
          timestamp: Date.now(),
        });
      }
    }, 150 + Math.random() * 150);

    // Leader heartbeat ticker & follower watchdog
    const heartbeatInterval = setInterval(() => {
      if (isLeaderRef.current) {
        channel.postMessage({
          type: "LEADER_HEARTBEAT",
          tabId,
          room,
          timestamp: Date.now(),
        });
      } else {
        // Watchdog: check if leader missed heartbeats
        if (Date.now() - lastLeaderHeartbeatRef.current > HEARTBEAT_TIMEOUT_MS) {
          setIsLeader(true);
          channel.postMessage({
            type: "LEADER_CLAIM",
            tabId,
            room,
            timestamp: Date.now(),
          });
        }
      }
    }, HEARTBEAT_INTERVAL_MS);

    const handleBeforeUnload = () => {
      if (isLeaderRef.current) {
        channel.postMessage({
          type: "LEADER_RESIGN",
          tabId,
          room,
        });
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      clearTimeout(claimTimer);
      clearInterval(heartbeatInterval);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (isLeaderRef.current) {
        channel.postMessage({
          type: "LEADER_RESIGN",
          tabId,
          room,
        });
      }
      channel.removeEventListener("message", handleChannelMessage);
      channel.close();
      channelRef.current = null;
    };
  }, [channelName, room, options.disableLeaderElection, dispatchFollowerEvent]);

  // Only the elected leader opens the active WebSocket connection to PartyKit
  const socket = usePartySocketReact({
    ...PARTY_SOCKET_RECONNECT_OPTIONS,
    ...options,
    startClosed: !isLeader || options.startClosed,
  });

  const attachedSocket = attachJitteredBackoff(socket);

  // Leader tab: relay inbound messages & connection state across BroadcastChannel
  useEffect(() => {
    if (!isLeader || !attachedSocket) return;

    const handleLeaderOpen = () => {
      channelRef.current?.postMessage({
        type: "RELAY_STATE",
        room,
        event: "open",
      });
    };

    const handleLeaderClose = (ev: any) => {
      channelRef.current?.postMessage({
        type: "RELAY_STATE",
        room,
        event: "close",
        details: { code: ev?.code, reason: ev?.reason },
      });
    };

    const handleLeaderMessage = (ev: any) => {
      channelRef.current?.postMessage({
        type: "RELAY_INBOUND",
        room,
        data: typeof ev.data === "string" ? ev.data : JSON.stringify(ev.data),
      });
    };

    (attachedSocket as any).addEventListener?.("open", handleLeaderOpen);
    (attachedSocket as any).addEventListener?.("close", handleLeaderClose);
    (attachedSocket as any).addEventListener?.("message", handleLeaderMessage);

    // Listen for outbound messages posted by follower tabs to send through leader socket
    const handleFollowerOutbound = (ev: MessageEvent<CrossTabMessage>) => {
      if (ev.data?.type === "RELAY_OUTBOUND" && ev.data.room === room) {
        try {
          (attachedSocket as any).send?.(ev.data.data);
        } catch (err) {
          console.error("[PartySocket leader] Failed to send relayed message:", err);
        }
      }
    };

    channelRef.current?.addEventListener("message", handleFollowerOutbound);

    return () => {
      (attachedSocket as any).removeEventListener?.("open", handleLeaderOpen);
      (attachedSocket as any).removeEventListener?.("close", handleLeaderClose);
      (attachedSocket as any).removeEventListener?.("message", handleLeaderMessage);
      channelRef.current?.removeEventListener("message", handleFollowerOutbound);
    };
  }, [isLeader, attachedSocket, room]);

  // Intercept 4001 token expiration codes to refresh Clerk token
  useEffect(() => {
    if (
      !attachedSocket ||
      typeof (attachedSocket as any).addEventListener !== "function"
    )
      return;

    const handleAuthClose = async (event: any) => {
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

    (attachedSocket as any).addEventListener("close", handleAuthClose);
    return () => {
      if (typeof (attachedSocket as any).removeEventListener === "function") {
        (attachedSocket as any).removeEventListener("close", handleAuthClose);
      }
    };
  }, [attachedSocket, getToken]);

  // Return augmented socket proxy supporting followers
  const proxySocket = useRef<any>(null);
  if (!proxySocket.current || proxySocket.current.__target !== attachedSocket) {
    proxySocket.current = new Proxy(attachedSocket, {
      get(target, prop, receiver) {
        if (prop === "isLeader") {
          return isLeader;
        }
        if (prop === "addEventListener") {
          return (eventName: string, listener: (...args: any[]) => void) => {
            if (!followerListenersRef.current.has(eventName)) {
              followerListenersRef.current.set(eventName, new Set());
            }
            followerListenersRef.current.get(eventName)!.add(listener);

            if (typeof target.addEventListener === "function") {
              target.addEventListener(eventName, listener);
            }
          };
        }
        if (prop === "removeEventListener") {
          return (eventName: string, listener: (...args: any[]) => void) => {
            followerListenersRef.current.get(eventName)?.delete(listener);

            if (typeof target.removeEventListener === "function") {
              target.removeEventListener(eventName, listener);
            }
          };
        }
        if (prop === "send") {
          return (data: any) => {
            if (isLeaderRef.current) {
              return typeof target.send === "function" ? target.send(data) : undefined;
            } else {
              // Follower tab: relay to leader tab over BroadcastChannel
              const serialized = typeof data === "string" ? data : JSON.stringify(data);
              channelRef.current?.postMessage({
                type: "RELAY_OUTBOUND",
                room,
                data: serialized,
              });
            }
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    proxySocket.current.__target = attachedSocket;
  }

  return proxySocket.current;
}

export default usePartySocket;
