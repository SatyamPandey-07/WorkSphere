"use client";

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { motion, useSpring, useMotionValue } from "framer-motion";
import { SpatialAudioPanner } from "@/core/audio/SpatialAudioPanner";

export interface RemoteParticipantCursor {
  id: string;
  x: number;
  y: number;
  name?: string;
  avatar?: string;
  color?: string;
  audioStream?: MediaStream;
}

export interface VirtualCoworkingCanvasProps {
  roomId: string;
  currentUserId: string;
  userName?: string;
  userColor?: string;
  socket?: WebSocket | {
    send: (data: string) => void;
    addEventListener: (type: string, listener: any) => void;
    removeEventListener: (type: string, listener: any) => void;
    readyState?: number;
  };
  audioContext?: AudioContext;
  remoteStreams?: Map<string, MediaStream>;
  onCursorMove?: (x: number, y: number) => void;
  width?: number;
  height?: number;
}

// Default participant cursor colors
const CURSOR_COLORS = [
  "#3B82F6", // blue
  "#10B981", // green
  "#8B5CF6", // purple
  "#F59E0B", // amber
  "#EC4899", // pink
  "#06B6D4", // cyan
  "#EF4444", // red
  "#14B8A6", // teal
];

function getParticipantColor(id: string, customColor?: string): string {
  if (customColor) return customColor;
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
  }
  const index = Math.abs(hash) % CURSOR_COLORS.length;
  return CURSOR_COLORS[index];
}

// Single remote cursor rendered with Framer Motion spring physics
export const RemoteCursorView: React.FC<{
  cursor: RemoteParticipantCursor;
}> = ({ cursor }) => {
  const color = getParticipantColor(cursor.id, cursor.color);

  // Framer Motion spring physics for smooth interpolation
  // Stiffness & damping reduce jitter from network updates without introducing high lag
  const springConfig = { damping: 25, stiffness: 250, mass: 0.5 };
  const springX = useSpring(cursor.x, springConfig);
  const springY = useSpring(cursor.y, springConfig);

  useEffect(() => {
    springX.set(cursor.x);
    springY.set(cursor.y);
  }, [cursor.x, cursor.y, springX, springY]);

  return (
    <motion.div
      style={{
        position: "absolute",
        left: springX,
        top: springY,
        pointerEvents: "none",
        zIndex: 50,
      }}
      data-testid={`remote-cursor-${cursor.id}`}
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.6 }}
      transition={{ duration: 0.15 }}
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="filter drop-shadow-md"
      >
        <path
          d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L6.35 2.85a.5.5 0 0 0-.85.36z"
          fill={color}
        />
      </svg>
      <div
        className="px-2 py-0.5 rounded text-xs text-white font-medium shadow-sm whitespace-nowrap mt-1"
        style={{ backgroundColor: color }}
        data-testid={`remote-cursor-label-${cursor.id}`}
      >
        {cursor.name || `User ${cursor.id.slice(0, 4)}`}
      </div>
    </motion.div>
  );
};

