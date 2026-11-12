"use client";

import { useState, useEffect, ReactNode, Suspense, useRef, useCallback } from "react";
import { useUser } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import YProvider from "y-partykit/provider";
import * as Y from "yjs";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import {
  AwarenessProtocol,
  PeerPresenceState,
  FocusTimerState,
} from "@/core/crdt/AwarenessProtocol";

interface PartyKitPresenceWrapperProps {
  children: ReactNode;
  fallback?: ReactNode;
  deskId?: string;
  focusTimer?: FocusTimerState | null;
  trackCursor?: boolean;
}

function PresenceIndicator({
  deskId,
  focusTimer,
  trackCursor = false,
}: {
  deskId?: string;
  focusTimer?: FocusTimerState | null;
  trackCursor?: boolean;
}) {
  const { user, isSignedIn } = useUser();
  const searchParams = useSearchParams();
  const folderId = searchParams?.get("folderId") || "global";
  const roomId = `presence-room-${folderId}`;

  const [users, setUsers] = useState<any[]>([]);
  const awarenessProtocolRef = useRef<AwarenessProtocol | null>(null);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!trackCursor || !awarenessProtocolRef.current) return;
      awarenessProtocolRef.current.updateCursor({
        x: e.clientX,
        y: e.clientY,
      });
    },
    [trackCursor]
  );

  useEffect(() => {
    const doc = new Y.Doc();
    const host = process.env.NEXT_PUBLIC_PARTYKIT_HOST || "127.0.0.1:1999";
    const provider = new YProvider(host, roomId, doc);
    const awareness = provider.awareness;

    const protocol = new AwarenessProtocol(doc, awareness);
    awarenessProtocolRef.current = protocol;

    const localUserName =
      isSignedIn && user
        ? user.fullName || user.firstName || "Collaborator"
        : `Guest ${Math.floor(Math.random() * 1000)}`;

    const localUserAvatar = isSignedIn && user ? user.imageUrl : null;
    const localUserRole = isSignedIn ? "Member" : "Guest";

    const initialStatus = focusTimer?.isActive ? "focusing" : "active";

    // Set initial broadcast state including deskId, focus timer, and user info
    protocol.setLocalState({
      username: localUserName,
      avatar: localUserAvatar,
      deskId: deskId || null,
      focusTimer: focusTimer || null,
      status: initialStatus,
    });

    // Subscribe to awareness updates from peers
    const unsubscribe = protocol.onChange((activePeers) => {
      const activeList: any[] = [];
      activePeers.forEach((state) => {
        activeList.push({
          name: state.username,
          avatar: state.avatar,
          role: localUserRole,
          status: state.status,
          deskId: state.deskId,
          focusTimer: state.focusTimer,
          cursor: state.cursor,
        });
      });
      setUsers(activeList);
    });

    let idleTimeout: ReturnType<typeof setTimeout>;

    const resetIdleTimer = () => {
      clearTimeout(idleTimeout);
      const localState = protocol.getLocalState();
      if (localState?.status === "idle") {
        protocol.setLocalState({
          status: focusTimer?.isActive ? "focusing" : "active",
        });
      }

      idleTimeout = setTimeout(() => {
        const current = protocol.getLocalState();
        if (current && current.status !== "focusing") {
          protocol.setLocalState({
            status: "idle",
          });
        }
      }, 60000); // 1 minute idle
    };

    window.addEventListener("mousemove", resetIdleTimer);
    window.addEventListener("keydown", resetIdleTimer);
    window.addEventListener("click", resetIdleTimer);
    if (trackCursor) {
      window.addEventListener("mousemove", handleMouseMove);
    }

    resetIdleTimer();

    return () => {
      window.removeEventListener("mousemove", resetIdleTimer);
      window.removeEventListener("keydown", resetIdleTimer);
      window.removeEventListener("click", resetIdleTimer);
      if (trackCursor) {
        window.removeEventListener("mousemove", handleMouseMove);
      }
      clearTimeout(idleTimeout);
      unsubscribe();
      protocol.destroy();
      provider.destroy();
      doc.destroy();
      awarenessProtocolRef.current = null;
    };
  }, [
    user?.id,
    user?.fullName,
    user?.firstName,
    user?.imageUrl,
    isSignedIn,
    roomId,
    deskId,
    focusTimer,
    trackCursor,
    handleMouseMove,
  ]);

  if (users.length === 0) return null;

  return (
    <div className="flex items-center gap-2 mb-4 p-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm w-fit z-10">
      <span className="text-xs font-semibold text-zinc-500 mr-1">
        Active Now:
      </span>
      <div className="flex -space-x-2 overflow-hidden">
        <AnimatePresence>
          {users.map((u, i) => (
            <motion.div
              key={u.name + i}
              initial={{ opacity: 0, scale: 0.8, x: -10 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.8, x: 10 }}
              className="relative group cursor-pointer"
            >
              <div className="w-8 h-8 rounded-full border-2 border-white dark:border-zinc-900 bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                {u.avatar ? (
                  <Image
                    src={u.avatar}
                    alt={u.name}
                    width={32}
                    height={32}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs font-bold text-zinc-600 dark:text-zinc-300">
                    {u.name.substring(0, 2).toUpperCase()}
                  </div>
                )}
              </div>
              <span
                className={`absolute bottom-0 right-0 block h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-zinc-900 ${
                  u.status === "active"
                    ? "bg-green-500"
                    : u.status === "focusing"
                    ? "bg-purple-500"
                    : "bg-yellow-500"
                }`}
              />
              <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-1.5 bg-zinc-950/90 text-white text-xs rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50 border border-zinc-800 backdrop-blur-sm">
                <p className="font-bold">{u.name}</p>
                {u.deskId && (
                  <p className="text-[10px] text-zinc-300">Desk: {u.deskId}</p>
                )}
                {u.focusTimer?.isActive && (
                  <p className="text-[10px] text-purple-300">Focusing: {u.focusTimer.remainingSeconds}s</p>
                )}
                <p className="text-[10px] text-zinc-400 font-medium">
                  {u.role || "Member"}
                </p>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

export function PartyKitPresenceWrapper({
  children,
  fallback = null,
  deskId,
  focusTimer,
  trackCursor = false,
}: PartyKitPresenceWrapperProps) {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return <>{fallback}</>;
  }

  return (
    <>
      <Suspense fallback={null}>
        <PresenceIndicator
          deskId={deskId}
          focusTimer={focusTimer}
          trackCursor={trackCursor}
        />
      </Suspense>
      {children}
    </>
  );
}

export default PartyKitPresenceWrapper;
