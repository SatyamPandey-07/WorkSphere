/**
 * RoomReverbConvolver.ts
 * Synthetic impulse response generator and ConvolverNode audio filter for realistic
 * venue room acoustics (phone booths: 0.15s RT60, meeting rooms: 0.45s RT60, open halls: 1.2s RT60).
 */

export type RoomAcousticPreset = "phone_booth" | "conference_room" | "open_hall";

export interface ReverbProfileConfig {
  name: RoomAcousticPreset | "custom";
  /** RT60 reverberation decay time in seconds (time to decay by 60 dB) */
  rt60Seconds: number;
  /** Initial reflection delay in seconds */
  preDelaySeconds?: number;
  /** High frequency absorption / damping factor */
  dampingFactor?: number;
  /** Dry/Wet balance ratio between 0.0 (100% dry) and 1.0 (100% wet) */
  dryWetRatio?: number;
  /** Number of audio channels for impulse response (1 for mono, 2 for stereo) */
  channels?: number;
}

export const ROOM_REVERB_PRESETS: Record<RoomAcousticPreset, ReverbProfileConfig> = {
  phone_booth: {
    name: "phone_booth",
    rt60Seconds: 0.15,
    preDelaySeconds: 0.003,
    dampingFactor: 3.5,
    dryWetRatio: 0.18,
    channels: 2,
  },
  conference_room: {
    name: "conference_room",
    rt60Seconds: 0.45,
    preDelaySeconds: 0.012,
    dampingFactor: 2.2,
    dryWetRatio: 0.35,
    channels: 2,
  },
  open_hall: {
    name: "open_hall",
    rt60Seconds: 1.2,
    preDelaySeconds: 0.028,
    dampingFactor: 1.5,
    dryWetRatio: 0.55,
    channels: 2,
  },
};

/**
 * Algorithmic synthetic impulse response buffer generator with exponential decay.
 * Synthesizes natural room reflections modeling RT60 decay time.
 */
export function generateImpulseResponse(
  audioContext: AudioContext,
  rt60Seconds: number,
  options: {
    preDelaySeconds?: number;
    dampingFactor?: number;
    channels?: number;
  } = {}
): AudioBuffer {
  const sampleRate = audioContext.sampleRate || 44100;
  const duration = Math.max(0.05, rt60Seconds);
  const length = Math.ceil(sampleRate * duration);
  const channels = options.channels || 2;
  const preDelay = options.preDelaySeconds || 0;
  const damping = options.dampingFactor || 2.0;

  const impulseBuffer = audioContext.createBuffer(channels, length, sampleRate);

  // RT60 constant: amplitude decays to -60 dB (0.001 amplitude factor) over rt60Seconds
  // e^(-decayConstant * rt60) = 0.001 => decayConstant = ln(1000) / rt60 ≈ 6.9078 / rt60
  const decayConstant = 6.9078 / duration;

  for (let c = 0; c < channels; c++) {
    const channelData = impulseBuffer.getChannelData(c);
    // Slight channel decorrelation phase offset for stereo realism
    const channelOffset = c * 0.002;

    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;

      if (t < preDelay) {
        channelData[i] = 0;
        continue;
      }

      const activeTime = t - preDelay;

      // Base uniform white noise reflection burst [-1.0, 1.0]
      const noise = Math.random() * 2 - 1;

      // Natural exponential decay envelope
      const decay = Math.exp(-decayConstant * activeTime);

      // High-frequency damping factor over time
      const dampingEnvelope = Math.pow(Math.max(0, 1 - (activeTime / duration)), damping);

      // Decorrelation stereo spread
      const decorrelation = Math.cos(2 * Math.PI * 180 * (t + channelOffset));

      channelData[i] = noise * decay * dampingEnvelope * (0.8 + 0.2 * decorrelation);
    }
  }

  return impulseBuffer;
}

export interface RoomReverbConvolverOptions {
  preset?: RoomAcousticPreset;
  customProfile?: Partial<ReverbProfileConfig> & { rt60Seconds: number };
  dryWetRatio?: number;
}

/**
 * RoomReverbConvolver
 * Audio filter graph managing ConvolverNode with synthetic impulse responses,
 * providing seamless acoustic room transitions across coworking environments.
 */
export class RoomReverbConvolver {
  private audioContext: AudioContext;
  public inputNode: GainNode;
  public outputNode: GainNode;
  public convolverNode: ConvolverNode;
  public dryGain: GainNode;
  public wetGain: GainNode;

  private currentPreset: RoomAcousticPreset | "custom";
  private currentConfig: ReverbProfileConfig;

