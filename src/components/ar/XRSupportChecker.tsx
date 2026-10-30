import React from "react";
import { useWebXR } from "../../hooks/useWebXR";

export interface XRSupportCheckerProps {
  children: React.ReactNode;
  fallback: React.ReactNode;
  loading?: React.ReactNode;
  overrideSupported?: boolean | null;
}

export function XRSupportChecker({
  children,
  fallback,
  loading = (
    <div
      role="status"
      aria-live="polite"
      data-testid="xr-support-loading"
      className="p-4 text-center text-sm text-gray-500 dark:text-zinc-400"
    >
      Checking AR support...
    </div>
  ),
  overrideSupported,
}: XRSupportCheckerProps) {
  const { isSupported: hookSupported } = useWebXR();

  const isSupported =
    overrideSupported !== undefined ? overrideSupported : hookSupported;

  if (isSupported === null) {
    return <>{loading}</>;
  }

  if (isSupported === false) {
    return (
      <div data-testid="xr-support-fallback" className="w-full h-full">
        {fallback}
      </div>
    );
  }

  return (
    <div data-testid="xr-support-content" className="w-full h-full">
      {children}
    </div>
  );
}

export default XRSupportChecker;
