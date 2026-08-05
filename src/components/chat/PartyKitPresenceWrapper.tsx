"use client";

import { useState, useEffect, ReactNode, Suspense } from "react";
import { useUser } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import YProvider from "y-partykit/provider";
import * as Y from "yjs";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";

interface PartyKitPresenceWrapperProps {
  children: ReactNode;
  fallback?: ReactNode;
}

function PresenceIndicator() {
  const { user, isSignedIn } = useUser();
  const searchParams = useSearchParams();
  const folderId = searchParams?.get("folderId") || "global";
  const roomId = `presence-room-${folderId}`;

  const [users, setUsers] = useState<any[]>([]);

  useEffect(() => {
    const doc = new Y.Doc();
    const host = process.env.NEXT_PUBLIC_PARTYKIT_HOST || "127.0.0.1:1999";
    const provider = new YProvider(host, roomId, doc);
    const awareness = provider.awareness;

    const localUserName =
      isSignedIn && user
        ? user.fullName || user.firstName || "Collaborator"
        : `Guest ${Math.floor(Math.random() * 1000)}`;

    const localUserAvatar = isSignedIn && user ? user.imageUrl : null;
    const localUserRole = isSignedIn ? "Member" : "Guest";

    awareness.setLocalState({
      user: {
        name: localUserName,
        avatar: localUserAvatar,
        role: localUserRole,
        status: "active",
      },
    });

    const handleAwarenessChange = () => {
      const states = Array.from(awareness.getStates().values());
      const activeUsers = states.map((s: any) => s.user).filter(Boolean);
      setUsers(activeUsers);
    };

    awareness.on("change", handleAwarenessChange);
    handleAwarenessChange();

    let idleTimeout: ReturnType<typeof setTimeout>;

    const resetIdleTimer = () => {
      clearTimeout(idleTimeout);
      const localState = awareness.getLocalState();
      if (localState?.user?.status !== "active") {
        awareness.setLocalState({
          ...localState,
          user: {
            ...localState?.user,
            status: "active",
          },
        });
      }

      idleTimeout = setTimeout(() => {
        const currentLocalState = awareness.getLocalState();
        if (currentLocalState) {
          awareness.setLocalState({
            ...currentLocalState,
            user: {
              ...currentLocalState.user,
              status: "idle",
            },
          });
        }
      }, 60000); // 1 minute idle
    };

    window.addEventListener("mousemove", resetIdleTimer);
    window.addEventListener("keydown", resetIdleTimer);
    window.addEventListener("click", resetIdleTimer);

    resetIdleTimer();

    return () => {
      window.removeEventListener("mousemove", resetIdleTimer);
      window.removeEventListener("keydown", resetIdleTimer);
      window.removeEventListener("click", resetIdleTimer);
      clearTimeout(idleTimeout);
      awareness.off("change", handleAwarenessChange);
      provider.destroy();
      doc.destroy();
    };
    // Depend on primitives derived from `user`, not the object itself — a
    // hook returning a fresh object each render (as some environments do)
    // would otherwise re-run this effect every render, tearing down and
    // recreating the PartyKit connection in a tight loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    user?.id,
    user?.fullName,
    user?.firstName,
    user?.imageUrl,
    isSignedIn,
    roomId,
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
                  u.status === "active" ? "bg-green-500" : "bg-yellow-500"
                }`}
              />
              <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-1.5 bg-zinc-950/90 text-white text-xs rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50 border border-zinc-800 backdrop-blur-sm">
                <p className="font-bold">{u.name}</p>
                <p className="text-[10px] text-zinc-400 font-medium">
                  {u.role}
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
        <PresenceIndicator />
      </Suspense>
      {children}
    </>
  );
}
