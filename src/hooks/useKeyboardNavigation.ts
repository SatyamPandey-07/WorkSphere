"use client";

import { useEffect, useState, useCallback, useRef } from "react";

export interface UseKeyboardNavigationOptions<T> {
  items: T[];
  onSelect?: (item: T, index: number) => void;
  enabled?: boolean;
  wrapAround?: boolean;
}

/**
 * Checks if the target element or active element is an input, textarea, select,
 * or contenteditable element where keyboard shortcuts should be ignored.
 */
export function isEditableElement(element: EventTarget | null): boolean {
  if (!element || !(element instanceof HTMLElement)) return false;
  const tagName = element.tagName.toLowerCase();
  if (tagName === "input" || tagName === "textarea" || tagName === "select") {
    return true;
  }
  return (
    element.isContentEditable ||
    element.getAttribute("contenteditable") === "true" ||
    element.getAttribute("role") === "textbox"
  );
}

/**
 * Hook providing j/k navigation and Enter/Space selection for lists of items.
 * Boundary behavior: wraps around safely if wrapAround is true (default: true).
 */
export function useKeyboardNavigation<T>({
  items,
  onSelect,
  enabled = true,
  wrapAround = true,
}: UseKeyboardNavigationOptions<T>) {
  const [activeIndex, setActiveIndex] = useState<number>(-1);

  // Keep latest onSelect and items in ref to avoid stale closures
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Handle changes in the results list, avoiding invalid/stale indexes
  useEffect(() => {
    if (!items || items.length === 0) {
      setActiveIndex(-1);
    } else {
      setActiveIndex((prev) => {
        if (prev >= items.length) {
          return items.length - 1;
        }
        return prev;
      });
    }
  }, [items]);

  const selectNext = useCallback(() => {
    const list = itemsRef.current;
    if (!list || list.length === 0) return;

    setActiveIndex((prev) => {
      if (prev === -1) {
        return 0;
      }
      if (prev >= list.length - 1) {
        return wrapAround ? 0 : list.length - 1;
      }
      return prev + 1;
    });
  }, [wrapAround]);

  const selectPrevious = useCallback(() => {
    const list = itemsRef.current;
    if (!list || list.length === 0) return;

    setActiveIndex((prev) => {
      if (prev <= 0) {
        return wrapAround ? list.length - 1 : 0;
      }
      return prev - 1;
    });
  }, [wrapAround]);

  const activateCurrent = useCallback(() => {
    const list = itemsRef.current;
    if (!list || list.length === 0) return;
    if (activeIndex >= 0 && activeIndex < list.length) {
      const selectedItem = list[activeIndex];
      onSelectRef.current?.(selectedItem, activeIndex);
    }
  }, [activeIndex]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // 1. Ignore if modifier keys are pressed (except Space or Enter without modifiers)
      if (event.ctrlKey || event.altKey || event.metaKey) {
        return;
      }

      // 2. Ignore if typing in editable elements
      if (
        isEditableElement(event.target) ||
        isEditableElement(document.activeElement)
      ) {
        return;
      }

      // 3. Shortcuts: j (next), k (previous), Enter / Space (activate)
      if (event.key === "j" || event.key === "J") {
        event.preventDefault();
        selectNext();
      } else if (event.key === "k" || event.key === "K") {
        event.preventDefault();
        selectPrevious();
      } else if (event.key === "Enter" || event.key === " ") {
        const list = itemsRef.current;
        if (list && list.length > 0 && activeIndex >= 0 && activeIndex < list.length) {
          event.preventDefault();
          activateCurrent();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [enabled, selectNext, selectPrevious, activateCurrent, activeIndex]);

  return {
    activeIndex,
    setActiveIndex,
    selectNext,
    selectPrevious,
    activateCurrent,
  };
}
