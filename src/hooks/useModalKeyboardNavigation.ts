"use client";

import { useEffect, useRef, RefObject } from "react";
import { useFocusTrap } from "./useFocusTrap";

export interface ModalKeyboardShortcuts {
  onClose?: () => void;
  onConfirm?: () => void;
  onRotateClockwise?: () => void;
  onRotateCounterClockwise?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onResetZoom?: () => void;
}

export interface UseModalKeyboardNavigationOptions
  extends ModalKeyboardShortcuts {
  isOpen: boolean;
  containerRef?: RefObject<HTMLElement | null>;
  enableFocusTrap?: boolean;
}

/**
 * Custom hook managing modal accessibility focus traps and keyboard shortcuts.
 *
 * Supported Shortcuts:
 * - Escape: Close modal / cancel
 * - Enter or Ctrl/Cmd + Enter: Confirm / upload
 * - R: Rotate image 90 degrees clockwise
 * - Shift + R: Rotate image 90 degrees counter-clockwise
 * - + / =: Zoom in
 * - - / _: Zoom out
 * - 0: Reset zoom
 */
export function useModalKeyboardNavigation({
  isOpen,
  containerRef,
  enableFocusTrap = true,
  onClose,
  onConfirm,
  onRotateClockwise,
  onRotateCounterClockwise,
  onZoomIn,
  onZoomOut,
  onResetZoom,
}: UseModalKeyboardNavigationOptions) {
  const internalRef = useRef<HTMLElement | null>(null);
  const targetRef = containerRef || internalRef;

  useFocusTrap(targetRef, {
    isActive: isOpen && enableFocusTrap,
    onEscape: onClose,
    returnFocus: true,
  });

  const callbacksRef = useRef({
    onClose,
    onConfirm,
    onRotateClockwise,
    onRotateCounterClockwise,
    onZoomIn,
    onZoomOut,
    onResetZoom,
  });

  callbacksRef.current = {
    onClose,
    onConfirm,
    onRotateClockwise,
    onRotateCounterClockwise,
    onZoomIn,
    onZoomOut,
    onResetZoom,
  };

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput =
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        (activeEl instanceof HTMLElement && activeEl.isContentEditable);

      // Escape: Close modal / cancel upload
      if (e.key === "Escape") {
        e.preventDefault();
        callbacksRef.current.onClose?.();
        return;
      }

      // Enter or Ctrl/Cmd + Enter: Confirm and upload image
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey || !isInput)) {
        e.preventDefault();
        callbacksRef.current.onConfirm?.();
        return;
      }

      // Avoid single-key shortcuts while typing in a text field
      if (isInput) return;

      // R or Shift + R: Rotate 90° clockwise or counter-clockwise
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        if (e.shiftKey) {
          callbacksRef.current.onRotateCounterClockwise?.();
        } else {
          callbacksRef.current.onRotateClockwise?.();
        }
        return;
      }

      // + / =: Zoom in
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        callbacksRef.current.onZoomIn?.();
        return;
      }

      // - / _: Zoom out
      if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        callbacksRef.current.onZoomOut?.();
        return;
      }

      // 0: Reset zoom
      if (e.key === "0") {
        e.preventDefault();
        callbacksRef.current.onResetZoom?.();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return { containerRef: targetRef };
}
