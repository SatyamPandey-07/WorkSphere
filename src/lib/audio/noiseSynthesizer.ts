export type AmbientSoundType = 'white' | 'pink' | 'rain';

export interface AudioContextLike {
  sampleRate: number;
  currentTime: number;
  state: AudioContextState;
  destination: AudioNode;
  createBuffer: (
    numberOfChannels: number,
    length: number,
    sampleRate: number
  ) => AudioBuffer;
  createBufferSource: () => AudioBufferSourceNode;
  createBiquadFilter: () => BiquadFilterNode;
  createGain: () => GainNode;
  resume?: () => Promise<void> | void;
  close?: () => Promise<void> | void;
}

export interface NoiseSynthesizerOptions {
  soundType?: AmbientSoundType;
  volume?: number;
  muted?: boolean;
  bufferDurationSeconds?: number;
  audioContextFactory?: () => AudioContextLike;
}

export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

export function generateNoiseSamples(
  type: AmbientSoundType,
  length: number,
  sampleRate: number,
  rng: () => number = Math.random
): Float32Array {
  const safeLength = Math.max(1, Math.floor(length));
  const samples = new Float32Array(safeLength);

  if (type === 'white') {
    for (let i = 0; i < safeLength; i += 1) {
      samples[i] = rng() * 2 - 1;
    }
    return samples;
  }

  if (type === 'pink') {
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;

    for (let i = 0; i < safeLength; i += 1) {
      const white = rng() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
      samples[i] = Math.max(-1, Math.min(1, pink));
    }
    return samples;
  }

  let smooth = 0;
  let dropletEnv = 0;
  const decay = Math.exp(-1 / Math.max(1, sampleRate * 0.018));

  for (let i = 0; i < safeLength; i += 1) {
    const white = rng() * 2 - 1;
    smooth = 0.82 * smooth + 0.18 * white;
    if (rng() < 0.0015) {
      dropletEnv = Math.max(dropletEnv, rng() * 0.75);
    } else {
      dropletEnv *= decay;
    }
    const rainSample = smooth * 0.55 + white * dropletEnv * 0.45;
    samples[i] = Math.max(-1, Math.min(1, rainSample));
  }

  return samples;
}

function getDefaultAudioContextFactory(): () => AudioContextLike {
  return () => {
    const win = window as unknown as {
      AudioContext?: new () => AudioContextLike;
      webkitAudioContext?: new () => AudioContextLike;
    };
    const Ctor = win.AudioContext ?? win.webkitAudioContext;
    if (!Ctor) {
      throw new Error('Web Audio API is not supported in this browser');
    }
    return new Ctor();
  };
}

export class NoiseSynthesizer {
  private ctx: AudioContextLike | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private filterNode: BiquadFilterNode | null = null;
  private gainNode: GainNode | null = null;

  private soundType: AmbientSoundType;
  private volume: number;
  private muted: boolean;
  private isPlaying = false;
  private readonly bufferDurationSeconds: number;
  private readonly createContext: () => AudioContextLike;
  private listenersAttached = false;

  constructor(options: NoiseSynthesizerOptions = {}) {
    this.soundType = options.soundType ?? 'pink';
    this.volume = clampVolume(options.volume ?? 0.5);
    this.muted = Boolean(options.muted);
    this.bufferDurationSeconds = Math.max(1, options.bufferDurationSeconds ?? 3);
    this.createContext =
      options.audioContextFactory ?? getDefaultAudioContextFactory();
    this.attachLifecycleListeners();
  }

  private readonly handleVisibilityChange = (): void => {
    if (typeof document !== 'undefined' && document.hidden && this.isPlaying) {
      this.pause();
    }
  };

  private readonly handlePageHide = (): void => {
    if (this.isPlaying) {
      this.pause();
    }
  };

