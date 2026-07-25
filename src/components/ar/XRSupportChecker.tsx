import React from "react";
import { useWebXR } from "../../hooks/useWebXR";

interface Props {
  children: React.ReactNode;
  fallback: React.ReactNode;
  loading?: React.ReactNode;
}

export function XRSupportChecker({
  children,
  fallback,
  loading = <div>Checking AR support...</div>,
}: Props) {
  const { isSupported } = useWebXR();

  if (isSupported === null) {
    return <>{loading}</>;
  }

  if (isSupported === false) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