export const VirtualCoworkingCanvas: React.FC<VirtualCoworkingCanvasProps> = ({
  roomId,
  currentUserId,
  userName = "Me",
  userColor = "#3B82F6",
  socket,
  audioContext: externalAudioContext,
  remoteStreams,
  onCursorMove,
  width = 1200,
  height = 800,
}) => {
  const [remoteCursors, setRemoteCursors] = useState<Map<string, RemoteParticipantCursor>>(new Map());
  const [localPos, setLocalPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Throttling for local 30Hz broadcasting
  const lastSendTimeRef = useRef<number>(0);
  const lastSentPosRef = useRef<{ x: number; y: number } | null>(null);
  const pendingThrottleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPosRef = useRef<{ x: number; y: number } | null>(null);

  // Keep latest dependencies in refs so throttled callbacks never capture stale props
  const socketRef = useRef(socket);
  socketRef.current = socket;
  const userNameRef = useRef(userName);
  userNameRef.current = userName;
  const userColorRef = useRef(userColor);
  userColorRef.current = userColor;

  // Spatial audio panner management
  const audioContextRef = useRef<AudioContext | null>(null);
  const pannerRef = useRef<SpatialAudioPanner | null>(null);

  // Initialize SpatialAudioPanner with required inverse distance model config
  useEffect(() => {
    let ctx = externalAudioContext;
    let isInternalCtx = false;

    if (!ctx && typeof window !== "undefined" && (window.AudioContext || (window as any).webkitAudioContext)) {
      try {
        const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
        ctx = new AudioCtxClass();
        isInternalCtx = true;
      } catch {
        // audio context init failed or not permitted
      }
    }

    if (ctx) {
      audioContextRef.current = ctx;
      // Configure Panner with exact required options:
      // distanceModel = 'inverse', refDistance = 100, maxDistance = 1000, rolloffFactor = 1.5
      pannerRef.current = new SpatialAudioPanner(ctx, "inverse", { enabled: false }, {
        distanceModel: "inverse",
        refDistance: 100,
        maxDistance: 1000,
        rolloffFactor: 1.5,
      });

      // Set listener position to center of canvas initially
      pannerRef.current.updateListenerPosition(0, 0, 0, 0, 0, -1);
    }

    return () => {
      if (pannerRef.current) {
        pannerRef.current.destroy();
        pannerRef.current = null;
      }
      if (isInternalCtx && ctx && ctx.state !== "closed") {
        try {
          ctx.close();
        } catch {}
      }
    };
  }, [externalAudioContext]);

  // Handle media streams synchronization with spatial audio
  useEffect(() => {
    if (!pannerRef.current || !remoteStreams) return;

    for (const [peerId, stream] of remoteStreams.entries()) {
      if (peerId !== currentUserId) {
        pannerRef.current.addPeer(peerId, stream);
        const cursor = remoteCursors.get(peerId);
        if (cursor) {
          // Convert 2D canvas coordinates to audio coordinates
          pannerRef.current.updatePeerPosition(peerId, cursor.x, cursor.y, 0);
        }
      }
    }
  }, [remoteStreams, currentUserId, remoteCursors]);

  // Handle incoming socket messages
  const handleMessage = useCallback((event: MessageEvent | { data: string }) => {
    try {
      const data = typeof event.data === "string" ? JSON.parse(event.data) : null;
      if (!data || !data.type) return;

      if (data.type === "cursor_pos") {
        if (!data.id || data.id === currentUserId) return;
        setRemoteCursors((prev) => {
          const next = new Map(prev);
          const existing = next.get(data.id);
          next.set(data.id, {
            id: data.id,
            x: data.x,
            y: data.y,
            name: data.metadata?.name || existing?.name,
            avatar: data.metadata?.avatar || existing?.avatar,
            color: data.metadata?.color || existing?.color,
          });
          return next;
        });

        // Update spatial audio position
        if (pannerRef.current) {
          pannerRef.current.updatePeerPosition(data.id, data.x, data.y, 0);
        }
      } else if (data.type === "cursor_delta") {
        if (!data.id || data.id === currentUserId) return;
        setRemoteCursors((prev) => {
          const next = new Map(prev);
          const existing = next.get(data.id);
          if (existing) {
            const updatedX = existing.x + data.dx;
            const updatedY = existing.y + data.dy;
            next.set(data.id, {
              ...existing,
              x: updatedX,
              y: updatedY,
            });
            if (pannerRef.current) {
              pannerRef.current.updatePeerPosition(data.id, updatedX, updatedY, 0);
            }
          }
          return next;
        });
      } else if (data.type === "sync_participants") {
        if (Array.isArray(data.participants)) {
          setRemoteCursors((prev) => {
            const next = new Map(prev);
            for (const p of data.participants) {
              if (p.id !== currentUserId) {
                next.set(p.id, {
                  id: p.id,
                  x: p.cursor.x,
                  y: p.cursor.y,
                  name: p.metadata?.name,
                  avatar: p.metadata?.avatar,
                  color: p.metadata?.color,
                });
                if (pannerRef.current) {
                  pannerRef.current.updatePeerPosition(p.id, p.cursor.x, p.cursor.y, 0);
                }
              }
            }
            return next;
          });
        }
      } else if (data.type === "participant_left") {
        if (data.id) {
          setRemoteCursors((prev) => {
            if (!prev.has(data.id)) return prev;
            const next = new Map(prev);
            next.delete(data.id);
            return next;
          });
          // Clean up audio node immediately
          if (pannerRef.current) {
            pannerRef.current.removePeer(data.id);
          }
        }
      }
    } catch {
      // Ignore malformed messages
    }
  }, [currentUserId]);

  useEffect(() => {
    if (!socket) return;
    socket.addEventListener("message", handleMessage);
    return () => {
      socket.removeEventListener("message", handleMessage);
    };
  }, [socket, handleMessage]);

  // Local cursor broadcasting throttled to 30Hz
  const sendCursorPosition = useCallback((x: number, y: number, forceFull = false) => {
    const currentSocket = socketRef.current;
    if (!currentSocket) return;
    const now = Date.now();
    const minInterval = 1000 / 30; // 33.3ms for 30Hz
    const timeSince = now - lastSendTimeRef.current;

    const broadcast = (posX: number, posY: number, full: boolean) => {
      lastSendTimeRef.current = Date.now();
      const last = lastSentPosRef.current;

      if (!full && last) {
        const dx = posX - last.x;
        const dy = posY - last.y;
        if (dx === 0 && dy === 0) {
          return;
        }

        currentSocket.send(
          JSON.stringify({
            type: "cursor_delta",
            dx: Math.round(dx * 100) / 100,
            dy: Math.round(dy * 100) / 100,
          })
        );
      } else {
        currentSocket.send(
          JSON.stringify({
            type: "cursor_pos",
            x: Math.round(posX * 100) / 100,
            y: Math.round(posY * 100) / 100,
            metadata: { name: userNameRef.current, color: userColorRef.current },
          })
        );
      }
      lastSentPosRef.current = { x: posX, y: posY };
    };

    if (timeSince >= minInterval || lastSentPosRef.current === null) {
      if (pendingThrottleTimerRef.current) {
        clearTimeout(pendingThrottleTimerRef.current);
        pendingThrottleTimerRef.current = null;
        pendingPosRef.current = null;
      }
      broadcast(x, y, forceFull);
    } else {
      pendingPosRef.current = { x, y };
      if (!pendingThrottleTimerRef.current) {
        const delay = Math.max(1, Math.ceil(minInterval - timeSince));
        pendingThrottleTimerRef.current = setTimeout(() => {
          pendingThrottleTimerRef.current = null;
          if (pendingPosRef.current) {
            const target = pendingPosRef.current;
            pendingPosRef.current = null;
            broadcast(target.x, target.y, false);
          }
        }, delay);
      }
    }
  }, []);

  // Handle local pointer move
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>) => {
    const clientX = (e as any).clientX ?? (e.nativeEvent as any)?.clientX ?? 0;
    const clientY = (e as any).clientY ?? (e.nativeEvent as any)?.clientY ?? 0;
    let rawX = clientX;
    let rawY = clientY;
    if (typeof (e.currentTarget as any)?.getBoundingClientRect === "function") {
      const rect = e.currentTarget.getBoundingClientRect();
      if (rect && Number.isFinite(rect.left) && rect.left !== 0) {
        rawX -= rect.left;
      }
      if (rect && Number.isFinite(rect.top) && rect.top !== 0) {
        rawY -= rect.top;
      }
    }

    const x = Math.max(0, Math.min(width, Number.isFinite(rawX) ? rawX : 0));
    const y = Math.max(0, Math.min(height, Number.isFinite(rawY) ? rawY : 0));

    // Instant local cursor feedback (zero latency)
    setLocalPos({ x, y });

    // Update listener position in spatial audio so self is the listener
    if (pannerRef.current) {
      pannerRef.current.updateListenerPosition(x, y, 0, 0, 0, -1);
    }

    if (onCursorMove) {
      onCursorMove(x, y);
    }

    sendCursorPosition(x, y);
  };

  // Cleanup pending timers on unmount
  useEffect(() => {
    return () => {
      // Do not clear the throttle timer on re-render, only when unmounting
      if (pendingThrottleTimerRef.current) {
        clearTimeout(pendingThrottleTimerRef.current);
        pendingThrottleTimerRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      onPointerMove={handlePointerMove}
      onMouseMove={handlePointerMove}
      className="relative bg-slate-900 border border-slate-800 rounded-lg overflow-hidden select-none cursor-crosshair shadow-inner"
      style={{ width: `${width}px`, height: `${height}px` }}
      data-testid="virtual-coworking-canvas"
    >
      {/* Background grid canvas decoration */}
      <div
        className="absolute inset-0 opacity-10 pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(#94a3b8 1px, transparent 1px), radial-gradient(#94a3b8 1px, #0f172a 1px)",
          backgroundSize: "20px 20px",
          backgroundPosition: "0 0, 10px 10px",
        }}
      />

      {/* Local participant indicator */}
      <div
        className="absolute pointer-events-none z-10 w-3 h-3 rounded-full border-2 border-white"
        style={{
          left: localPos.x - 6,
          top: localPos.y - 6,
          backgroundColor: userColor,
        }}
        data-testid="local-cursor"
      />

      {/* Remote participant cursors with Framer Motion spring physics */}
      {Array.from(remoteCursors.values()).map((cursor) => (
        <RemoteCursorView key={cursor.id} cursor={cursor} />
      ))}
    </div>
  );
};

export default VirtualCoworkingCanvas;
