"use client";

import React, { useEffect, useState } from "react";
import { Volume2, VolumeX, Play, Radio, Crosshair } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  isChatSoundEnabled,
  setChatSoundEnabled,
  getAudioProfile,
  setAudioProfile,
  playAudioProfilePreview,
  CHAT_SOUND_CHANGE_EVENT,
  AUDIO_PROFILE_CHANGE_EVENT,
  AUDIO_PROFILES,
  type AudioProfile,
} from "@/lib/chatSound";

export interface ChatSoundToggleProps {
  onSoundChange?: (enabled: boolean) => void;
  className?: string;
}

export function ChatSoundToggle({ onSoundChange, className = "" }: ChatSoundToggleProps = {}) {
  const [enabled, setEnabled] = useState<boolean>(true);
  const [profile, setProfile] = useState<AudioProfile>("Standard Bell");
  const [isPlayingPreview, setIsPlayingPreview] = useState<boolean>(false);
  const [mounted, setMounted] = useState<boolean>(false);

  useEffect(() => {
    const initialProfile = getAudioProfile();
    const initialEnabled = isChatSoundEnabled();
    setProfile(initialProfile);
    setEnabled(initialEnabled);
    setMounted(true);

    const handleSoundChange = (e: Event) => {
      const customEvent = e as CustomEvent<boolean>;
      if (typeof customEvent.detail === "boolean") {
        setEnabled(customEvent.detail);
        onSoundChange?.(customEvent.detail);
        if (!customEvent.detail) {
          setProfile("Mute");
        } else {
          const p = getAudioProfile();
          setProfile(p === "Mute" ? "Standard Bell" : p);
        }
      }
    };

    const handleProfileChange = (e: Event) => {
      const customEvent = e as CustomEvent<AudioProfile>;
      if (customEvent.detail) {
        setProfile(customEvent.detail);
        const isEnabled = customEvent.detail !== "Mute";
        setEnabled(isEnabled);
        onSoundChange?.(isEnabled);
      }
    };

    const handleStorageChange = (e: StorageEvent) => {
      if (
        e.key === null ||
        e.key === "worksphere_chat_sound_enabled" ||
        e.key === "worksphere_audio_profile"
      ) {
        const val = isChatSoundEnabled();
        const p = getAudioProfile();
        setEnabled(val);
        setProfile(p);
        onSoundChange?.(val);
      }
    };

    window.addEventListener(CHAT_SOUND_CHANGE_EVENT, handleSoundChange);
    window.addEventListener(AUDIO_PROFILE_CHANGE_EVENT, handleProfileChange);
    window.addEventListener("storage", handleStorageChange);
    return () => {
      window.removeEventListener(CHAT_SOUND_CHANGE_EVENT, handleSoundChange);
      window.removeEventListener(AUDIO_PROFILE_CHANGE_EVENT, handleProfileChange);
      window.removeEventListener("storage", handleStorageChange);
    };
  }, [onSoundChange]);

  const handleToggle = (checked: boolean) => {
    setEnabled(checked);
    if (!checked) {
      setProfile("Mute");
      setAudioProfile("Mute");
    } else {
      const nextProfile: AudioProfile = profile === "Mute" ? "Standard Bell" : profile;
      setProfile(nextProfile);
      setAudioProfile(nextProfile);
    }
    setChatSoundEnabled(checked);
    onSoundChange?.(checked);
  };

  const handleSelectProfile = (newProfile: AudioProfile) => {
    setProfile(newProfile);
    setAudioProfile(newProfile);
    const nextEnabled = newProfile !== "Mute";
    setEnabled(nextEnabled);
    onSoundChange?.(nextEnabled);
  };

  const handlePreview = () => {
    if (profile === "Mute") return;
    setIsPlayingPreview(true);
    playAudioProfilePreview(profile);
    setTimeout(() => {
      setIsPlayingPreview(false);
    }, 700);
  };

  if (!mounted) {
    return (
      <div
        className={`flex items-center justify-between space-x-4 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm ${className}`}
      >
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
      className={`p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm transition-colors space-y-4 ${className}`}
    >
      {/* Primary Toggle Header */}
      <div className="flex items-center justify-between space-x-4">
        <div className="flex items-center gap-3">
          <div
            className={`p-2 rounded-lg transition-colors ${
              profile === "Fighter Jet Avionics"
                ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                : enabled
                ? "bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-500/20"
                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400"
            }`}
          >
            {profile === "Fighter Jet Avionics" ? (
              <Radio className="w-5 h-5" aria-hidden="true" />
            ) : enabled ? (
              <Volume2 className="w-5 h-5" aria-hidden="true" />
            ) : (
              <VolumeX className="w-5 h-5" aria-hidden="true" />
            )}
          </div>
          <div className="space-y-1">
            <Label
              htmlFor="chat-sound-toggle-switch"
              className="text-base font-semibold leading-none flex items-center gap-2 text-zinc-900 dark:text-zinc-100 cursor-pointer"
            >
              Chat Sound Effects
            </Label>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Play audio chime alerts when receiving incoming real-time chat messages.
            </p>
          </div>
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

      {/* Sound Profile Selector & Preview Button */}
      <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <Label
            htmlFor="audio-profile-select"
            className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
          >
            Sound Theme Profile
          </Label>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Select between standard subtle chime and Hal Jordan fighter jet telemetry audio.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <select
            id="audio-profile-select"
            data-testid="audio-profile-select"
            aria-label="Sound Profile Selector"
            value={profile}
            onChange={(e) => handleSelectProfile(e.target.value as AudioProfile)}
            className="px-3 py-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all cursor-pointer"
          >
            {AUDIO_PROFILES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>

          <button
            type="button"
            data-testid="preview-sound-button"
            aria-label="Preview sound"
            title={profile === "Mute" ? "Audio is muted" : `Preview ${profile}`}
            disabled={profile === "Mute"}
            onClick={handlePreview}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
              profile === "Mute"
                ? "border-zinc-200 dark:border-zinc-800 text-zinc-400 dark:text-zinc-600 bg-zinc-50 dark:bg-zinc-900/50 cursor-not-allowed opacity-60"
                : profile === "Fighter Jet Avionics"
                ? "border-emerald-500/40 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-500/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/50"
                : "border-blue-200 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/50"
            } ${isPlayingPreview ? "scale-95 ring-2 ring-emerald-400/50" : ""}`}
          >
            <Play
              className={`w-3.5 h-3.5 ${isPlayingPreview ? "animate-pulse" : ""}`}
              aria-hidden="true"
            />
            <span>{isPlayingPreview ? "Playing..." : "Preview"}</span>
          </button>
        </div>
      </div>

      {/* Fighter Jet Cockpit Telemetry HUD Badge */}
      {profile === "Fighter Jet Avionics" && (
        <div
          data-testid="cockpit-telemetry-badge"
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-xs font-mono"
        >
          <Crosshair className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Fighter Jet Cockpit Telemetry: Jet radio static • Avionics chirp • Laser lock</span>
        </div>
      )}
    </div>
  );
}

export default ChatSoundToggle;
