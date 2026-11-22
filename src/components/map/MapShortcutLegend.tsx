"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { HelpCircle, X, MapPin } from "lucide-react";
import { FocusTrap } from "@/components/ui/FocusTrap";
import { KeyboardShortcutBadge } from "@/components/ui/KeyboardShortcutBadge";
import { ShortcutTooltip } from "@/components/ui/ShortcutTooltip";

export interface MapShortcutItem {
  key: string;
  action: string;
  description: string;
  category?: "Navigation" | "Actions" | "General";
}

export const MAP_SHORTCUTS: MapShortcutItem[] = [
  {
    key: "+",
    action: "Zoom In",
    description: "Zoom into the venue map view",
    category: "Navigation",
  },
  {
    key: "-",
    action: "Zoom Out",
    description: "Zoom out of the venue map view",
    category: "Navigation",
  },
  {
    key: "Esc",
    action: "Deselect / Close",
    description: "Deselect active venue or close open modal overlay",
    category: "General",
  },
  {
    key: "F",
    action: "Toggle Filters",
    description: "Toggle venue filter panel or forecast options",
    category: "Actions",
  },
  {
    key: "?",
    action: "Shortcut Legend",
    description: "Show or hide this keyboard shortcut legend",
    category: "General",
  },
];

export interface MapShortcutLegendProps {
  isOpen?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
  shortcuts?: MapShortcutItem[];
  className?: string;
  buttonClassName?: string;
}

export function isEditableElement(element: EventTarget | null): boolean {
  if (!element || !(element instanceof HTMLElement)) return false;
  const tagName = element.tagName.toLowerCase();
  if (tagName === "input" || tagName === "textarea" || tagName === "select") {
    return true;
  }
  return element.isContentEditable || element.getAttribute("contenteditable") === "true";
}

export function MapShortcutLegend({
  isOpen: controlledIsOpen,
  onOpen: controlledOnOpen,
  onClose: controlledOnClose,
  shortcuts = MAP_SHORTCUTS,
  className = "",
  buttonClassName = "",
}: MapShortcutLegendProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerButtonRef = useRef<HTMLButtonElement>(null);

  const isControlled = controlledIsOpen !== undefined;
  const isOpen = isControlled ? controlledIsOpen : internalIsOpen;

  const handleOpen = useCallback(() => {
    if (!isControlled) {
      setInternalIsOpen(true);
    }
    controlledOnOpen?.();
  }, [isControlled, controlledOnOpen]);

  const handleClose = useCallback(() => {
    if (!isControlled) {
      setInternalIsOpen(false);
    }
    controlledOnClose?.();
    // Return focus to the trigger button when closing
    triggerButtonRef.current?.focus();
  }, [isControlled, controlledOnClose]);

  const handleToggle = useCallback(() => {
    if (isOpen) {
      handleClose();
    } else {
      handleOpen();
    }
  }, [isOpen, handleClose, handleOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // 1. If overlay is open and Escape is pressed, close it
      if (isOpen && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        handleClose();
        return;
      }

      // 2. Ignore modifier combinations (Ctrl, Alt, Meta)
      if (event.ctrlKey || event.altKey || event.metaKey) {
        return;
      }

      // 3. Ignore typing in interactive elements
      if (
        isEditableElement(event.target) ||
        isEditableElement(document.activeElement)
      ) {
        return;
      }

      // 4. Toggle legend on '?' (direct '?' or 'Shift + /')
      if (event.key === "?" || (event.key === "/" && event.shiftKey)) {
        event.preventDefault();
        handleToggle();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, handleToggle, handleClose]);

  return (
    <>
      {/* Accessible Help Button Trigger */}
      <ShortcutTooltip
        content="Keyboard shortcuts"
        shortcut="?"
        withModifier={false}
        position="left"
      >
        <button
          ref={triggerButtonRef}
          type="button"
          aria-label="Keyboard shortcuts"
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          onClick={handleToggle}
          data-testid="map-shortcut-legend-button"
          className={`min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900/90 p-2 text-zinc-200 shadow-md backdrop-blur-sm transition-colors hover:bg-zinc-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${buttonClassName}`}
        >
          <HelpCircle className="h-5 w-5" aria-hidden="true" />
          <span className="sr-only">Keyboard shortcuts (?)</span>
        </button>
      </ShortcutTooltip>

      {/* Modal Overlay / FocusTrap */}
      {isOpen && (
        <div
          role="presentation"
          className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              handleClose();
            }
          }}
          data-testid="map-shortcut-legend-backdrop"
        >
          <FocusTrap
            role="dialog"
            aria-modal="true"
            aria-labelledby="map-shortcut-legend-title"
            aria-describedby="map-shortcut-legend-description"
            onEscape={handleClose}
            initialFocusRef={closeButtonRef}
            returnFocus={true}
            className={`relative w-full max-w-md p-6 bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 outline-none ${className}`}
            data-testid="map-shortcut-legend-dialog"
          >
            <button
              ref={closeButtonRef}
              type="button"
              onClick={handleClose}
              aria-label="Close keyboard shortcuts"
              data-testid="map-shortcut-legend-close"
              className="absolute top-4 right-4 p-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>

            <div className="flex items-center gap-3 mb-2">
              <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
                <MapPin className="w-6 h-6" aria-hidden="true" />
              </div>
              <div>
                <h2
                  id="map-shortcut-legend-title"
                  className="text-xl font-bold text-zinc-900 dark:text-zinc-100"
                >
                  Map Navigation Shortcuts
                </h2>
                <p
                  id="map-shortcut-legend-description"
                  className="text-xs text-zinc-500 dark:text-zinc-400"
                >
                  Discover keyboard shortcuts for seamless venue map navigation
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-2.5 max-h-[60vh] overflow-y-auto pr-1">
              {shortcuts.map((shortcut) => (
                <div
                  key={shortcut.key}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800/80 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                      {shortcut.action}
                    </span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {shortcut.description}
                    </span>
                  </div>
                  <KeyboardShortcutBadge
                    shortcut={shortcut.key}
                    withModifier={false}
                    variant="default"
                    size="sm"
                  />
                </div>
              ))}
            </div>

            <div className="mt-5 pt-4 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
              <span>Press <kbd className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-300 dark:border-zinc-700">?</kbd> anytime to toggle</span>
              <button
                type="button"
                onClick={handleClose}
                className="text-blue-600 dark:text-blue-400 font-medium hover:underline focus:outline-none"
              >
                Dismiss
              </button>
            </div>
          </FocusTrap>
        </div>
      )}
    </>
  );
}

export default MapShortcutLegend;
