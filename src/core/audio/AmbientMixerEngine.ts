/**
 * AmbientMixerEngine.ts
 *
 * Procedural multi-layer ambient soundscape audio engine using the Web Audio API.
 * Supports independent binaural sound layers (Gentle Rain, Busy Coffee Shop, Pink Noise),
 * independent layer gain controls, master mute/unmute with level restoration,
 * smooth AudioParam ramps to eliminate clicks/pops, and SSR-safe instantiation.
 */

export type AmbientLayerId = 'rain' | 'coffee_shop' | 'pink_noise';

export interface AmbientLayerConfig {
  id: AmbientLayerId;
  name: string;
  description: string;
  defaultVolume: number; // 0 to 100
}

export interface AmbientLayerState {
  id: AmbientLayerId;
  enabled: boolean;
  volume: number; // 0 to 100
}

export interface AmbientEngineState {
  isInitialized: boolean;
  isMuted: boolean;
  masterVolume: number; // 0 to 100
  layers: Record<AmbientLayerId, AmbientLayerState>;
}

export const AMBIENT_LAYERS: readonly AmbientLayerConfig[] = [
  {
    id: 'rain',
    name: 'Gentle Rain',
    description: 'Soft, continuous rain-like noise with warm low-frequency filtering and gentle droplet texture',
    defaultVolume: 65,
  },
  {
    id: 'coffee_shop',
    name: 'Busy Coffee Shop',
    description: 'Subtle cafe ambience with distant room chatter murmur and warm room acoustic variations',
    defaultVolume: 60,
  },
  {
    id: 'pink_noise',
    name: 'Pink Noise',
    description: 'Balanced 1/f acoustic power spectrum noise for soothing focus and distraction masking',
    defaultVolume: 50,
  },
] as const;

export const DEFAULT_FADE_DURATION_S = 0.08;

/**
 * Applies equal-power loop crossfade to the boundaries of an AudioBuffer
 * to eliminate clicks, pops, and seams during continuous looping.
 */
export function applySeamlessLoopCrossfade(
  buffer: AudioBuffer,
  crossfadeSeconds = 0.1
): void {
  const sampleRate = buffer.sampleRate || 44100;
  const crossfadeFrames = Math.max(
    1,
    Math.min(
      Math.floor(sampleRate * crossfadeSeconds),
      Math.floor(buffer.length / 4)
    )
  );
  const totalFrames = buffer.length;

  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < crossfadeFrames; i++) {
      const progress = i / crossfadeFrames;
      const gainIn = Math.sin((progress * Math.PI) / 2);
      const gainOut = Math.cos((progress * Math.PI) / 2);
      const endIdx = totalFrames - crossfadeFrames + i;
      const mixed = data[i] * gainIn + data[endIdx] * gainOut;
      data[i] = mixed;
      data[endIdx] = mixed;
    }
  }
}

/**
 * Procedural Gentle Rain buffer generator.
 * Uses filtered lowpass noise and soft randomized micro-droplets.
 * Stereo synthesis with slight phase difference for binaural depth.
 */
export function generateRainBuffer(
  ctx: AudioContext,
  durationSeconds = 4
): AudioBuffer {
  const sampleRate = ctx.sampleRate || 44100;
  const frameCount = Math.floor(sampleRate * durationSeconds);
  const buffer = ctx.createBuffer(2, frameCount, sampleRate);

  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    let lowpass = 0;
    for (let i = 0; i < frameCount; i++) {
      const white = Math.random() * 2 - 1;
      // Gentle filtered lowpass base (rain wash)
      lowpass = (lowpass + 0.045 * white) / 1.045;
      // Soft micro-droplets occurring probabilistically
      const droplet = Math.random() < 0.012 ? (Math.random() * 2 - 1) * 0.18 : 0;
      data[i] = (lowpass * 1.9 + droplet) * 0.28;
    }
  }

  applySeamlessLoopCrossfade(buffer, 0.15);
  return buffer;
}

/**
 * Procedural Busy Coffee Shop buffer generator.
 * Uses multi-rate filtered noise, low rumble room resonances, and dynamic murmur envelopes
 * to simulate distant room chatter and cafe activity without intelligible words.
 */
