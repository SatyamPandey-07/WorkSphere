"use client";

import React, { useRef } from "react";
import { cn } from "@/lib/utils";
import { useFocusTrap, UseFocusTrapOptions } from "@/hooks/useFocusTrap";

export interface FocusTrapProps extends UseFocusTrapOptions {
  children: React.ReactNode;
  className?: string;
  as?: keyof React.JSX.IntrinsicElements;
  role?: string;
  "aria-modal"?: boolean | "true" | "false";
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "data-testid"?: string;
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
  // A union of every intrinsic tag collapses its props to `never`; render
  // through a generic element type instead.
  const Tag = Component as React.ElementType;

  useFocusTrap(containerRef, {
    isActive,
    initialFocusRef,
    initialFocusSelector,
    returnFocus,
    onEscape,
  });

  return (
    <Tag
      ref={containerRef}
      role={role}
      aria-modal={ariaModal}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      data-testid={rest["data-testid"] || "focus-trap"}
      className={cn(className)}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export default FocusTrap;
