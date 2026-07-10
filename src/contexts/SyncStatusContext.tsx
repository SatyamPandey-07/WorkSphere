"use client";

import React, { createContext, useContext, useState, ReactNode } from "react";

export type SyncStatus = "Offline - Saved Locally" | "Connecting" | "Syncing..." | "Synced";

interface SyncStatusContextType {
  status: SyncStatus;
  setStatus: (status: SyncStatus) => void;
}

const SyncStatusContext = createContext<SyncStatusContextType | undefined>(undefined);

export function SyncStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SyncStatus>("Connecting");

  return (
    <SyncStatusContext.Provider value={{ status, setStatus }}>
      {children}
    </SyncStatusContext.Provider>
  );
}

export function useSyncStatus() {
  const context = useContext(SyncStatusContext);
  if (context === undefined) {
    throw new Error("useSyncStatus must be used within a SyncStatusProvider");
  }
  return context;
}