export function generateCoffeeShopBuffer(
  ctx: AudioContext,
  durationSeconds = 4
): AudioBuffer {
  const sampleRate = ctx.sampleRate || 44100;
  const frameCount = Math.floor(sampleRate * durationSeconds);
  const buffer = ctx.createBuffer(2, frameCount, sampleRate);

  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    let roomRumble = 0;
    let speechMurmur = 0;
    // Vary the murmur modulation period slightly per channel for binaural stereo width
    const modulationPeriod = c === 0 ? 1.6 : 1.9;

    for (let i = 0; i < frameCount; i++) {
      const white = Math.random() * 2 - 1;
      // Low rumble room tone
      roomRumble = (roomRumble + 0.02 * white) / 1.02;
      // Murmur modulation envelope simulating gentle conversational ebb and flow
      const mod = 0.75 + 0.35 * Math.sin((2 * Math.PI * i) / (sampleRate * modulationPeriod));
      speechMurmur = (speechMurmur + 0.07 * white * mod) / 1.07;
      data[i] = (roomRumble * 1.35 + speechMurmur * 0.85) * 0.24;
    }
  }

  applySeamlessLoopCrossfade(buffer, 0.15);
  return buffer;
}

/**
 * Procedural Pink Noise buffer generator (Paul Kellet's filtered filter method).
 * Accurately models a 1/f (-3 dB/octave) spectral slope.
 */
export function generatePinkNoiseBuffer(
  ctx: AudioContext,
  durationSeconds = 4
): AudioBuffer {
  const sampleRate = ctx.sampleRate || 44100;
  const frameCount = Math.floor(sampleRate * durationSeconds);
  const buffer = ctx.createBuffer(2, frameCount, sampleRate);

  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;

    for (let i = 0; i < frameCount; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      data[i] =
        ((b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) / 6.5) * 0.22;
      b6 = white * 0.115926;
    }
  }

  applySeamlessLoopCrossfade(buffer, 0.1);
  return buffer;
}

interface AudioLayerNodeGroup {
  gainNode: GainNode;
  sourceNode: AudioBufferSourceNode | null;
  buffer: AudioBuffer | null;
}

export class AmbientMixerEngine {
  private audioContext: AudioContext | null = null;
  private masterGainNode: GainNode | null = null;
  private layers = new Map<AmbientLayerId, AudioLayerNodeGroup>();
  private layerVolumes: Record<AmbientLayerId, number> = {
    rain: 65,
    coffee_shop: 60,
    pink_noise: 50,
  };
  private layerActive: Record<AmbientLayerId, boolean> = {
    rain: false,
    coffee_shop: false,
    pink_noise: false,
  };
  private isMuted: boolean = false;
  private masterVolume: number = 100;
  private initialized: boolean = false;

  constructor() {
    // SSR Safe: Do not initialize Web Audio in constructor
  }

  /**
   * Safely checks if Web Audio API is supported in the current environment.
   */
  public static isSupported(): boolean {
    if (typeof window === 'undefined') return false;
    return !!(
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    );
  }

  /**
   * Initializes the AudioContext and layer gain graph.
   * Safe to call multiple times (no duplicate contexts created).
   */
  public async initialize(): Promise<boolean> {
    if (this.initialized && this.audioContext) {
      if (this.audioContext.state === 'suspended') {
        try {
          await this.audioContext.resume();
        } catch {
          // Autoplay policy or gesture required
        }
      }
      return true;
    }

    if (!AmbientMixerEngine.isSupported()) {
      return false;
    }

    try {
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioContext = new AudioCtxClass();

      // Master Gain Node -> Destination
      this.masterGainNode = this.audioContext.createGain();
      const targetMasterGain = this.isMuted ? 0 : this.masterVolume / 100;
      this.masterGainNode.gain.setValueAtTime(targetMasterGain, this.audioContext.currentTime);
      this.masterGainNode.connect(this.audioContext.destination);

      // Initialize Gain Nodes for each known layer
      for (const config of AMBIENT_LAYERS) {
        const layerGain = this.audioContext.createGain();
        const initialGain = this.layerActive[config.id]
          ? (this.layerVolumes[config.id] ?? config.defaultVolume) / 100
          : 0;
        layerGain.gain.setValueAtTime(initialGain, this.audioContext.currentTime);
        layerGain.connect(this.masterGainNode);

        this.layers.set(config.id, {
          gainNode: layerGain,
          sourceNode: null,
          buffer: null,
        });
      }

      this.initialized = true;

      if (this.audioContext.state === 'suspended') {
        try {
          await this.audioContext.resume();
        } catch {
          // Will resume upon user gesture
        }
      }

      return true;
    } catch {
      this.initialized = false;
      return false;
    }
  }

