"use client";

import { useState, useEffect, ReactNode } from "react";

interface PartyKitPresenceWrapperProps {
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * Client-only wrapper for PartyKit presence & socket indicators (#912).
 * Isolates WebSocket state changes from Next.js 16 App Router streaming SSR hydration.
 */
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

  return <>{children}</>;
}
