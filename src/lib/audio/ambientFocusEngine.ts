/**
 * ambientFocusEngine.ts
 * Web Audio API synthesizer for ambient background soundscapes (Rain, Cafe, Binaural Beats, Vinyl)
 * and synchronized Pomodoro sprint state machine.
 */

export type PomodoroPhase = "FOCUS_SPRINT" | "SHORT_BREAK" | "LONG_BREAK";

export interface PomodoroState {
  phase: PomodoroPhase;
  durationMinutes: number;
  remainingSeconds: number;
  isRunning: boolean;
  sprintCount: number;
}

export interface SoundTrackState {
  id: "rain" | "cafe" | "vinyl" | "binaural" | "whitenoise";
  name: string;
  volume: number; // 0 to 1
  pan: number;    // -1 (Left) to +1 (Right)
  enabled: boolean;
}

export interface PeerSprintIntention {
  id: string;
  userId: string;
  userName: string;
  avatarUrl?: string;
  taskText: string;
  isCompleted: boolean;
}

interface ActiveTrackNode {
  source: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  panner: StereoPannerNode;
  gain: GainNode;
  volume: number;
  pan: number;
  stopped: boolean;
}

export class AmbientAudioSynthesizer {
  private ctx: AudioContext | null = null;
  private noiseNodes: Map<string, ActiveTrackNode> = new Map();
  private isMuted: boolean = false;
  private isDisposed: boolean = false;

  constructor(audioContext?: AudioContext) {
    if (audioContext) {
      this.ctx = audioContext;
    }
  }

  public init() {
    if (this.isDisposed) return;
    if (!this.ctx && typeof window !== "undefined") {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      try {
        this.ctx.resume();
      } catch (_) {}
    }
  }

  public getContext(): AudioContext | null {
    return this.ctx;
  }

  public isAudioMuted(): boolean {
    return this.isMuted;
  }

  public isPlaying(trackId: string): boolean {
    const node = this.noiseNodes.get(trackId);
    return Boolean(node && !node.stopped);
  }

  public getPlayingTracks(): string[] {
    const playing: string[] = [];
    for (const [id, node] of this.noiseNodes.entries()) {
      if (!node.stopped) {
        playing.push(id);
      }
    }
    return playing;
  }

  /**
   * Generates continuous filtered noise buffers for rain / cafe / ambient textures.
   */
  public playTrack(trackId: SoundTrackState["id"], volume: number, pan: number) {
    if (this.isDisposed) return;
    this.init();
    if (!this.ctx) return;

    const safeVol = typeof volume === "number" && Number.isFinite(volume)
      ? Math.max(0, Math.min(1, volume))
      : 0.5;
    const safePan = typeof pan === "number" && Number.isFinite(pan)
      ? Math.max(-1, Math.min(1, pan))
      : 0;

    if (this.noiseNodes.has(trackId)) {
      const node = this.noiseNodes.get(trackId)!;
      if (!node.stopped) {
        node.volume = safeVol;
        node.pan = safePan;
        const targetGain = this.isMuted ? 0 : safeVol * 0.3;
        try {
          node.gain.gain.setValueAtTime(targetGain, this.ctx.currentTime);
          node.panner.pan.setValueAtTime(safePan, this.ctx.currentTime);
        } catch (_) {}
        return;
      }
      this.stopTrack(trackId);
    }

    const sampleRate = this.ctx.sampleRate || 48000;
    const bufferSize = sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, sampleRate);
    const output = noiseBuffer.getChannelData(0);

    let lastOut = 0.0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      if (trackId === "rain") {
        // Brown noise approximation
        output[i] = (lastOut + 0.02 * white) / 1.02;
        lastOut = output[i];
      } else if (trackId === "binaural") {
        // Low frequency hum
        output[i] = Math.sin((i / sampleRate) * 2 * Math.PI * 140) * 0.5;
      } else {
        // Pinkish ambient murmur
        output[i] = (lastOut + 0.05 * white) / 1.05;
        lastOut = output[i];
      }
    }

    const whiteNoise = this.ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;

    // Filter node to soften high harsh frequencies
    const filter = this.ctx.createBiquadFilter();
    filter.type = trackId === "rain" ? "lowpass" : "bandpass";
    filter.frequency.setValueAtTime(trackId === "rain" ? 800 : 400, this.ctx.currentTime);

    const panner = this.ctx.createStereoPanner();
    panner.pan.setValueAtTime(safePan, this.ctx.currentTime);

    const gain = this.ctx.createGain();
    const initialGain = this.isMuted ? 0 : safeVol * 0.3;
    gain.gain.setValueAtTime(initialGain, this.ctx.currentTime);

    whiteNoise.connect(filter);
    filter.connect(panner);
    panner.connect(gain);
    gain.connect(this.ctx.destination);

    whiteNoise.start();

    this.noiseNodes.set(trackId, {
      source: whiteNoise,
      filter,
      panner,
      gain,
      volume: safeVol,
      pan: safePan,
      stopped: false,
    });
  }

  public stopTrack(trackId: string) {
    if (this.noiseNodes.has(trackId)) {
      const node = this.noiseNodes.get(trackId)!;
      if (!node.stopped) {
        node.stopped = true;
        if (this.ctx) {
          try {
            node.gain.gain.setValueAtTime(0, this.ctx.currentTime);
          } catch (_) {}
        }
        try {
          node.source.stop();
        } catch (_) {}
        try {
          node.source.disconnect();
          node.filter.disconnect();
          node.panner.disconnect();
          node.gain.disconnect();
        } catch (_) {}
      }
      this.noiseNodes.delete(trackId);
    }
  }

  /**
   * Plays a gentle acoustic chime when Pomodoro intervals transition.
   */
  public playChime() {
    if (this.isDisposed) return;
    this.init();
    if (!this.ctx || this.isMuted) return;

    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, this.ctx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, this.ctx.currentTime + 0.3); // A5

      gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 1.8);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch (_) {}
      };

      osc.start();
      osc.stop(this.ctx.currentTime + 1.8);
    } catch (_) {}
  }

  public setMuted(muted: boolean) {
    this.isMuted = Boolean(muted);
    if (this.ctx) {
      for (const [_, node] of this.noiseNodes.entries()) {
        if (!node.stopped) {
          const targetGain = this.isMuted ? 0 : node.volume * 0.3;
          try {
            node.gain.gain.setValueAtTime(targetGain, this.ctx.currentTime);
          } catch (_) {}
        }
      }
    }
  }

  public dispose() {
    this.isDisposed = true;
    for (const trackId of Array.from(this.noiseNodes.keys())) {
      this.stopTrack(trackId);
    }
    this.noiseNodes.clear();
  }
}
