/**
 * AcousticFilterEngine
 * Web Audio BiquadFilterNode preset engine for real-time background noise suppression.
 *
 * Implements typed presets:
 * - 'off': Direct audio bypass without altering the original signal.
 * - 'voice-focus': Bandpass filtering targeting the 300–3400 Hz human voice band
 *   (approximated using BiquadFilterNode bandpass centered at ~1850 Hz, Q=1.0).
 *   Note: A single second-order bandpass filter centered at ~1850 Hz with Q=1.0 provides
 *   smooth roll-off below and above the voice band; while commonly used for telephony/speech
 *   isolation, it does not produce brickwall boundaries at 300 Hz and 3400 Hz.
 * - 'cafe-suppress': Cascaded notch filters at 120 Hz and 240 Hz to attenuate low-frequency
 *   hum and motor harmonics (e.g. espresso machines, blenders, refrigeration units)
 *   without degrading speech.
 *
 * Provides pop- and click-free preset transitions using AudioParam automation and gain crossfading.
 */

export type AcousticFilterPreset = "off" | "voice-focus" | "cafe-suppress";

export const ACOUSTIC_FILTER_PRESETS: readonly AcousticFilterPreset[] = [
  "off",
  "voice-focus",
  "cafe-suppress",
] as const;

export interface AcousticFilterEngineOptions {
  initialPreset?: AcousticFilterPreset;
  /** Transition crossfade time constant in seconds (default: 0.05s / 50ms) */
  transitionTimeConstant?: number;
}

export const MIN_FILTER_FREQ = 20;
export const MAX_FILTER_FREQ = 20000;
export const MIN_FILTER_Q = 0.001;
export const MAX_FILTER_Q = 100;

/**
 * Clamps frequency to a safe range within Web Audio and Nyquist limits.
 */
export function clampFrequency(freq: number, sampleRate = 48000): number {
  if (!Number.isFinite(freq) || Number.isNaN(freq)) {
    return 1000;
  }
  const maxSafeFreq = Math.min(MAX_FILTER_FREQ, Math.max(MIN_FILTER_FREQ, (sampleRate / 2) - 1));
  return Math.min(maxSafeFreq, Math.max(MIN_FILTER_FREQ, freq));
}

/**
 * Clamps Q factor to a safe positive non-zero range.
 */
export function clampQ(q: number): number {
  if (!Number.isFinite(q) || Number.isNaN(q)) {
    return 1.0;
  }
  return Math.min(MAX_FILTER_Q, Math.max(MIN_FILTER_Q, q));
}

/**
 * Type guard to validate whether an arbitrary value is an AcousticFilterPreset.
 */
export function isValidAcousticFilterPreset(value: unknown): value is AcousticFilterPreset {
  return typeof value === "string" && (ACOUSTIC_FILTER_PRESETS as readonly string[]).includes(value);
}

export class AcousticFilterEngine {
  private readonly ctx: AudioContext;
  private readonly transitionTimeConstant: number;

  private currentPreset: AcousticFilterPreset = "off";
  private isDisposed = false;

  // Audio Node Graph
  public readonly inputNode: GainNode;
  public readonly outputNode: GainNode;

  // Bypass branch
  private readonly bypassGain: GainNode;

  // Processed branch
  private readonly processedGain: GainNode;

  // Voice focus node
  public readonly voiceFocusNode: BiquadFilterNode;

  // Cafe suppression nodes
  public readonly cafeNotch120Node: BiquadFilterNode;
  public readonly cafeNotch240Node: BiquadFilterNode;

  // Gains to switch between voice focus chain and cafe suppress chain
  private readonly voiceFocusGain: GainNode;
  private readonly cafeSuppressGain: GainNode;

  // Tracks connected source stream / node for cleanup tracking
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private destinationNode: AudioNode | MediaStreamAudioDestinationNode | null = null;

