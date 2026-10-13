"use client";

import React, { RefObject } from "react";
import {
  useScrollProgress,
  UseScrollProgressOptions,
} from "@/hooks/useScrollProgress";

export interface ScrollProgressProps {
  className?: string;
  targetRef?: RefObject<HTMLElement | null>;
  options?: UseScrollProgressOptions;
  showAccessibleRole?: boolean;
}

export function ScrollProgress({
  className = "",
  targetRef,
  options,
  showAccessibleRole = false,
}: ScrollProgressProps = {}) {
  const scrollOptions = options ?? (targetRef ? { targetRef } : undefined);
  const progress = useScrollProgress(scrollOptions);
  const roundedProgress = Math.round(progress);

  return (
    <div
      data-testid="scroll-progress-bar"
      className={`fixed top-0 left-0 right-auto h-1 accent-bg z-50 pointer-events-none transition-all duration-75 ${className}`}
      style={{ width: `${progress}%` }}
      role={showAccessibleRole ? "progressbar" : undefined}
      aria-valuenow={showAccessibleRole ? roundedProgress : undefined}
      aria-valuemin={showAccessibleRole ? 0 : undefined}
      aria-valuemax={showAccessibleRole ? 100 : undefined}
      aria-label={showAccessibleRole ? "Scroll Progress" : undefined}
      aria-hidden={showAccessibleRole ? undefined : "true"}
    />
  );
}

export default ScrollProgress;
