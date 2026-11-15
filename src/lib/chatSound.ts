"use client";

export const CHAT_SOUND_STORAGE_KEY = "worksphere_chat_sound_enabled";
export const CHAT_SOUND_CHANGE_EVENT = "worksphere_chat_sound_change";
export const DEFAULT_CHAT_SOUND_FILE = "/sounds/notification-chime.mp3";

export const AUDIO_PROFILE_STORAGE_KEY = "worksphere_audio_profile";
export const AUDIO_PROFILE_CHANGE_EVENT = "worksphere_audio_profile_change";

export type AudioProfile = "Standard Bell" | "Fighter Jet Avionics" | "Mute";

export const AUDIO_PROFILES: readonly AudioProfile[] = [
  "Standard Bell",
  "Fighter Jet Avionics",
  "Mute",
] as const;

export const DEFAULT_AUDIO_PROFILE: AudioProfile = "Standard Bell";

/**
 * Retrieves the current audio profile from localStorage.
 * Defaults to "Standard Bell" if unset.
 * If worksphere_chat_sound_enabled is explicitly set to "false" and worksphere_audio_profile is unset,
 * returns "Mute" for backward compatibility.
 */
export function getAudioProfile(): AudioProfile {
  if (typeof window === "undefined") return DEFAULT_AUDIO_PROFILE;
  try {
    const val = localStorage.getItem(AUDIO_PROFILE_STORAGE_KEY);
    if (val === "Standard Bell" || val === "Fighter Jet Avionics" || val === "Mute") {
      return val;
    }
    // Backward compatibility with worksphere_chat_sound_enabled
    const soundEnabled = localStorage.getItem(CHAT_SOUND_STORAGE_KEY);
    if (soundEnabled === "false") {
      return "Mute";
    }
    return DEFAULT_AUDIO_PROFILE;
  } catch {
    return DEFAULT_AUDIO_PROFILE;
  }
}

/**
 * Persists audio profile selection to localStorage and broadcasts change events.
 * Synchronizes with worksphere_chat_sound_enabled so existing sound guards remain consistent.
 */
export function setAudioProfile(profile: AudioProfile): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(AUDIO_PROFILE_STORAGE_KEY, profile);
    const isMuted = profile === "Mute";
    localStorage.setItem(CHAT_SOUND_STORAGE_KEY, String(!isMuted));

    window.dispatchEvent(
      new CustomEvent<AudioProfile>(AUDIO_PROFILE_CHANGE_EVENT, { detail: profile })
    );
    window.dispatchEvent(
      new CustomEvent<boolean>(CHAT_SOUND_CHANGE_EVENT, { detail: !isMuted })
    );
  } catch {
    // storage unavailable (e.g. private mode or quota)
  }
}

/**
 * Checks if chat sound effects are enabled in localStorage.
 * Defaults to true if no preference is stored.
 */
export function isChatSoundEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const profile = localStorage.getItem(AUDIO_PROFILE_STORAGE_KEY);
    if (profile === "Mute") return false;
    if (profile === "Standard Bell" || profile === "Fighter Jet Avionics") return true;

    const val = localStorage.getItem(CHAT_SOUND_STORAGE_KEY);
    return val === null ? true : val === "true";
  } catch {
    return true;
  }
}

/**
 * Persists chat sound effects preference to localStorage and broadcasts change event.
 */
export function setChatSoundEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CHAT_SOUND_STORAGE_KEY, String(enabled));
    if (!enabled) {
      localStorage.setItem(AUDIO_PROFILE_STORAGE_KEY, "Mute");
      window.dispatchEvent(
        new CustomEvent<AudioProfile>(AUDIO_PROFILE_CHANGE_EVENT, { detail: "Mute" })
      );
    } else {
      const current = localStorage.getItem(AUDIO_PROFILE_STORAGE_KEY);
      const nextProfile: AudioProfile =
        current === "Mute" || !current ? DEFAULT_AUDIO_PROFILE : (current as AudioProfile);
      localStorage.setItem(AUDIO_PROFILE_STORAGE_KEY, nextProfile);
      window.dispatchEvent(
        new CustomEvent<AudioProfile>(AUDIO_PROFILE_CHANGE_EVENT, { detail: nextProfile })
      );
    }
    window.dispatchEvent(
      new CustomEvent<boolean>(CHAT_SOUND_CHANGE_EVENT, { detail: enabled })
    );
  } catch {
    // storage unavailable
  }
}

/**
 * Synthesizes Hal Jordan "Fighter Jet Cockpit Telemetry" sound effects:
 * - Jet radio static burst (filtered white noise simulating cockpit radio transmission squelch)
 * - Avionics chirp (tactical high-speed frequency ramp)
 * - Laser lock (sharp double-pip lock-on tone)
 */
