"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};

/**
 * True on the client after this component has hydrated; false during SSR (#1033).
 */
export function useIsHydrated(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

/**
 * True only after React hydration completes (post-useEffect).
 * Use this to defer WebSocket listeners so App Router streaming chunks are
 * not interleaved with client setState from push traffic (#1033).
 */
export function useHydrationComplete(): boolean {
  const isHydrated = useIsHydrated();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isHydrated) return;
    setReady(true);
  }, [isHydrated]);

  return isHydrated && ready;
}
