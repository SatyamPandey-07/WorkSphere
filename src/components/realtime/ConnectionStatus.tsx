"use client";

import React from "react";

export interface ConnectionStatusProps {
  isConnected: boolean;
}

/**
 * Connection status indicator component
 */
export function ConnectionStatus({ isConnected }: ConnectionStatusProps) {
  if (isConnected) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
        <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        Live
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
      <span className="w-2 h-2 bg-amber-500 rounded-full" />
      Reconnecting...
    </div>
  );
}

export default ConnectionStatus;
