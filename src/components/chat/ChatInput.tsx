"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Clock,
  Trash2,
  X,
  Mic,
  MicOff,
  Send,
  Loader2,
  Image as ImageIcon,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useRateLimit } from "@/hooks/useRateLimit";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { markRoomAsRead } from "@/lib/chat/unreadTracker";
import {
  ImageUploadPreviewModal,
  ImageUploadPayload,
} from "./ImageUploadPreviewModal";

export interface ChatInputProps {
  input: string;
  isLoading: boolean;
  onInputChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  distanceRadius?: number;
  onDistanceChange?: (radius: number) => void;
  roomId?: string | null;
  userId?: string | null;
  onFocus?: () => void;
  onImageUpload?: (payload: ImageUploadPayload) => void | Promise<void>;
}

export function ChatInput({
  input = "",
  isLoading,
  onInputChange,
  onSubmit,
  distanceRadius = 0,
  onDistanceChange,
  roomId = "default",
  userId = null,
  onFocus,
  onImageUpload,
}: ChatInputProps) {
  const safeInput = input || "";
  const MAX_CHARS = 2000;
  const charCount = safeInput.length;
  const isOverLimit = charCount > MAX_CHARS;
  const retryAfter = useRateLimit("chat");

  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [isFocused, setIsFocused] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [shortcutLabel, setShortcutLabel] = useState("Ctrl+K");
  const inputRef = useRef<HTMLInputElement>(null);

  // Image Upload & Preview Modal State
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleClear = () => {
    onInputChange("");
    inputRef.current?.focus();
  };

  useEffect(() => {
    const history = localStorage.getItem("ws-recent-searches");
    if (history) {
      try {
        setRecentSearches(JSON.parse(history));
      } catch (e) {
        console.error(e);
      }
    }
  }, []);

  useEffect(() => {
    const isApple =
      typeof navigator !== "undefined" &&
      /Mac|iPhone|iPad|iPod/i.test(
        navigator.platform || navigator.userAgent || "",
      );
    setShortcutLabel(isApple ? "⌘K" : "Ctrl+K");
  }, []);

  // Keep the composer above the iOS soft keyboard / browser chrome.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const sync = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKeyboardInset(inset);
    };

    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
    };
  }, []);

  const saveToHistory = (term: string) => {
    const updated = [
      term,
      ...recentSearches.filter((item) => item !== term),
    ].slice(0, 5);
    setRecentSearches(updated);
    localStorage.setItem("ws-recent-searches", JSON.stringify(updated));
  };

  const clearHistory = () => {
    setRecentSearches([]);
    localStorage.removeItem("ws-recent-searches");
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (safeInput.trim() && !isOverLimit) {
      saveToHistory(safeInput.trim());
    }
    onSubmit(e);
  };

  // ── File Picker & Modal Handlers ─────────────────────────────────────────
  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith("image/")) {
      setSelectedImageFile(file);
      setIsImageModalOpen(true);
    }
  };

  const handleModalCancel = () => {
    setIsImageModalOpen(false);
    setSelectedImageFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleModalConfirm = async (payload: ImageUploadPayload) => {
    try {
      if (onImageUpload) {
        await onImageUpload(payload);
      }
    } finally {
      setIsImageModalOpen(false);
      setSelectedImageFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  // ── Voice input banner state ─────────────────────────────────────────────
  const [showVoiceBanner, setShowVoiceBanner] = useState(false);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Show the banner and auto-hide it after 6 seconds. */
  const triggerBanner = useCallback(() => {
    setShowVoiceBanner(true);
    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    bannerTimerRef.current = setTimeout(() => setShowVoiceBanner(false), 6000);
  }, []);

  useEffect(() => {
    return () => {
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    };
  }, []);

  // ── Speech recognition ───────────────────────────────────────────────────
  const handleTranscript = useCallback(
    (text: string) => {
      if (!text) return;
      const current = (input || "").trim();
      onInputChange(current ? `${current} ${text}` : text);
    },
    [input, onInputChange],
  );

  const { isSupported, status, errorMessage, startListening, stopListening } =
    useSpeechRecognition(handleTranscript);

  const isListening = status === "listening";

  const handleMicClick = useCallback(() => {
    if (!isSupported) {
      triggerBanner();
      return;
    }
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isSupported, isListening, startListening, stopListening, triggerBanner]);

  useEffect(() => {
    if (errorMessage) triggerBanner();
  }, [errorMessage, triggerBanner]);

  const showCharCounter = charCount > 800;
  let counterColor = "text-zinc-500 dark:text-zinc-400"; // gray
  if (isOverLimit || charCount > 1000) {
    counterColor = "text-red-500";
  } else if (charCount >= MAX_CHARS - 200) {
    counterColor = "text-yellow-500";
  }

  // ── Mic button styling ───────────────────────────────────────────────────
  const micButtonBase =
    "p-3 rounded-xl transition-all active:scale-95 shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary-accent)]";

  const micButtonStyle = !isSupported
    ? `${micButtonBase} bg-zinc-200 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-600 cursor-not-allowed opacity-60 cursor-pointer`
    : isListening
      ? `${micButtonBase} bg-red-500 hover:bg-red-600 text-white animate-pulse cursor-pointer`
      : `${micButtonBase} bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-700 cursor-pointer`;

  const micAriaLabel = !isSupported
    ? "Voice input is not supported in this browser"
    : isListening
      ? "Stop voice input"
      : "Start voice input";

  return (
    <div
      data-keyboard-inset={keyboardInset}
      className="relative p-4 bg-white dark:bg-zinc-950 border-t border-zinc-200 dark:border-zinc-800 pb-[max(1rem,env(safe-area-inset-bottom))]"
      style={
        keyboardInset > 0
          ? {
              paddingBottom: `calc(${keyboardInset}px + env(safe-area-inset-bottom, 0px))`,
            }
          : undefined
      }
    >
      <AnimatePresence>
        {isFocused && recentSearches.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="absolute bottom-full left-4 right-4 mb-2 z-50 p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-2xl flex flex-col gap-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-black tracking-widest text-zinc-400 dark:text-zinc-500 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-zinc-400" />
                Recent Searches
              </span>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  clearHistory();
                }}
                className="text-[10px] font-black uppercase tracking-wider text-red-500 hover:text-red-600 transition-colors flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" />
                Clear
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              {recentSearches.map((term) => (
                <button
                  key={term}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onInputChange(term);
                  }}
                  className="px-3 py-1.5 bg-zinc-100 accent-bg-hover dark:bg-zinc-900 accent-bg-dark-10 border border-zinc-200/50 dark:border-zinc-800 accent-border-20 accent-border-dark-20 text-[11px] font-black uppercase tracking-tight rounded-xl text-zinc-600 accent-text-hover dark:text-zinc-400 dark:text-[color-mix(in_srgb,var(--primary-accent),transparent_0.2)] transition-all flex items-center gap-1"
                >
                  {term}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Unsupported-browser / error banner ─────────────────────────── */}
      {showVoiceBanner && (
        <div
          role="alert"
          className="mb-3 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-800 dark:text-amber-300"
        >
          <MicOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="font-semibold leading-snug">
            {errorMessage ||
              "Voice input is not supported in this browser. Please use Chrome, Edge, or enable speech recognition in Firefox (about:config → media.webspeech.recognition.enable)."}
          </span>
          <button
            type="button"
            aria-label="Dismiss voice input warning"
            onClick={() => setShowVoiceBanner(false)}
            className="ml-auto cursor-pointer shrink-0 rounded p-0.5 hover:bg-amber-200 dark:hover:bg-amber-800 transition-colors"
          >
            ✕
          </button>
        </div>
      )}

      {/* Hidden File Input for Image Selection */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        data-testid="chat-image-file-input"
        onChange={handleFileChange}
        className="hidden"
      />

      <form
        id="ws-chat-form"
        onSubmit={handleFormSubmit}
        className="flex gap-2 p-1 rounded-2xl bg-zinc-100 dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-800 focus-within:accent-border transition-all shadow-inner"
      >
        {/* Image Attachment Button */}
        <button
          type="button"
          onClick={handleAttachClick}
          data-testid="chat-attach-image-btn"
          aria-label="Attach image"
          title="Attach image"
          disabled={isLoading || retryAfter > 0}
          className="p-3 rounded-xl cursor-pointer transition-all active:scale-95 shadow-sm bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 disabled:opacity-50 flex items-center justify-center"
        >
          <ImageIcon className="w-5 h-5" />
        </button>

        <button
          type="button"
          onClick={handleMicClick}
          className={`p-3 rounded-xl cursor-pointer transition-all active:scale-95 shadow-lg group ${
            isListening
              ? "bg-red-500 hover:bg-red-600 text-white animate-pulse"
              : "bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300"
          }`}
          title={isListening ? "Stop dictation" : "Start dictation"}
        >
          <Mic className="w-5 h-5" />
        </button>

        <div className="flex items-center border-r border-zinc-200 dark:border-zinc-700/50 pr-2 mr-2">
          <select
            value={distanceRadius}
            onChange={(e) => onDistanceChange?.(Number(e.target.value))}
            className="bg-transparent text-sm font-semibold text-zinc-600 dark:text-zinc-300 cursor-pointer focus:outline-none appearance-none pr-6 pl-2 relative"
            style={{
              backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%2371717A%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")`,
              backgroundRepeat: "no-repeat",
              backgroundPosition: "right 0.2rem top 50%",
              backgroundSize: "0.65rem auto",
            }}
            title="Filter by distance"
            aria-label="Filter by distance"
          >
            <option value={0}>Any</option>
            <option value={1}>1 km</option>
            <option value={5}>5 km</option>
            <option value={10}>10 km</option>
          </select>
        </div>

        <div className="relative flex min-w-0 flex-1 items-center">
          <input
            ref={inputRef}
            type="text"
            value={safeInput}
            onChange={(e) => onInputChange(e.target.value ?? "")}
            onFocus={() => {
              setIsFocused(true);
              if (roomId) {
                markRoomAsRead(roomId, userId);
              }
              onFocus?.();
            }}
            onBlur={() => setIsFocused(false)}
            placeholder={
              isListening ? "Listening…" : "Where's the focus mode hotspot?"
            }
            disabled={isLoading || retryAfter > 0}
            className="w-full bg-transparent px-4 py-3 pr-16 text-sm font-bold text-zinc-900 placeholder:text-zinc-500 focus:placeholder-transparent focus:outline-none disabled:opacity-50 dark:text-zinc-50"
          />
          {safeInput.length > 0 && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-2 p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          {!safeInput.trim() && (
            <kbd
              className="pointer-events-none absolute right-2 hidden select-none rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide text-zinc-400 shadow-sm sm:inline-block dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-500"
              aria-hidden="true"
              title="Focus search"
            >
              {shortcutLabel}
            </kbd>
          )}
        </div>

        {/* ── Microphone button ──────────────────────────────────────────── */}
        <button
          type="button"
          onClick={handleMicClick}
          aria-label={micAriaLabel}
          aria-disabled={!isSupported}
          title={micAriaLabel}
          className={micButtonStyle}
        >
          {isListening ? (
            <MicOff className="w-5 h-5" aria-hidden="true" />
          ) : (
            <Mic className="w-5 h-5" aria-hidden="true" />
          )}
        </button>

        {/* ── Send button ────────────────────────────────────────────────── */}
        <button
          type="submit"
          disabled={isLoading || !input.trim() || isOverLimit || retryAfter > 0}
          className="p-3 bg-[var(--primary-accent)] cursor-pointer hover:opacity-90 text-white rounded-xl disabled:opacity-30 transition-all active:scale-95 shadow-lg group flex items-center justify-center gap-1.5"
        >
          {isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : retryAfter > 0 ? (
            <span className="text-xs font-black whitespace-nowrap px-1">
              Retry in {retryAfter}s
            </span>
          ) : (
            <Send className="w-5 h-5 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
          )}
        </button>
      </form>

      {showCharCounter && (
        <div className="mt-2 text-right">
          <span
            className={`text-xs font-semibold transition-colors ${counterColor}`}
          >
            {charCount}/{MAX_CHARS}
          </span>
        </div>
      )}

      {/* Image Preview Thumbnail Modal */}
      <ImageUploadPreviewModal
        isOpen={isImageModalOpen}
        file={selectedImageFile}
        onCancel={handleModalCancel}
        onConfirm={handleModalConfirm}
      />
    </div>
  );
}

export default ChatInput;
