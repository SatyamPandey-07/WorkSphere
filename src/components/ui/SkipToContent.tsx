"use client";

import React from "react";
import { cn } from "@/lib/utils";

export interface SkipToContentProps
  extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  targetId?: string;
  className?: string;
  children?: React.ReactNode;
}

/**
 * Accessible "Skip to Content" link satisfying WCAG 2.1 AA (Guideline 2.4.1).
 * Hidden visually until focused via keyboard navigation, allowing screen reader
 * and keyboard-only users to bypass repetitive navigation elements.
 */
export function SkipToContent({
  targetId = "main-content",
  className,
  children = "Skip to content",
  onClick,
  onKeyDown,
  ...props
}: SkipToContentProps) {
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    const target = document.getElementById(targetId);
    if (target) {
      if (!target.hasAttribute("tabindex")) {
        target.setAttribute("tabindex", "-1");
      }
      target.focus();
      target.scrollIntoView?.();
    }
    onClick?.(e);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLAnchorElement>) => {
    if (e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      const target = document.getElementById(targetId);
      if (target) {
        if (!target.hasAttribute("tabindex")) {
          target.setAttribute("tabindex", "-1");
        }
        target.focus();
        target.scrollIntoView?.();
      }
    }
    onKeyDown?.(e);
  };

  return (
    <a
      href={`#${targetId}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(
        "sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:px-4 focus:py-2 focus:bg-indigo-600 focus:text-white focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:ring-offset-2",
        className
      )}
      {...props}
    >
      {children}
    </a>
  );
}

export default SkipToContent;

