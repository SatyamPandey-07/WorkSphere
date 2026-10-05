"use client";

import React, { useRef } from "react";
import { useFocusTrap, UseFocusTrapOptions } from "@/hooks/useFocusTrap";

export interface FocusTrapProps extends UseFocusTrapOptions {
  children: React.ReactNode;
  className?: string;
  as?: keyof JSX.IntrinsicElements;
  role?: string;
  "aria-modal"?: boolean | "true" | "false";
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}

export function FocusTrap({
  children,
  className = "",
  as: Component = "div",
  isActive = true,
  initialFocusRef,
  initialFocusSelector,
  returnFocus = true,
  onEscape,
  role = "dialog",
  "aria-modal": ariaModal = true,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  ...rest
}: FocusTrapProps) {
  const containerRef = useRef<HTMLElement | null>(null);

  useFocusTrap(containerRef, {
    isActive,
    initialFocusRef,
    initialFocusSelector,
    returnFocus,
    onEscape,
  });

  return (
    <Component
      ref={containerRef}
      role={role}
      aria-modal={ariaModal}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      className={className}
      {...rest}
    >
      {children}
    </Component>
  );
}
