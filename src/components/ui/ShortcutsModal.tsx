"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Keyboard } from "lucide-react";

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ShortcutsModal({ isOpen, onClose }: ShortcutsModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[10001] flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-zinc-950/60 backdrop-blur-sm"
          />

          {/* Modal Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ type: "spring", duration: 0.4 }}
            className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl p-6 z-10 text-zinc-900 dark:text-zinc-50"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-4 mb-5">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-blue-500/10 rounded-xl text-blue-500">
                  <Keyboard className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold">Keyboard Shortcuts</h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Use these hotkeys to navigate WorkSphere faster
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-all"
                aria-label="Close keyboard shortcuts"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-1">
              {/* General Category */}
              <div>
                <h3 className="text-xs font-black uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-3">
                  General Controls
                </h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between py-1.5 border-b border-zinc-100/50 dark:border-zinc-800/50">
                    <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Show or hide this shortcuts guide
                    </span>
                    <kbd className="px-2.5 py-1 text-xs font-mono font-black bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-sm text-zinc-800 dark:text-zinc-300">
                      ?
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between py-1.5 border-b border-zinc-100/50 dark:border-zinc-800/50">
                    <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Close any active modal or panel
                    </span>
                    <kbd className="px-2.5 py-1 text-xs font-mono font-black bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-sm text-zinc-800 dark:text-zinc-300">
                      Esc
                    </kbd>
                  </div>
                </div>
              </div>

              {/* Chat & Search Category */}
              <div>
                <h3 className="text-xs font-black uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-3">
                  Chat & Search
                </h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between py-1.5 border-b border-zinc-100/50 dark:border-zinc-800/50">
                    <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Focus the search input
                    </span>
                    <div className="flex gap-1">
                      <kbd className="px-2 py-1 text-xs font-mono font-black bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-sm text-zinc-800 dark:text-zinc-300">
                        Ctrl
                      </kbd>
                      <span className="text-zinc-400 dark:text-zinc-600 font-bold self-center text-xs">
                        +
                      </span>
                      <kbd className="px-2 py-1 text-xs font-mono font-black bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-sm text-zinc-800 dark:text-zinc-300">
                        K
                      </kbd>
                    </div>
                  </div>
                </div>
              </div>

              {/* Venue Listings Category */}
              <div>
                <h3 className="text-xs font-black uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-3">
                  Venue Listings
                </h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between py-1.5 border-b border-zinc-100/50 dark:border-zinc-800/50">
                    <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Select next venue card in the list
                    </span>
                    <kbd className="px-2.5 py-1 text-[10px] font-mono font-black bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-sm text-zinc-800 dark:text-zinc-300">
                      ↓ Arrow Down
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between py-1.5 border-b border-zinc-100/50 dark:border-zinc-800/50">
                    <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Select previous venue card in the list
                    </span>
                    <kbd className="px-2.5 py-1 text-[10px] font-mono font-black bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-sm text-zinc-800 dark:text-zinc-300">
                      ↑ Arrow Up
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between py-1.5 border-b border-zinc-100/50 dark:border-zinc-800/50">
                    <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Open details dialog for selected venue
                    </span>
                    <kbd className="px-2.5 py-1 text-xs font-mono font-black bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-sm text-zinc-800 dark:text-zinc-300">
                      Enter
                    </kbd>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