  constructor(
    audioContext: AudioContext,
    options: AcousticFilterEngineOptions = {},
  ) {
    if (!audioContext || typeof audioContext.createGain !== "function") {
      throw new Error("A valid AudioContext instance is required to initialize AcousticFilterEngine.");
    }

    this.ctx = audioContext;
    this.transitionTimeConstant = Math.max(0.005, options.transitionTimeConstant ?? 0.05);

    // Master input and output nodes
    this.inputNode = this.ctx.createGain();
    this.outputNode = this.ctx.createGain();

    // Crossfading gain nodes
    this.bypassGain = this.ctx.createGain();
    this.processedGain = this.ctx.createGain();

    // 1. Voice focus filter: Bandpass centered at ~1850 Hz with Q = 1.0
    // Voice band telephone standard is 300Hz - 3400Hz.
    // Center freq approximation = sqrt(300 * 3400) ~= 1010 Hz or arithmetic center ~1850 Hz.
    // We use center frequency 1850 Hz with Q = 1.0 as specified in the requirements.
    this.voiceFocusNode = this.ctx.createBiquadFilter();
    this.voiceFocusNode.type = "bandpass";
    this.voiceFocusNode.frequency.setValueAtTime(
      clampFrequency(1850, this.ctx.sampleRate),
      this.ctx.currentTime,
    );
    this.voiceFocusNode.Q.setValueAtTime(clampQ(1.0), this.ctx.currentTime);

    // 2. Cafe suppress notch filters: 120 Hz and 240 Hz
    this.cafeNotch120Node = this.ctx.createBiquadFilter();
    this.cafeNotch120Node.type = "notch";
    this.cafeNotch120Node.frequency.setValueAtTime(
      clampFrequency(120, this.ctx.sampleRate),
      this.ctx.currentTime,
    );
    this.cafeNotch120Node.Q.setValueAtTime(clampQ(4.0), this.ctx.currentTime);

    this.cafeNotch240Node = this.ctx.createBiquadFilter();
    this.cafeNotch240Node.type = "notch";
    this.cafeNotch240Node.frequency.setValueAtTime(
      clampFrequency(240, this.ctx.sampleRate),
      this.ctx.currentTime,
    );
    this.cafeNotch240Node.Q.setValueAtTime(clampQ(4.0), this.ctx.currentTime);

    // Internal routing gains for processed paths
    this.voiceFocusGain = this.ctx.createGain();
    this.cafeSuppressGain = this.ctx.createGain();

    this.setupAudioGraph();

    const initial = options.initialPreset && isValidAcousticFilterPreset(options.initialPreset)
      ? options.initialPreset
      : "off";

    this.applyPresetInstant(initial);
  }

  /**
   * Sets up static node connections.
   *
   * Topology:
   *                      +--> [bypassGain] -----------------------------------+
   *                      |                                                    |
   * [inputNode] ---------+                                                    +--> [outputNode]
   *                      |                                                    |
   *                      +--> [voiceFocusNode] ---> [voiceFocusGain] ---+     |
   *                      |                                              +--> [processedGain] --+
   *                      +--> [cafeNotch120] -> [cafeNotch240] -> [cafeSuppressGain] -+
   */
  private setupAudioGraph(): void {
    // Bypass path
    this.inputNode.connect(this.bypassGain);
    this.bypassGain.connect(this.outputNode);

    // Voice focus path
    this.inputNode.connect(this.voiceFocusNode);
    this.voiceFocusNode.connect(this.voiceFocusGain);
    this.voiceFocusGain.connect(this.processedGain);

    // Cafe suppress path (120Hz notch -> 240Hz notch)
    this.inputNode.connect(this.cafeNotch120Node);
    this.cafeNotch120Node.connect(this.cafeNotch240Node);
    this.cafeNotch240Node.connect(this.cafeSuppressGain);
    this.cafeSuppressGain.connect(this.processedGain);

    // Processed path to output
    this.processedGain.connect(this.outputNode);
  }

  /**
   * Initializes gain levels immediately at startup without ramping.
   */
  private applyPresetInstant(preset: AcousticFilterPreset): void {
    const t = this.ctx.currentTime;
    this.currentPreset = preset;

    if (preset === "off") {
      this.bypassGain.gain.setValueAtTime(1.0, t);
      this.processedGain.gain.setValueAtTime(0.0, t);
      this.voiceFocusGain.gain.setValueAtTime(0.0, t);
      this.cafeSuppressGain.gain.setValueAtTime(0.0, t);
    } else if (preset === "voice-focus") {
      this.bypassGain.gain.setValueAtTime(0.0, t);
      this.processedGain.gain.setValueAtTime(1.0, t);
      this.voiceFocusGain.gain.setValueAtTime(1.0, t);
      this.cafeSuppressGain.gain.setValueAtTime(0.0, t);
    } else if (preset === "cafe-suppress") {
      this.bypassGain.gain.setValueAtTime(0.0, t);
      this.processedGain.gain.setValueAtTime(1.0, t);
      this.voiceFocusGain.gain.setValueAtTime(0.0, t);
      this.cafeSuppressGain.gain.setValueAtTime(1.0, t);
    }
  }