  constructor(audioContext: AudioContext, options: RoomReverbConvolverOptions = {}) {
    this.audioContext = audioContext;

    const presetName = options.preset || "conference_room";
    this.currentPreset = presetName;
    this.currentConfig = options.customProfile
      ? {
          name: "custom",
          rt60Seconds: options.customProfile.rt60Seconds,
          preDelaySeconds: options.customProfile.preDelaySeconds ?? 0.01,
          dampingFactor: options.customProfile.dampingFactor ?? 2.0,
          dryWetRatio: options.customProfile.dryWetRatio ?? 0.35,
          channels: options.customProfile.channels ?? 2,
        }
      : { ...ROOM_REVERB_PRESETS[presetName] };

    if (options.dryWetRatio !== undefined) {
      this.currentConfig.dryWetRatio = Math.max(0, Math.min(1, options.dryWetRatio));
    }

    // Initialize Web Audio graph nodes
    this.inputNode = this.audioContext.createGain();
    this.outputNode = this.audioContext.createGain();
    this.convolverNode = this.audioContext.createConvolver();
    this.dryGain = this.audioContext.createGain();
    this.wetGain = this.audioContext.createGain();

    // Wire audio routing:
    // Dry Path: Input -> DryGain -> Output
    this.inputNode.connect(this.dryGain);
    this.dryGain.connect(this.outputNode);

    // Wet Path: Input -> Convolver -> WetGain -> Output
    this.inputNode.connect(this.convolverNode);
    this.convolverNode.connect(this.wetGain);
    this.wetGain.connect(this.outputNode);

    // Synthesize initial impulse response and configure gains
    this.updateImpulseResponse();
    this.updateGains();
  }

  /**
   * Sets room reverberation to a predefined physical preset.
   */
  public setRoomPreset(preset: RoomAcousticPreset): void {
    if (!ROOM_REVERB_PRESETS[preset]) return;
    this.currentPreset = preset;
    this.currentConfig = { ...ROOM_REVERB_PRESETS[preset] };
    this.updateImpulseResponse();
    this.updateGains();
  }

  /**
   * Sets custom acoustic profile parameters.
   */
  public setCustomProfile(profile: Partial<ReverbProfileConfig> & { rt60Seconds: number }): void {
    this.currentPreset = "custom";
    this.currentConfig = {
      name: "custom",
      rt60Seconds: profile.rt60Seconds,
      preDelaySeconds: profile.preDelaySeconds ?? 0.01,
      dampingFactor: profile.dampingFactor ?? 2.0,
      dryWetRatio: profile.dryWetRatio ?? 0.35,
      channels: profile.channels ?? 2,
    };
    this.updateImpulseResponse();
    this.updateGains();
  }

  /**
   * Adjusts the dry/wet balance ratio (0 = 100% dry, 1 = 100% wet).
   */
  public setDryWetRatio(ratio: number): void {
    this.currentConfig.dryWetRatio = Math.max(0, Math.min(1, ratio));
    this.updateGains();
  }

  /**
   * Returns active preset identifier.
   */
  public getPreset(): RoomAcousticPreset | "custom" {
    return this.currentPreset;
  }

  /**
   * Returns current active profile configuration.
   */
  public getConfig(): ReverbProfileConfig {
    return { ...this.currentConfig };
  }

  /**
   * Internal helper to synthesize and assign impulse response to ConvolverNode.
   */
  private updateImpulseResponse(): void {
    const buffer = generateImpulseResponse(
      this.audioContext,
      this.currentConfig.rt60Seconds,
      {
        preDelaySeconds: this.currentConfig.preDelaySeconds,
        dampingFactor: this.currentConfig.dampingFactor,
        channels: this.currentConfig.channels,
      }
    );
    this.convolverNode.buffer = buffer;
  }

  /**
   * Internal helper to update dry and wet gains smoothly.
   */
  private updateGains(): void {
    const wet = this.currentConfig.dryWetRatio ?? 0.35;
    const dry = 1 - wet;
    const now = this.audioContext.currentTime;

    try {
      this.dryGain.gain.setValueAtTime(dry, now);
      this.wetGain.gain.setValueAtTime(wet, now);
    } catch {
      this.dryGain.gain.value = dry;
      this.wetGain.gain.value = wet;
    }
  }

  /**
   * Safely disconnects and cleans up all audio graph nodes.
   */
  public disconnect(): void {
    try {
      this.inputNode.disconnect();
      this.convolverNode.disconnect();
      this.dryGain.disconnect();
      this.wetGain.disconnect();
      this.outputNode.disconnect();
    } catch {
      // Ignore already disconnected nodes
    }
  }
}

export default RoomReverbConvolver;