  private attachLifecycleListeners(): void {
    if (this.listenersAttached) return;
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.handlePageHide);
      window.addEventListener('beforeunload', this.handlePageHide);
    }
    this.listenersAttached = true;
  }

  public detachLifecycleListeners(): void {
    if (!this.listenersAttached) return;
    if (typeof document !== 'undefined') {
      document.removeEventListener(
        'visibilitychange',
        this.handleVisibilityChange
      );
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.handlePageHide);
      window.removeEventListener('beforeunload', this.handlePageHide);
    }
    this.listenersAttached = false;
  }

  private ensureContext(): AudioContextLike {
    if (!this.ctx) {
      this.ctx = this.createContext();
    }
    return this.ctx;
  }

  private applyGain(): void {
    if (!this.gainNode) return;
    const effectiveGain = this.muted ? 0 : clampVolume(this.volume);
    if (this.ctx && this.gainNode.gain && 'setTargetAtTime' in this.gainNode.gain) {
      this.gainNode.gain.setTargetAtTime(
        effectiveGain,
        this.ctx.currentTime ?? 0,
        0.015
      );
    } else if (this.gainNode.gain) {
      this.gainNode.gain.value = effectiveGain;
    }
  }

  private stopSourceOnly(): void {
    if (this.sourceNode) {
      try {
        this.sourceNode.stop();
      } catch {
        // Already stopped
      }
      try {
        this.sourceNode.disconnect();
      } catch {
        // Already disconnected
      }
      this.sourceNode = null;
    }
  }

  private buildLoopingGraph(ctx: AudioContextLike): void {
    this.stopSourceOnly();

    const sampleRate = ctx.sampleRate || 44100;
    const frameCount = Math.floor(sampleRate * this.bufferDurationSeconds);
    const buffer = ctx.createBuffer(1, frameCount, sampleRate);
    const samples = generateNoiseSamples(this.soundType, frameCount, sampleRate);

    if (typeof buffer.copyToChannel === 'function') {
      buffer.copyToChannel(samples, 0);
    } else if (typeof buffer.getChannelData === 'function') {
      buffer.getChannelData(0).set(samples);
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    if (this.soundType === 'rain') {
      filter.type = 'lowpass';
      filter.frequency.value = 1100;
    } else if (this.soundType === 'pink') {
      filter.type = 'lowshelf';
      filter.frequency.value = 600;
    } else {
      filter.type = 'allpass';
      filter.frequency.value = 1000;
    }

    const gain = ctx.createGain();
    this.gainNode = gain;
    this.filterNode = filter;
    this.sourceNode = source;

    this.applyGain();

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    source.start();
  }

  public async play(): Promise<void> {
    if (this.muted) {
      this.pause();
      return;
    }
    if (typeof document !== 'undefined' && document.hidden) {
      return;
    }

    const ctx = this.ensureContext();
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      await ctx.resume();
    }

    this.buildLoopingGraph(ctx);
    this.isPlaying = true;
  }

  public pause(): void {
    this.stopSourceOnly();
    this.isPlaying = false;
  }

  public async togglePlay(): Promise<boolean> {
    if (this.isPlaying) {
      this.pause();
      return false;
    }
    await this.play();
    return this.isPlaying;
  }

  public setSoundType(nextType: AmbientSoundType): void {
    this.soundType = nextType;
    if (this.isPlaying && this.ctx && !this.muted) {
      this.buildLoopingGraph(this.ctx);
    }
  }

  public setVolume(nextVolume: number): void {
    this.volume = clampVolume(nextVolume);
    this.applyGain();
  }

  public setMuted(nextMuted: boolean): void {
    this.muted = Boolean(nextMuted);
    if (this.muted && this.isPlaying) {
      this.pause();
    } else {
      this.applyGain();
    }
  }

  public getState() {
    return {
      isPlaying: this.isPlaying,
      soundType: this.soundType,
      volume: this.volume,
      muted: this.muted,
      hasFilterNode: Boolean(this.filterNode),
      hasGainNode: Boolean(this.gainNode),
    };
  }

  public async dispose(): Promise<void> {
    this.pause();
    this.detachLifecycleListeners();
    if (this.ctx && typeof this.ctx.close === 'function') {
      await this.ctx.close();
    }
    this.ctx = null;
    this.filterNode = null;
    this.gainNode = null;
  }
}
