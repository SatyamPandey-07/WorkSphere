"use client";

import React, { useContext, useRef } from "react";
import { LayoutRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

export interface FrozenRouterProps {
  children: React.ReactNode;
  /** Whether to freeze the router context. If false, live context passes through. Default: true */
  enabled?: boolean;
}

/**
 * Wraps children in the currently active Next.js LayoutRouterContext upon mount.
 * When a page transition begins and the parent router swaps out the route context,
 * FrozenRouter retains the initial context so exit animations (e.g. via Framer Motion's AnimatePresence)
 * can finish rendering without being prematurely torn down or disrupted.
 */
export function FrozenRouter({ children, enabled = true }: FrozenRouterProps) {
  // If LayoutRouterContext is undefined in this environment, fallback to children
  if (!LayoutRouterContext || !LayoutRouterContext.Provider) {
    return <>{children}</>;
  }

  const context = useContext(LayoutRouterContext);
  const frozenRef = useRef(context);

  if (!enabled) {
    return (
      <LayoutRouterContext.Provider value={context}>
        {children}
      </LayoutRouterContext.Provider>
    );
  }

  return (
    <LayoutRouterContext.Provider value={frozenRef.current}>
      {children}
    </LayoutRouterContext.Provider>
  );
}

export default FrozenRouter;
