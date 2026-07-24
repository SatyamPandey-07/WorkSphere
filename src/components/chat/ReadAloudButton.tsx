"use client";

import React from "react";
import { Volume2, Square, VolumeX } from "lucide-react";
import {
  useSpeechSynthesis,
  SPEED_OPTIONS,
  SpeedOption,
} from "@/hooks/useSpeechSynthesis";

export interface ReadAloudButtonProps {
  /** The text content to read aloud */
  text: string;
  /** Optional extra CSS classes for container */
  className?: string;
  /** Initial playback speed rate (default: 1) */
  defaultRate?: number;
  /** Initial pitch parameter (default: 1) */
  pitch?: number;
  /** Callback fired when speech starts */
  onStart?: () => void;
  /** Callback fired when speech completes */
  onEnd?: () => void;
}

export function ReadAloudButton({
  text,
  className = "",
  defaultRate = 1,
  pitch = 1,
  onStart,
  onEnd,
}: ReadAloudButtonProps) {
  const { isSupported, isSpeaking, rate, setRate, speak, cancel } =
    useSpeechSynthesis({
      textToSpeakDefault: text,
      defaultRate,
      defaultPitch: pitch,
      onStart,
      onEnd,
    });

  if (!isSupported) {
    return (
      <div className={`inline-flex items-center gap-1 ${className}`}>
        <button
          type="button"
          disabled
          aria-label="Text to speech not supported"
          title="Text-to-speech is not supported in this browser"
          className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800/50 px-2 py-1 text-xs text-zinc-400 dark:text-zinc-500 cursor-not-allowed opacity-60"
        >
          <VolumeX className="w-3.5 h-3.5" />
          <span>Read Aloud</span>
        </button>
      </div>
    );
  }

  const handleTogglePlay = () => {
    if (isSpeaking) {
      cancel();
    } else {
      speak(text);
    }
  };

  const handleSpeedChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedRate = parseFloat(e.target.value);
    if (!isNaN(selectedRate)) {
      setRate(selectedRate);
    }
  };

  return (
    <div
      className={`inline-flex items-center gap-1 text-xs font-medium ${className}`}
    >
      <button
        type="button"
        onClick={handleTogglePlay}
        aria-label={isSpeaking ? "Stop reading aloud" : "Read message aloud"}
        title={isSpeaking ? "Stop reading" : "Read aloud"}
        className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 transition-all duration-150 active:scale-95 shadow-sm ${
          isSpeaking
            ? "bg-rose-500 text-white hover:bg-rose-600 border border-rose-600 animate-pulse"
            : "bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700"
        }`}
      >
        {isSpeaking ? (
          <>
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>Stop</span>
          </>
        ) : (
          <>
            <Volume2 className="w-3.5 h-3.5" />
            <span>Read Aloud</span>
          </>
        )}
      </button>

      {/* Speed selection dropdown adjacent to ReadAloudButton */}
      <div className="relative inline-flex items-center">
        <select
          value={rate}
          onChange={handleSpeedChange}
          aria-label="Playback speed"
          title="Playback speed"
          className="appearance-none rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 pl-2 pr-5 py-1 text-xs font-semibold cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
        >
          {SPEED_OPTIONS.map((speed: number) => (
            <option key={speed} value={speed}>
              {speed}x
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-zinc-500 dark:text-zinc-400">
          ▼
        </span>
      </div>
    </div>
  );
}
