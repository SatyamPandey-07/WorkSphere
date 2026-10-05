"use client";

import { useEffect, useRef, useCallback, RefObject } from "react";

export interface UseFocusTrapOptions {
  /** Whether the focus trap is actively enabled (default: true) */
  isActive?: boolean;
  /** Optional initial element to focus on mount/activation */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Optional selector to find the initial focus element */
  initialFocusSelector?: string;
  /** Whether to return focus to the trigger element on unmount/deactivation (default: true) */
  returnFocus?: boolean;
  /** Callback fired when Escape key is pressed */
  onEscape?: () => void;
}

const FOCUSABLE_SELECTORS = [
  'a[href]:not([tabindex="-1"]):not([disabled])',
  'button:not([tabindex="-1"]):not([disabled])',
  'textarea:not([tabindex="-1"]):not([disabled])',
  'input:not([tabindex="-1"]):not([disabled])',
  'select:not([tabindex="-1"]):not([disabled])',
  '[tabindex]:not([tabindex="-1"]):not([disabled])',
  '[contenteditable="true"]:not([tabindex="-1"])',
].join(", ");

export function useFocusTrap<T extends HTMLElement = HTMLElement>(
  containerRef: RefObject<T | null>,
  options: UseFocusTrapOptions = {},
) {
  const {
    isActive = true,
    initialFocusRef,
    initialFocusSelector,
    returnFocus = true,
    onEscape,
  } = options;

  const previousFocusedElementRef = useRef<HTMLElement | null>(null);

  const getFocusableElements = useCallback((): HTMLElement[] => {
    if (!containerRef.current) return [];
    const elements = Array.from(
      containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS),
    );
    return elements.filter(
      (el) =>
        !el.hasAttribute("disabled") &&
        el.getAttribute("aria-hidden") !== "true" &&
        el.getClientRects().length > 0,
    );
  }, [containerRef]);

  useEffect(() => {
    if (!isActive) return;

    // Save current active element to restore later
    if (typeof document !== "undefined") {
      previousFocusedElementRef.current = document.activeElement as HTMLElement | null;
    }

    // Set initial focus
    const focusInitial = () => {
      if (initialFocusRef?.current) {
        initialFocusRef.current.focus();
        return;
      }

      if (containerRef.current && initialFocusSelector) {
        const customEl = containerRef.current.querySelector<HTMLElement>(
          initialFocusSelector,
        );
        if (customEl) {
          customEl.focus();
          return;
        }
      }

      const focusable = getFocusableElements();
      if (focusable.length > 0) {
        focusable[0].focus();
      } else if (containerRef.current) {
        // Fallback: make container focusable if it has no interactive children
        if (!containerRef.current.hasAttribute("tabindex")) {
          containerRef.current.setAttribute("tabindex", "-1");
        }
        containerRef.current.focus();
      }
    };

    // Small timeout to allow DOM animations/transitions to settle
    const timer = setTimeout(focusInitial, 20);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (onEscape) {
          e.preventDefault();
          e.stopPropagation();
          onEscape();
        }
        return;
      }

      if (e.key !== "Tab") return;

      const focusable = getFocusableElements();
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      const firstElement = focusable[0];
      const lastElement = focusable[focusable.length - 1];
      const currentActive = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        // Shift + Tab: if on first element or outside, cycle to last
        if (currentActive === firstElement || !containerRef.current?.contains(currentActive)) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        // Tab: if on last element or outside, cycle to first
        if (currentActive === lastElement || !containerRef.current?.contains(currentActive)) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", handleKeyDown, true);

      if (returnFocus && previousFocusedElementRef.current) {
        try {
          previousFocusedElementRef.current.focus();
        } catch {
          // Element might be detached
        }
      }
    };
  }, [
    isActive,
    containerRef,
    initialFocusRef,
    initialFocusSelector,
    returnFocus,
    onEscape,
    getFocusableElements,
  ]);

  return { getFocusableElements };
}
