"use client";

import React, { useContext, useRef } from "react";
import { LayoutRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

export function FrozenRouter({ children }: { children: React.ReactNode }) {
  const context = useContext(LayoutRouterContext ?? {});
  // eslint-disable-next-line react-hooks/refs
  const frozen = useRef(context).current;

  return (
    <LayoutRouterContext.Provider value={frozen}>
      {children}
    </LayoutRouterContext.Provider>
  );
}
