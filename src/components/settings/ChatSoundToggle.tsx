"use client";

import React, { useEffect, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  isChatSoundEnabled,
  setChatSoundEnabled,
  CHAT_SOUND_CHANGE_EVENT,
} from "@/lib/chatSound";

export interface ChatSoundToggleProps {
  onSoundChange?: (enabled: boolean) => void;
  className?: string;
}

export function ChatSoundToggle({ onSoundChange, className = "" }: ChatSoundToggleProps = {}) {
  const [enabled, setEnabled] = useState<boolean>(true);
  const [mounted, setMounted] = useState<boolean>(false);

  useEffect(() => {
    const initial = isChatSoundEnabled();
    setEnabled(initial);
    setMounted(true);

    const handleSoundChange = (e: Event) => {
      const customEvent = e as CustomEvent<boolean>;
      if (typeof customEvent.detail === "boolean") {
        setEnabled(customEvent.detail);
        onSoundChange?.(customEvent.detail);
      }
    };

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === null || e.key === "worksphere_chat_sound_enabled") {
        const val = isChatSoundEnabled();
        setEnabled(val);
        onSoundChange?.(val);
      }
    };

    window.addEventListener(CHAT_SOUND_CHANGE_EVENT, handleSoundChange);
    window.addEventListener("storage", handleStorageChange);
    return () => {
      window.removeEventListener(CHAT_SOUND_CHANGE_EVENT, handleSoundChange);
      window.removeEventListener("storage", handleStorageChange);
    };
  }, [onSoundChange]);

  const handleToggle = (checked: boolean) => {
    setEnabled(checked);
    setChatSoundEnabled(checked);
    onSoundChange?.(checked);
  };

  if (!mounted) {
    return (
      <div className="flex items-center justify-between space-x-4 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
        <div className="space-y-1">
          <Label className="text-base font-semibold leading-none flex items-center gap-2 text-zinc-900 dark:text-zinc-100">
            <Volume2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            Chat Sound Effects
          </Label>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Play audio chime alerts when receiving incoming real-time chat messages.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="chat-sound-toggle-container"
      className="flex items-center justify-between space-x-4 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm transition-colors"
    >
      <div className="space-y-1">
        <Label
          htmlFor="chat-sound-toggle-switch"
          className="text-base font-semibold leading-none flex items-center gap-2 text-zinc-900 dark:text-zinc-100 cursor-pointer"
        >
          {enabled ? (
            <Volume2 className="w-5 h-5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
          ) : (
            <VolumeX className="w-5 h-5 text-zinc-400" aria-hidden="true" />
          )}
          Chat Sound Effects
        </Label>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Play audio chime alerts when receiving incoming real-time chat messages.
        </p>
      </div>

      <label className="relative inline-flex items-center cursor-pointer">
        <input
          id="chat-sound-toggle-switch"
          type="checkbox"
          role="switch"
          aria-checked={enabled}
          aria-label="Chat Sound Effects"
          className="sr-only peer"
          checked={enabled}
          onChange={(e) => handleToggle(e.target.checked)}
        />
        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
      </label>
    </div>
  );
}

export default ChatSoundToggle;
