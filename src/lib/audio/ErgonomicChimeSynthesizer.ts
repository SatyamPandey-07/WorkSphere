/**
 * ErgonomicChimeSynthesizer
 *
 * Synthesizes a soft singing-bowl style chime with the Web Audio API for
 * stretch and posture reminders. No audio files are loaded: two sine
 * oscillators (432 Hz and its octave, 864 Hz) are shaped with an exponential
 * gain decay and played through a master gain node that carries the volume
 * and mute state.
 */

/** Fundamental pitch of the bowl, in Hz. */
export const FUNDAMENTAL_HZ = 432;
/** Octave overtone of the fundamental, in Hz. */
export const OVERTONE_HZ = 864;
/** Default time for the fundamental to fade out, in seconds. */
export const CHIME_DURATION_SECONDS = 4;
/** Default master volume (0 to 1). */
export const DEFAULT_VOLUME = 0.5;

/** Short fade-in that avoids an audible click at the start of the chime. */
const ATTACK_SECONDS = 0.02;
/**
 * exponentialRampToValueAtTime cannot target exactly 0, so "silent" is a tiny
 * positive gain.
 */
const SILENT_GAIN = 0.0001;
/** Relative loudness of each voice; together they stay below 1. */
const FUNDAMENTAL_LEVEL = 0.7;
const OVERTONE_LEVEL = 0.25;
/** The overtone fades out faster than the fundamental, like a real bowl. */
const OVERTONE_DECAY_RATIO = 0.6;
/** Extra time before the oscillator is stopped, so the decay is never cut off. */
const STOP_PADDING_SECONDS = 0.05;
const MIN_DURATION_SECONDS = 0.5;

export interface ErgonomicChimeOptions {
  /** Master volume from 0 (silent) to 1 (full). Defaults to 0.5. */
  volume?: number;
  /** Start muted. Defaults to false. */
  muted?: boolean;
  /** How long the fundamental rings, in seconds. Defaults to 4. */
  durationSeconds?: number;
  /**
   * Creates the AudioContext. Defaults to the browser's AudioContext
   * (with the legacy webkit prefix as a fallback). Return null when audio is
   * unavailable. Mainly useful for tests.
   */
  audioContextFactory?: () => AudioContext | null;
}

/** Clamps a volume to 0-1. Non-numeric input returns the fallback. */
export function clampVolume(value: number, fallback = DEFAULT_VOLUME): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

function createBrowserAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

export class ErgonomicChimeSynthesizer {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private volume: number;
  private muted: boolean;
  private readonly durationSeconds: number;
  private readonly createContext: () => AudioContext | null;

  constructor(options: ErgonomicChimeOptions = {}) {
    this.volume = clampVolume(options.volume ?? DEFAULT_VOLUME);
    this.muted = options.muted ?? false;
    this.durationSeconds =
      typeof options.durationSeconds === "number" &&
      Number.isFinite(options.durationSeconds) &&
      options.durationSeconds >= MIN_DURATION_SECONDS
        ? options.durationSeconds
        : CHIME_DURATION_SECONDS;
    this.createContext =
      options.audioContextFactory ?? createBrowserAudioContext;
  }

  getVolume(): number {
    return this.volume;
  }

  isMuted(): boolean {
    return this.muted;
  }

  /** Sets the master volume (clamped to 0-1). Invalid values are ignored. */
  setVolume(value: number): void {
    this.volume = clampVolume(value, this.volume);
    this.applyMasterGain();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMasterGain();
  }

  /** Flips the mute state and returns the new value. */
  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /**
   * Plays one chime. Resolves to true when sound was scheduled, and to false
   * when it was skipped (muted, zero volume, no Web Audio support, or the
   * browser refused to start audio).
   *
   * Browsers only allow audio to start after a user gesture, so call this from
   * (or after) a click or key press.
   */
  async play(): Promise<boolean> {
    if (this.isSilenced()) return false;

    const ctx = this.ensureContext();
    if (!ctx || !this.master) return false;

    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        return false;
      }
      // The user may have muted while the context was resuming.
      if (this.isSilenced()) return false;
    }

    const start = ctx.currentTime;
    this.scheduleVoice(
      ctx,
      FUNDAMENTAL_HZ,
      FUNDAMENTAL_LEVEL,
      this.durationSeconds,
      start,
    );
    this.scheduleVoice(
      ctx,
      OVERTONE_HZ,
      OVERTONE_LEVEL,
      this.durationSeconds * OVERTONE_DECAY_RATIO,
      start,
    );
    return true;
  }

  /** Releases the audio context. A later play() creates a new one. */
  async dispose(): Promise<void> {
    const ctx = this.context;
    this.context = null;
    this.master = null;
    if (ctx && ctx.state !== "closed") {
      try {
        await ctx.close();
      } catch {
        // Already closed or not closable: nothing to release.
      }
    }
  }

  private isSilenced(): boolean {
    return this.muted || this.volume <= 0;
  }

  private ensureContext(): AudioContext | null {
    if (this.context && this.context.state !== "closed") return this.context;

    let ctx: AudioContext | null;
    try {
      ctx = this.createContext();
    } catch {
      ctx = null;
    }
    if (!ctx) return null;

    const master = ctx.createGain();
    master.connect(ctx.destination);
    this.context = ctx;
    this.master = master;
    this.applyMasterGain();
    return ctx;
  }

  private applyMasterGain(): void {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    const gain = this.master.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(this.muted ? 0 : this.volume, now);
  }

  private scheduleVoice(
    ctx: AudioContext,
    frequency: number,
    level: number,
    decaySeconds: number,
    start: number,
  ): void {
    const master = this.master;
    if (!master) return;

    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const end = start + Math.max(decaySeconds, ATTACK_SECONDS + 0.1);

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start);

    gain.gain.setValueAtTime(SILENT_GAIN, start);
    gain.gain.exponentialRampToValueAtTime(level, start + ATTACK_SECONDS);
    gain.gain.exponentialRampToValueAtTime(SILENT_GAIN, end);

    oscillator.connect(gain);
    gain.connect(master);

    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };

    oscillator.start(start);
    oscillator.stop(end + STOP_PADDING_SECONDS);
  }
}
