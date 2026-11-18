"use client";

import React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ModalCloseButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  iconSize?: number;
}

/**
 * Standardized High-Contrast Modal Close Button component.
 * Provides accessible keyboard focus ring adhering to WCAG 1.4.11 (>3:1 contrast ratio)
 * and seamless keyboard accessibility for modal dialogs.
 */
export function ModalCloseButton({
  onClick,
  className,
  children,
  iconSize = 20,
  "aria-label": ariaLabel = "Close modal",
  ...props
}: ModalCloseButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={cn(
        "rounded-xl p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200",
        "hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors",
        "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:outline-none",
        className
      )}
      {...props}
    >
      {children || <X className="w-5 h-5" style={{ width: iconSize, height: iconSize }} />}
    </button>
  );
}

export default ModalCloseButton;
