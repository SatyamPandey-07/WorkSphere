"use client";

import { useEffect, useState } from "react";

export const OPEN_COMMAND_PALETTE_EVENT = "worksphere:open-command-palette";
export const TOGGLE_CHATBOT_EVENT = "worksphere:toggle-chatbot";

/**
 * Pure function to detect macOS / iOS platform from userAgent or platform string.
 */
export function isMacPlatform(userAgent?: string, platform?: string): boolean {
  if (typeof window === "undefined" && !userAgent && !platform) {
    return false;
  }
  const ua = userAgent || (typeof navigator !== "undefined" ? navigator.userAgent : "");
  const plat = platform || (typeof navigator !== "undefined" ? (navigator as any).userAgentData?.platform || navigator.platform : "");
  return /(Mac|iPhone|iPod|iPad)/i.test(ua) || /(Mac|iPhone|iPod|iPad)/i.test(plat);
}

/**
 * Returns the platform modifier configuration synchronously.
 */
export function getPlatformModifier(userAgent?: string, platform?: string) {
  const isMac = isMacPlatform(userAgent, platform);
  return {
    isMac,
    modifierSymbol: isMac ? "⌘" : "Ctrl",
    modifierLabel: isMac ? "Cmd" : "Ctrl",
    modifierKey: isMac ? "Meta" : "Control",
  };
}

/**
 * Dispatches an event to open the global search / command palette.
 */
export function openCommandPalette() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(OPEN_COMMAND_PALETTE_EVENT));
  }
}

/**
 * Dispatches an event to toggle the chatbot sidebar / drawer.
 */
export function toggleChatbot() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(TOGGLE_CHATBOT_EVENT));
  }
}

/**
 * React hook to access platform-adapted modifier keys (Cmd on macOS, Ctrl on Windows/Linux).
 * Designed to prevent SSR hydration mismatches by initializing safely and updating on mount.
 */
export function usePlatformModifier() {
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(isMacPlatform());
  }, []);

  const modifierSymbol = isMac ? "⌘" : "Ctrl";
  const modifierLabel = isMac ? "Cmd" : "Ctrl";
  const modifierKey = isMac ? "Meta" : "Control";

  /**
   * Formats a shortcut combination for display (e.g., "Ctrl + K" or "⌘K").
   */
  const formatShortcut = (
    key: string,
    options?: { symbol?: boolean; separator?: string },
  ): string => {
    const { symbol = false, separator = " + " } = options || {};
    if (isMac) {
      return symbol ? `⌘${key}` : `Cmd${separator}${key}`;
    }
    return `Ctrl${separator}${key}`;
  };

  /**
   * Formats standard W3C aria-keyshortcuts value.
   */
  const getAriaKeyshortcuts = (key: string): string => {
    return `Control+${key} Meta+${key}`;
  };

  return {
    isMac,
    modifierSymbol,
    modifierLabel,
    modifierKey,
    formatShortcut,
    getAriaKeyshortcuts,
  };
}
