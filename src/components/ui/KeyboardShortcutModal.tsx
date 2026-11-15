"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, X, Keyboard } from "lucide-react";
import { FocusTrap } from "@/components/ui/FocusTrap";
import { KeyboardShortcutBadge } from "@/components/ui/KeyboardShortcutBadge";

export interface KeyboardShortcutModalProps {
  isOpen?: boolean;
  onClose?: () => void;
}

interface Shortcut {
  category: "Navigation" | "Venue Actions" | "Audio Controls" | "Filters";
  description: string;
  keys: string[];
}

const shortcuts: Shortcut[] = [
  { category: "Navigation", description: "Switch to Grid view", keys: ["G"] },
  { category: "Navigation", description: "Switch to Compact view", keys: ["C"] },
  { category: "Navigation", description: "Switch to Map view", keys: ["M"] },
  { category: "Navigation", description: "Focus Search", keys: ["/"] },
  { category: "Navigation", description: "Open keyboard shortcuts", keys: ["?"] },
  { category: "Navigation", description: "Dismiss drawers or modal", keys: ["Esc"] },
  { category: "Venue Actions", description: "Select next venue", keys: ["ArrowDown"] },
  { category: "Venue Actions", description: "Select previous venue", keys: ["ArrowUp"] },
  { category: "Venue Actions", description: "Open selected venue", keys: ["Enter"] },
  { category: "Audio Controls", description: "Toggle audio playback", keys: ["Space"] },
  { category: "Audio Controls", description: "Mute or unmute audio", keys: ["Shift", "M"] },
  { category: "Filters", description: "Toggle filters drawer", keys: ["F"] },
  { category: "Filters", description: "Reset active filters", keys: ["Shift", "R"] },
];

const categories: Shortcut["category"][] = [
  "Navigation",
  "Venue Actions",
  "Audio Controls",
  "Filters",
];

function isEditableElement(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  if (tagName === "input" || tagName === "textarea" || tagName === "select") {
    return true;
  }
  return target.isContentEditable || target.getAttribute("contenteditable") === "true";
}

export function KeyboardShortcutModal({
  isOpen: controlledIsOpen,
  onClose: controlledOnClose,
}: KeyboardShortcutModalProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const isControlled = controlledIsOpen !== undefined;
  const isOpen = isControlled ? controlledIsOpen : internalOpen;

  const handleClose = useCallback(() => {
    if (!isControlled) {
      setInternalOpen(false);
    }
    controlledOnClose?.();
  }, [isControlled, controlledOnClose]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableElement(event.target) || isEditableElement(document.activeElement)) {
        return;
      }

      if (event.key === "?" || (event.shiftKey && event.key === "/")) {
        event.preventDefault();
        if (!isControlled) {
          setInternalOpen((prev) => !prev);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isControlled]);

  useEffect(() => {
    if (!isOpen) {
      setSearch("");
    }
  }, [isOpen]);

  const filteredShortcuts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return shortcuts;

    return shortcuts.filter(
      (shortcut) =>
        shortcut.description.toLowerCase().includes(query) ||
        shortcut.category.toLowerCase().includes(query) ||
        shortcut.keys.some((key) => key.toLowerCase().includes(query)),
    );
  }, [search]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[10001] flex items-center justify-center p-4">
          <motion.button
            type="button"
            aria-label="Close keyboard shortcuts backdrop"
            data-testid="keyboard-shortcut-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            className="absolute inset-0 bg-zinc-950/60 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            className="relative z-10 w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-6 text-zinc-900 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
          >
            <FocusTrap
              isActive={isOpen}
              onEscape={handleClose}
              initialFocusRef={searchRef}
              role="dialog"
              aria-modal="true"
              aria-label="Keyboard shortcuts"
              data-testid="keyboard-shortcut-modal"
              className="outline-none"
            >
              <div className="mb-5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Keyboard className="h-5 w-5 text-blue-500" />
                  <h2 className="text-lg font-bold">Keyboard Shortcuts</h2>
                </div>

                <button
                  type="button"
                  onClick={handleClose}
                  aria-label="Close keyboard shortcuts"
                  className="rounded-lg p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="relative mb-5">
                <Search
                  data-testid="keyboard-shortcut-search-icon"
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
                />
                <input
                  ref={searchRef}
                  type="search"
                  data-testid="keyboard-shortcut-search-input"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search shortcuts by name or key..."
                  aria-label="Search keyboard shortcuts"
                  className="w-full rounded-xl border border-zinc-200 bg-transparent py-3 pl-10 pr-9 text-sm outline-none focus:border-blue-500 dark:border-zinc-700"
                />
                {search && (
                  <button
                    type="button"
                    data-testid="keyboard-shortcut-search-clear"
                    onClick={() => setSearch("")}
                    aria-label="Clear shortcut search"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <div className="max-h-[55vh] space-y-5 overflow-y-auto pr-1">
                {categories.map((category) => {
                  const items = filteredShortcuts.filter(
                    (shortcut) => shortcut.category === category,
                  );

                  if (items.length === 0) return null;

                  return (
                    <section key={category} data-testid={`shortcut-category-${category}`}>
                      <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-zinc-400">
                        {category}
                      </h3>

                      <div className="space-y-3">
                        {items.map((shortcut) => (
                          <div
                            key={`${shortcut.category}-${shortcut.description}`}
                            data-testid="shortcut-item"
                            className="flex items-center justify-between gap-3 border-b border-zinc-100 pb-2 dark:border-zinc-800"
                          >
                            <span className="text-sm text-zinc-700 dark:text-zinc-300">
                              {shortcut.description}
                            </span>

                            <div className="flex shrink-0 gap-1">
                              {shortcut.keys.map((key) => (
                                <KeyboardShortcutBadge
                                  key={key}
                                  shortcut={key}
                                  withModifier={false}
                                  size="sm"
                                />
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  );
                })}

                {filteredShortcuts.length === 0 && (
                  <p
                    data-testid="keyboard-shortcut-empty"
                    className="py-6 text-center text-sm text-zinc-500"
                  >
                    No shortcuts found
                  </p>
                )}
              </div>
            </FocusTrap>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export default KeyboardShortcutModal;