  /**
   * Switches to a new preset smoothly with AudioParam automation to avoid pops/clicks.
   */
  public setPreset(preset: AcousticFilterPreset | string): void {
    if (this.isDisposed) return;

    let targetPreset: AcousticFilterPreset = "off";
    if (isValidAcousticFilterPreset(preset)) {
      targetPreset = preset;
    } else {
      console.warn(`[AcousticFilterEngine] Invalid preset "${preset}", falling back to "off".`);
      targetPreset = "off";
    }

    if (this.currentPreset === targetPreset) return;
    this.currentPreset = targetPreset;

    const t = this.ctx.currentTime;
    const tc = this.transitionTimeConstant;

    if (targetPreset === "off") {
      // Smooth crossfade to bypass: open bypass, close processed
      this.bypassGain.gain.setTargetAtTime(1.0, t, tc);
      this.processedGain.gain.setTargetAtTime(0.0, t, tc);
      this.voiceFocusGain.gain.setTargetAtTime(0.0, t, tc);
      this.cafeSuppressGain.gain.setTargetAtTime(0.0, t, tc);
    } else if (targetPreset === "voice-focus") {
      this.voiceFocusGain.gain.setTargetAtTime(1.0, t, tc);
      this.cafeSuppressGain.gain.setTargetAtTime(0.0, t, tc);
      this.processedGain.gain.setTargetAtTime(1.0, t, tc);
      this.bypassGain.gain.setTargetAtTime(0.0, t, tc);
    } else if (targetPreset === "cafe-suppress") {
      this.cafeSuppressGain.gain.setTargetAtTime(1.0, t, tc);
      this.voiceFocusGain.gain.setTargetAtTime(0.0, t, tc);
      this.processedGain.gain.setTargetAtTime(1.0, t, tc);
      this.bypassGain.gain.setTargetAtTime(0.0, t, tc);
    }
  }

  /**
   * Returns the current active preset.
   */
  public getPreset(): AcousticFilterPreset {
    return this.currentPreset;
  }

  /**
   * Connects a MediaStream (such as a microphone input) to the filter engine input.
   * If a previous source node was connected, it is safely disconnected without stopping media tracks.
   */
  public connectSourceStream(stream: MediaStream): MediaStreamAudioSourceNode {
    if (this.isDisposed) {
      throw new Error("Cannot connect source stream to a disposed AcousticFilterEngine.");
    }
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {}
      this.sourceNode = null;
    }

    const source = this.ctx.createMediaStreamSource(stream);
    source.connect(this.inputNode);
    this.sourceNode = source;
    return source;
  }

  /**
   * Connects an arbitrary AudioNode (e.g. existing MediaStreamAudioSourceNode) to the input.
   */
  public connectSourceNode(node: AudioNode): void {
    if (this.isDisposed) {
      throw new Error("Cannot connect source node to a disposed AcousticFilterEngine.");
    }
    node.connect(this.inputNode);
  }

  /**
   * Connects the filter engine output to a destination AudioNode or MediaStreamDestinationNode.
   */
  public connectDestination(destination: AudioNode | MediaStreamAudioDestinationNode): void {
    if (this.isDisposed) {
      throw new Error("Cannot connect destination to a disposed AcousticFilterEngine.");
    }
    if (this.destinationNode) {
      try {
        this.outputNode.disconnect(this.destinationNode as any);
      } catch {}
    }
    this.outputNode.connect(destination as any);
    this.destinationNode = destination;
  }

  /**
   * Creates a processed output MediaStream suitable for transmission over WebRTC mesh.
   */
  public createOutputStream(): MediaStream {
    if (this.isDisposed) {
      throw new Error("Cannot create output stream from a disposed AcousticFilterEngine.");
    }
    const dest = this.ctx.createMediaStreamDestination();
    this.connectDestination(dest);
    return dest.stream;
  }

  /**
   * Disconnects and releases all audio nodes without terminating underlying media tracks.
   */
  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    try {
      if (this.sourceNode) {
        this.sourceNode.disconnect();
        this.sourceNode = null;
      }
      this.inputNode.disconnect();
      this.bypassGain.disconnect();
      this.voiceFocusNode.disconnect();
      this.voiceFocusGain.disconnect();
      this.cafeNotch120Node.disconnect();
      this.cafeNotch240Node.disconnect();
      this.cafeSuppressGain.disconnect();
      this.processedGain.disconnect();
      this.outputNode.disconnect();
    } catch {
      // Gracefully ignore already disconnected node errors
    }
  }
}

export default AcousticFilterEngine;