  /**
   * Helper to ensure AudioContext is initialized and active before playback.
   */
  private async ensureAudioContext(): Promise<boolean> {
    if (!this.initialized || !this.audioContext) {
      const ok = await this.initialize();
      if (!ok || !this.audioContext) return false;
    }

    if (this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
      } catch {
        return false;
      }
    }

    return true;
  }

  /**
   * Generates or retrieves cached AudioBuffer for the given layer.
   */
  private getLayerBuffer(layerId: AmbientLayerId): AudioBuffer | null {
    if (!this.audioContext) return null;
    const layer = this.layers.get(layerId);
    if (layer?.buffer) return layer.buffer;

    let buf: AudioBuffer;
    switch (layerId) {
      case 'rain':
        buf = generateRainBuffer(this.audioContext);
        break;
      case 'coffee_shop':
        buf = generateCoffeeShopBuffer(this.audioContext);
        break;
      case 'pink_noise':
        buf = generatePinkNoiseBuffer(this.audioContext);
        break;
      default:
        buf = generatePinkNoiseBuffer(this.audioContext);
    }

    if (layer) {
      layer.buffer = buf;
    }
    return buf;
  }

  /**
   * Starts an individual sound layer with smooth fade-in.
   */
  public async startLayer(layerId: AmbientLayerId, fadeDuration = DEFAULT_FADE_DURATION_S): Promise<void> {
    const ready = await this.ensureAudioContext();
    if (!ready || !this.audioContext) return;

    const layer = this.layers.get(layerId);
    if (!layer) return;

    this.layerActive[layerId] = true;
    const targetVolume = (this.layerVolumes[layerId] ?? 60) / 100;

    // If already playing, just ramp up gain smoothly to target
    if (layer.sourceNode) {
      this.rampGain(layer.gainNode, targetVolume, fadeDuration);
      return;
    }

    // Generate/cache buffer and create source node
    const buffer = this.getLayerBuffer(layerId);
    if (!buffer) return;

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(layer.gainNode);

    // Initial silent gain before ramp
    layer.gainNode.gain.setValueAtTime(0.0001, this.audioContext.currentTime);

    const now = this.audioContext.currentTime;
    source.start(now);
    layer.sourceNode = source;

    // Smooth fade in
    this.rampGain(layer.gainNode, targetVolume, fadeDuration);
  }

  /**
   * Stops an individual sound layer with smooth fade-out and node disconnection.
   */
  public stopLayer(layerId: AmbientLayerId, fadeDuration = DEFAULT_FADE_DURATION_S): void {
    this.layerActive[layerId] = false;

    const layer = this.layers.get(layerId);
    if (!layer || !this.audioContext) return;

    const currentSource = layer.sourceNode;
    if (!currentSource) {
      this.rampGain(layer.gainNode, 0, fadeDuration);
      return;
    }

    // Smoothly fade out gain
    this.rampGain(layer.gainNode, 0, fadeDuration);

    // After fade duration, stop and disconnect source to prevent clicks/leaks
    layer.sourceNode = null;
    const stopTime = this.audioContext.currentTime + fadeDuration + 0.02;

    try {
      currentSource.stop(stopTime);
    } catch {
      // Source might have been stopped
    }

    setTimeout(() => {
      try {
        currentSource.disconnect();
      } catch {
        // Disconnect safe
      }
    }, Math.max(50, Math.ceil(fadeDuration * 1000) + 30));
  }

  /**
   * Sets the volume of an individual layer (0 - 100) with smooth ramp.
   */
  public setLayerVolume(
    layerId: AmbientLayerId,
    volume: number,
    fadeDuration = DEFAULT_FADE_DURATION_S
  ): void {
    const clamped = Math.max(0, Math.min(100, isNaN(volume) ? 0 : volume));
    this.layerVolumes[layerId] = clamped;

    const layer = this.layers.get(layerId);
    if (!layer || !this.audioContext) return;

    if (this.layerActive[layerId]) {
      const targetGain = clamped / 100;
      this.rampGain(layer.gainNode, targetGain, fadeDuration);
    }
  }

  /**
   * Toggles or sets master mute state. Preserves individual layer volume preferences.
   */
  public setMasterMuted(muted: boolean, fadeDuration = DEFAULT_FADE_DURATION_S): void {
    this.isMuted = muted;
    if (!this.masterGainNode || !this.audioContext) return;

    const targetGain = muted ? 0 : this.masterVolume / 100;
    this.rampGain(this.masterGainNode, targetGain, fadeDuration);
  }

  /**
   * Sets overall master volume (0 - 100).
   */
  public setMasterVolume(volume: number, fadeDuration = DEFAULT_FADE_DURATION_S): void {
    const clamped = Math.max(0, Math.min(100, isNaN(volume) ? 0 : volume));
    this.masterVolume = clamped;

    if (!this.masterGainNode || !this.audioContext) return;

    if (!this.isMuted) {
      const targetGain = clamped / 100;
      this.rampGain(this.masterGainNode, targetGain, fadeDuration);
    }
  }

  /**
   * Stops all active layers.
   */
  public stopAll(fadeDuration = DEFAULT_FADE_DURATION_S): void {
    for (const config of AMBIENT_LAYERS) {
      if (this.layerActive[config.id]) {
        this.stopLayer(config.id, fadeDuration);
      }
    }
  }

  /**
   * Smooth AudioParam ramp using cancelScheduledValues and setTargetAtTime
   * or linearRampToValueAtTime to eliminate pops and clicks.
   */
  private rampGain(gainNode: GainNode, targetValue: number, duration: number): void {
    if (!this.audioContext) return;
    const now = this.audioContext.currentTime;
    const clampedTarget = Math.max(0, Math.min(1, isNaN(targetValue) ? 0 : targetValue));

    try {
      gainNode.gain.cancelScheduledValues(now);
      // Anchor current value
      gainNode.gain.setValueAtTime(gainNode.gain.value, now);
      // Smooth exponential decay/approach with setTargetAtTime timeConstant
      const timeConstant = Math.max(0.015, duration / 3);
      if (typeof gainNode.gain.setTargetAtTime === 'function') {
        gainNode.gain.setTargetAtTime(clampedTarget, now, timeConstant);
      } else {
        gainNode.gain.linearRampToValueAtTime(clampedTarget, now + duration);
      }
    } catch {
      // Fallback
      try {
        gainNode.gain.value = clampedTarget;
      } catch {
        // Safe fallback
      }
    }
  }

  /**
   * Returns current engine state.
   */
  public getState(): AmbientEngineState {
    const layers = {} as Record<AmbientLayerId, AmbientLayerState>;
    for (const config of AMBIENT_LAYERS) {
      layers[config.id] = {
        id: config.id,
        enabled: !!this.layerActive[config.id],
        volume: this.layerVolumes[config.id] ?? config.defaultVolume,
      };
    }

    return {
      isInitialized: this.initialized,
      isMuted: this.isMuted,
      masterVolume: this.masterVolume,
      layers,
    };
  }

  /**
   * Gets direct access to the AudioContext if needed.
   */
  public getAudioContext(): AudioContext | null {
    return this.audioContext;
  }

  /**
   * Cleanup and disposal of all audio nodes and audio context.
   */
  public dispose(): void {
    this.stopAll(0.01);

    for (const [, layer] of this.layers) {
      if (layer.sourceNode) {
        try {
          layer.sourceNode.stop();
          layer.sourceNode.disconnect();
        } catch {
          // Safe disconnect
        }
        layer.sourceNode = null;
      }
      try {
        layer.gainNode.disconnect();
      } catch {
        // Safe disconnect
      }
      layer.buffer = null;
    }
    this.layers.clear();

    if (this.masterGainNode) {
      try {
        this.masterGainNode.disconnect();
      } catch {
        // Safe disconnect
      }
      this.masterGainNode = null;
    }

    if (this.audioContext) {
      try {
        if (this.audioContext.state !== 'closed') {
          this.audioContext.close();
        }
      } catch {
        // Safe close
      }
      this.audioContext = null;
    }

    this.initialized = false;
  }
}

export default AmbientMixerEngine;