export function playCockpitTelemetrySound(volume: number = 0.3): boolean {
  if (typeof window === "undefined") return false;
  if (typeof volume === "number" && Number.isFinite(volume) && volume <= 0) {
    return false;
  }
  const safeVolume =
    typeof volume === "number" && Number.isFinite(volume)
      ? Math.min(1, Math.max(0.001, volume))
      : 0.3;

  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return false;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    // 1. Jet Radio Static Burst (~60ms)
    const bufferSize = Math.floor(ctx.sampleRate * 0.06);
    if (bufferSize > 0) {
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }
      const whiteNoise = ctx.createBufferSource();
      whiteNoise.buffer = noiseBuffer;

      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(1600, now);
      filter.Q.setValueAtTime(2.0, now);

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.08 * safeVolume, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);

      whiteNoise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(ctx.destination);

      whiteNoise.start(now);
      whiteNoise.stop(now + 0.06);
    }

    // 2. Avionics Chirp (Frequency sweep: 1400Hz -> 2600Hz, ~70ms)
    const chirpStartTime = now + 0.04;
    const chirpOsc = ctx.createOscillator();
    const chirpGain = ctx.createGain();
    chirpOsc.type = "sine";
    chirpOsc.frequency.setValueAtTime(1400, chirpStartTime);
    chirpOsc.frequency.exponentialRampToValueAtTime(2600, chirpStartTime + 0.07);

    chirpGain.gain.setValueAtTime(0.001, chirpStartTime);
    chirpGain.gain.linearRampToValueAtTime(0.2 * safeVolume, chirpStartTime + 0.015);
    chirpGain.gain.exponentialRampToValueAtTime(0.0001, chirpStartTime + 0.07);

    chirpOsc.connect(chirpGain);
    chirpGain.connect(ctx.destination);
    chirpOsc.start(chirpStartTime);
    chirpOsc.stop(chirpStartTime + 0.08);

    // 3. Laser Lock (Double Pip: 2400Hz and 2800Hz)
    const pip1Start = now + 0.12;
    const pip1Osc = ctx.createOscillator();
    const pip1Gain = ctx.createGain();
    pip1Osc.type = "triangle";
    pip1Osc.frequency.setValueAtTime(2400, pip1Start);
    pip1Gain.gain.setValueAtTime(0.25 * safeVolume, pip1Start);
    pip1Gain.gain.exponentialRampToValueAtTime(0.0001, pip1Start + 0.045);

    pip1Osc.connect(pip1Gain);
    pip1Gain.connect(ctx.destination);
    pip1Osc.start(pip1Start);
    pip1Osc.stop(pip1Start + 0.05);

    const pip2Start = now + 0.18;
    const pip2Osc = ctx.createOscillator();
    const pip2Gain = ctx.createGain();
    pip2Osc.type = "triangle";
    pip2Osc.frequency.setValueAtTime(2800, pip2Start);
    pip2Gain.gain.setValueAtTime(0.28 * safeVolume, pip2Start);
    pip2Gain.gain.exponentialRampToValueAtTime(0.0001, pip2Start + 0.055);

    pip2Osc.connect(pip2Gain);
    pip2Gain.connect(ctx.destination);
    pip2Osc.start(pip2Start);
    pip2Osc.stop(pip2Start + 0.06);

    // Safely close context after audio finishes
    const timer = setTimeout(() => {
      if (ctx.state !== "closed") {
        ctx.close().catch(() => {});
      }
    }, 600);
    if (typeof timer === "object" && typeof (timer as any).unref === "function") {
      (timer as any).unref();
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Synthesizes a subtle bell chime fallback via Web Audio API.
 */
export function playSynthesizedBell(volume: number = 0.2): boolean {
  if (typeof window === "undefined") return false;
  if (typeof volume === "number" && Number.isFinite(volume) && volume <= 0) {
    return false;
  }
  const safeVolume =
    typeof volume === "number" && Number.isFinite(volume)
      ? Math.min(1, Math.max(0.001, volume))
      : 0.2;

  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return false;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.15);
    gain.gain.setValueAtTime(safeVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.65);
    const timer = setTimeout(() => {
      if (ctx.state !== "closed") ctx.close().catch(() => {});
    }, 800);
    if (typeof timer === "object" && typeof (timer as any).unref === "function") {
      (timer as any).unref();
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Plays the standard subtle bell chime.
 */
export function playStandardBellSound(soundSrc: string = DEFAULT_CHAT_SOUND_FILE): boolean {
  if (typeof window === "undefined") return false;
  try {
    const audio = new Audio(soundSrc);
    const promise = audio.play();
    if (promise !== undefined) {
      promise.catch(() => {
        // Fallback to Web Audio synthesis if HTML5 audio fails
        playSynthesizedBell();
      });
    }
    return true;
  } catch {
    return playSynthesizedBell();
  }
}

/**
 * Auditions / previews an audio profile without checking global mute status,
 * allowing users to test sounds before selecting.
 */
export function playAudioProfilePreview(
  profile: AudioProfile,
  soundSrc: string = DEFAULT_CHAT_SOUND_FILE
): boolean {
  if (typeof window === "undefined") return false;
  if (profile === "Mute") return false;
  if (profile === "Fighter Jet Avionics") {
    return playCockpitTelemetrySound();
  }
  return playStandardBellSound(soundSrc);
}

/**
 * Plays the incoming chat message notification chime according to the configured audio profile.
 * Returns true if played, false if muted or failed.
 */
export function playChatMessageSound(soundSrc: string = DEFAULT_CHAT_SOUND_FILE): boolean {
  if (typeof window === "undefined") return false;
  if (!isChatSoundEnabled()) return false;

  const profile = getAudioProfile();
  if (profile === "Mute") return false;

  if (profile === "Fighter Jet Avionics") {
    return playCockpitTelemetrySound();
  }

  return playStandardBellSound(soundSrc);
}
