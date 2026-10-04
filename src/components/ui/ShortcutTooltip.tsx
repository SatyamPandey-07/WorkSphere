"use client";

import React, { useState, useId } from "react";
import { usePlatformModifier } from "@/hooks/usePlatformModifier";
import { KeyboardShortcutBadge } from "./KeyboardShortcutBadge";

export interface ShortcutTooltipProps {
  children: React.ReactNode;
  content: string;
  shortcut: string;
  position?: "top" | "bottom" | "left" | "right";
  className?: string;
  delayMs?: number;
}

/**
 * Accessible tooltip that displays a descriptive label and platform-responsive keyboard shortcut on hover or focus.
 */
export function ShortcutTooltip({
  children,
  content,
  shortcut,
  position = "bottom",
  className = "",
  delayMs = 150,
}: ShortcutTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [timeoutId, setTimeoutId] = useState<NodeJS.Timeout | null>(null);
  const tooltipId = useId();
  const { formatShortcut } = usePlatformModifier();

  const showTooltip = () => {
    const id = setTimeout(() => setIsVisible(true), delayMs);
    setTimeoutId(id);
  };

  const hideTooltip = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      setTimeoutId(null);
    }
    setIsVisible(false);
  };

  const positionClasses = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  }[position];

  const fullLabel = `${content} (${formatShortcut(shortcut, { separator: " + " })})`;

  return (
    <div
      className={`relative inline-flex items-center ${className}`}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
    >
      {React.isValidElement(children) ? (
        React.cloneElement(children as React.ReactElement<any>, {
          "aria-describedby": isVisible ? tooltipId : undefined,
          "aria-keyshortcuts": `Control+${shortcut} Meta+${shortcut}`,
          title: (children.props as any)?.title || fullLabel,
        })
      ) : (
        <span>{children}</span>
      )}

      {isVisible && (
        <div
          id={tooltipId}
          role="tooltip"
          data-testid="shortcut-tooltip"
          className={`absolute z-[100] pointer-events-none flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-white bg-zinc-900/95 dark:bg-zinc-800/95 border border-white/10 rounded-lg shadow-xl backdrop-blur-sm whitespace-nowrap animate-in fade-in zoom-in-95 duration-150 ${positionClasses}`}
        >
          <span>{content}</span>
          <KeyboardShortcutBadge
            shortcut={shortcut}
            size="xs"
            variant="dark"
            className="border-white/20 bg-white/10 text-white"
          />
        </div>
      )}
    </div>
  );
}
