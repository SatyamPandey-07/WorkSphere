"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import usePartySocketReact from "partysocket/react";
import { useAuth } from "@clerk/nextjs";
import {
  attachJitteredBackoff,
  PARTY_SOCKET_RECONNECT_OPTIONS,
} from "@/lib/partySocketReconnect";
import {
  calculateJitteredBackoff,
  type CalculateJitteredBackoffOptions,
} from "@/lib/utils/backoff";
import {
  ConnectionLifecycleState,
  mapPartySocketToLifecycleState,
} from "@/lib/realtime/connectionState";

export {
  calculateJitteredBackoff,
  type CalculateJitteredBackoffOptions,
  ConnectionLifecycleState,
};

export type PartySocketOptions = Parameters<typeof usePartySocketReact>[0] & {
  disableLeaderElection?: boolean;
  baseDelay?: number;
  maxDelay?: number;
  onConnectionStatusChange?: (
    status: "connected" | "reconnecting" | "offline",
  ) => void;
  onLifecycleStateChange?: (state: ConnectionLifecycleState) => void;
};

export type ConnectionStatus = "connected" | "reconnecting" | "offline";

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
 * 1. Multi-tab leadership coordination via BroadcastChannel (only 1 active WebSocket connection) (#3767).
 * 2. Full-jitter exponential backoff on disconnection up to a 30s cap (#3769).
 * 3. Connection status indicator support ("Reconnecting...").
 * 4. Message handshake retry counter resets.
 * 5. Automatic leader election and smooth transfer on tab close.
 * 6. Token re-authentication interceptor (Clerk 4001).
 * 7. Reconnect loop prevention on rapid network toggles (#3937).
 */
export function usePartySocket(options: PartySocketOptions) {
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

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

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("offline");
  const [reconnectAttempt, setReconnectAttempt] = useState<number>(0);
  const reconnectAttemptRef = useRef<number>(0);

  const {
    baseDelay = PARTY_SOCKET_RECONNECT_OPTIONS.minReconnectionDelay,
    maxDelay = PARTY_SOCKET_RECONNECT_OPTIONS.maxReconnectionDelay,
    onConnectionStatusChange,
    ...socketOptions
  } = options;

  const onConnectionStatusChangeRef = useRef(onConnectionStatusChange);
  onConnectionStatusChangeRef.current = onConnectionStatusChange;

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

    // Reconnection controller & debounced state transition lock (#3937)
    const reconnectAbortControllerRef = { current: null as AbortController | null };
    let reconnectDebounceTimer: NodeJS.Timeout | null = null;
    let isTransitionLocked = false;

    // Online/network flapping handler
    const handleOnline = () => {
      // 1. Cancel existing scheduled reconnection timers and abort previous controller
      if (reconnectDebounceTimer) {
        clearTimeout(reconnectDebounceTimer);
        reconnectDebounceTimer = null;
      }
      if (reconnectAbortControllerRef.current) {
        reconnectAbortControllerRef.current.abort();
      }
      const controller = new AbortController();
      reconnectAbortControllerRef.current = controller;

      // 2. Debounced connection state transition lock to coalesce rapid network flapping
      reconnectDebounceTimer = setTimeout(() => {
        reconnectDebounceTimer = null;
        if (controller.signal.aborted) return;

        if (isTransitionLocked) return;
        isTransitionLocked = true;

        if (!isLeaderRef.current && Date.now() - lastLeaderHeartbeatRef.current > HEARTBEAT_TIMEOUT_MS) {
          setIsLeader(true);
          channel.postMessage({
            type: "LEADER_CLAIM",
            tabId,
            room,
            timestamp: Date.now(),
          });
        }

        setTimeout(() => {
          isTransitionLocked = false;
        }, 300);
      }, 150);
    };

    window.addEventListener("online", handleOnline);

    return () => {
      if (reconnectDebounceTimer) {
        clearTimeout(reconnectDebounceTimer);
        reconnectDebounceTimer = null;
      }
      if (reconnectAbortControllerRef.current) {
        reconnectAbortControllerRef.current.abort();
        reconnectAbortControllerRef.current = null;
      }
      window.removeEventListener("online", handleOnline);

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
    ...socketOptions,
    startClosed: !isLeader || options.startClosed,
  });

  const attachedSocket = useMemo(() => {
    const s = attachJitteredBackoff(socket);
    if (s) {
      (s as any)._getNextDelay = function () {
        const attempt = (this._retryCount ?? 0) + 1;
        return calculateJitteredBackoff(attempt, { baseDelay, maxDelay });
      };
    }
    return s;
  }, [socket, baseDelay, maxDelay]);

  // Leader tab: relay inbound messages & connection state across BroadcastChannel
  useEffect(() => {
    if (!isLeader || !attachedSocket) return;

    const handleLeaderOpen = () => {
      reconnectAttemptRef.current = 0;
      setReconnectAttempt(0);
      setConnectionStatus("connected");
      onConnectionStatusChangeRef.current?.("connected");

      channelRef.current?.postMessage({
        type: "RELAY_STATE",
        room,
        event: "open",
      });
    };

    const handleLeaderClose = (ev: any) => {
      reconnectAttemptRef.current += 1;
      setReconnectAttempt(reconnectAttemptRef.current);
      setConnectionStatus("reconnecting");
      onConnectionStatusChangeRef.current?.("reconnecting");

      channelRef.current?.postMessage({
        type: "RELAY_STATE",
        room,
        event: "close",
        details: { code: ev?.code, reason: ev?.reason },
      });
    };

    const handleLeaderMessage = (ev: any) => {
      if (reconnectAttemptRef.current > 0) {
        reconnectAttemptRef.current = 0;
        setReconnectAttempt(0);
      }
      setConnectionStatus("connected");

      channelRef.current?.postMessage({
        type: "RELAY_INBOUND",
        room,
        data: typeof ev.data === "string" ? ev.data : JSON.stringify(ev.data),
      });
    };

    const handleError = () => {
      setConnectionStatus("reconnecting");
      onConnectionStatusChangeRef.current?.("reconnecting");
    };

    (attachedSocket as any).addEventListener?.("open", handleLeaderOpen);
    (attachedSocket as any).addEventListener?.("close", handleLeaderClose);
    (attachedSocket as any).addEventListener?.("message", handleLeaderMessage);
    (attachedSocket as any).addEventListener?.("error", handleError);

    if ((attachedSocket as any).readyState === 1) {
      setConnectionStatus("connected");
    }

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
      (attachedSocket as any).removeEventListener?.("error", handleError);
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
          const freshToken = await getTokenRef.current({ skipCache: true });
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
  }, [attachedSocket]);

  // Return augmented socket proxy supporting followers & status
  const proxySocket = useRef<any>(null);
  const proxyTargetRef = useRef<any>(null);
  if (!proxySocket.current || proxyTargetRef.current !== attachedSocket) {
    proxySocket.current = new Proxy(attachedSocket, {
      get(target, prop, receiver) {
        if (prop === "isLeader") {
          return isLeaderRef.current;
        }
        if (prop === "connectionStatus") {
          return connectionStatus;
        }
        if (prop === "isReconnecting") {
          return connectionStatus === "reconnecting";
        }
        if (prop === "reconnectAttempt") {
          return reconnectAttempt;
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
    proxyTargetRef.current = attachedSocket;
  }

  return proxySocket.current;
}

export default usePartySocket;
