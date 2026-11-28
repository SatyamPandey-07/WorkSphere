
/**
 * AdaptiveNoiseFilter.ts
 * Dynamic ambient noise cancellation filter using chained BiquadFilterNode instances (#6481).
 *
 * Samples ambient room noise during silence and configures dynamic high-pass and notch
 * filters to suppress cafe espresso machine whine and HVAC rumble (12-18 dB attenuation)
 * while passing clear human vocal frequencies (300Hz - 3400Hz). Includes a speech detection gate.
 */

export const NOTCH_Q_PRESETS = Object.freeze({
  narrow: 12,
  balanced: 8,
  wide: 4,
} as const);

export type NotchQPreset = keyof typeof NOTCH_Q_PRESETS;

/**
 * Resolves the notch Q factor. A Q of 0 or below (or NaN/Infinity) produces
 * undefined biquad behavior, so any invalid explicit value falls back to the
 * selected preset (default: "balanced").
 */
function resolveNotchQ(
  notchQ: number | undefined,
  preset: NotchQPreset = "balanced",
): number {
  if (typeof notchQ === "number" && Number.isFinite(notchQ) && notchQ > 0) {
    return Math.min(Math.max(notchQ, 0.0001), 100);
  }

  return NOTCH_Q_PRESETS[preset] ?? NOTCH_Q_PRESETS.balanced;
}

export interface AdaptiveNoiseFilterOptions {
  speechThresholdDb?: number; // Threshold in dB to distinguish speech from ambient noise (default: -42 dB)
  highPassCutoff?: number; // Cutoff for HVAC rumble (default: 150 Hz)
  notchFrequencies?: number[]; // Fixed or initial notch frequencies (e.g. 60Hz hum, 2400Hz espresso whine)
  notchQ?: number; // Quality factor for notch filters; must be finite and > 0, otherwise the preset is used (default: 8.0)
  notchQPreset?: NotchQPreset; // Preset used when notchQ is not provided.
  attenuationDb?: number; // Target attenuation for noise bands (default: 15 dB, within 12-18 dB target)
  enabled?: boolean;
}

export interface NoiseAnalysisResult {
  isSpeech: boolean;
  currentLevelDb: number;
  dominantNoiseFrequency: number | null;
  ambientNoiseFloorDb: number;
}

export class AdaptiveNoiseFilter {
  private audioContext: AudioContext;
  private readonly notchFrequencies: number[];
  public inputNode: GainNode;
  public outputNode: GainNode;

  public highpassFilter: BiquadFilterNode;
  public notchFilters: BiquadFilterNode[] = [];
  public dynamicNotchFilter: BiquadFilterNode;
  public gateNode: GainNode;
  public analyserNode: AnalyserNode;

  private dryGain: GainNode;
  private wetGain: GainNode;

  private speechThresholdDb: number;
  private isEnabled: boolean;
  private isBypassed: boolean;
  private isDisposed = false;
  private isGraphConnected = false;
  private lastContextState: AudioContextState;
  private lastSampleRate: number;
  private stateListenerAttached = false;
  private ambientNoiseFloorDb: number = -60;
  private notchQ: number;
  private highPassCutoff: number;
  private dynamicNotchFrequency = 2800;

  private readonly handleContextStateChange = (): void => {
    if (this.isDisposed) return;

    const state = this.audioContext.state;
    if (state !== "running") {
      this.isBypassed = true;
      this.lastContextState = state;
      if (state === "closed") this.removeContextStateListener();
      return;
    }

    if (this.lastContextState !== "running") {
      this.resetFiltersIfSampleRateChanged();
      this.configureFilterParameters();
      this.updateGains();
      this.connectAudioGraph();
    }
    this.lastContextState = state;
  };

  constructor(
    audioContext: AudioContext | null,
    options: AdaptiveNoiseFilterOptions = {},
  ) {
    if (!audioContext) {
      throw new Error("AdaptiveNoiseFilter requires an AudioContext");
    }
    if (audioContext.state === "closed") {
      throw new Error("AdaptiveNoiseFilter cannot use a closed AudioContext");
    }

    this.audioContext = audioContext;
    this.isEnabled = options.enabled ?? true;
    this.isBypassed = audioContext.state !== "running";
    this.lastContextState = audioContext.state;
    this.lastSampleRate = audioContext.sampleRate;
    this.speechThresholdDb = options.speechThresholdDb ?? -42;
    this.notchQ = resolveNotchQ(options.notchQ, options.notchQPreset);

    const highPassFreq = options.highPassCutoff ?? 150;
    this.highPassCutoff = highPassFreq;
    const initialNotches = options.notchFrequencies ?? [60, 120, 2400]; // 60/120Hz hum + 2.4kHz espresso whine
    this.notchFrequencies = [...initialNotches];

    // Create Gain & Control Nodes
    this.inputNode = this.audioContext.createGain();
    this.outputNode = this.audioContext.createGain();
    this.dryGain = this.audioContext.createGain();
    this.wetGain = this.audioContext.createGain();
    this.gateNode = this.audioContext.createGain();

    // Create Spectrum Analyser for ambient noise profiling & VAD
    this.analyserNode = this.audioContext.createAnalyser();

    // Highpass Filter: Cuts low-frequency HVAC hum, table bumps, and rumblings (< 150-300Hz)
    this.highpassFilter = this.audioContext.createBiquadFilter();

    // Dynamic Notch Filter: Adjusted in real-time to track cafe espresso machine resonance
    this.dynamicNotchFilter = this.audioContext.createBiquadFilter();

    // Build chained filter pipeline
    // Create static/configured notch filters; configure and connect when running.
    this.notchFilters = initialNotches.map(() => this.createNotchFilter());

    this.audioContext.addEventListener(
      "statechange",
      this.handleContextStateChange,
    );
    this.stateListenerAttached = true;

    if (this.isContextRunning()) {
      this.configureFilterParameters();
      this.updateGains();
      this.connectAudioGraph();
    }
  }

  private createNotchFilter(): BiquadFilterNode {
    const notch = this.audioContext.createBiquadFilter();
    return notch;
  }

  private isContextRunning(): boolean {
    return !this.isDisposed && this.audioContext.state === "running";
  }

  private configureFilterParameters(
    highPassFrequency: number = this.highPassCutoff,
  ): void {
    if (!this.isContextRunning()) return;

    const time = this.audioContext.currentTime;
    this.analyserNode.fftSize = 1024;
    this.analyserNode.smoothingTimeConstant = 0.8;
    this.highpassFilter.type = "highpass";
    this.highpassFilter.frequency.setValueAtTime(highPassFrequency, time);
    this.highpassFilter.Q.setValueAtTime(0.707, time);

    this.notchFilters.forEach((notch, index) => {
      notch.type = "notch";
      notch.frequency.setValueAtTime(this.notchFrequencies[index], time);
      notch.Q.setValueAtTime(this.notchQ, time);
    });

    this.dynamicNotchFilter.type = "notch";
    this.dynamicNotchFilter.frequency.setValueAtTime(
      this.dynamicNotchFrequency,
      time,
    );
    this.dynamicNotchFilter.Q.setValueAtTime(this.notchQ, time);
  }

  private resetFiltersIfSampleRateChanged(): void {
    const sampleRate = this.audioContext.sampleRate;
    if (
      !Number.isFinite(sampleRate) ||
      sampleRate <= 0 ||
      sampleRate === this.lastSampleRate
    ) {
      return;
    }

    this.lastSampleRate = sampleRate;
    this.highpassFilter.disconnect();
    for (const notch of this.notchFilters) {
      notch.disconnect();
    }
    this.dynamicNotchFilter.disconnect();

    this.highpassFilter = this.audioContext.createBiquadFilter();
    this.notchFilters = this.notchFrequencies.map(() => this.createNotchFilter());
    this.dynamicNotchFilter = this.audioContext.createBiquadFilter();
    this.configureFilterParameters();

    if (this.isGraphConnected) {
      this.connectFilterChain();
    }
  }

  private connectFilterChain(): void {
    let lastNode: AudioNode = this.highpassFilter;
    for (const notch of this.notchFilters) {
      lastNode.connect(notch);
      lastNode = notch;
    }

    lastNode.connect(this.dynamicNotchFilter);
    this.dynamicNotchFilter.connect(this.gateNode);
    this.inputNode.connect(this.highpassFilter);
  }

  private connectAudioGraph(): void {
    if (!this.isContextRunning() || this.isGraphConnected) return;

    this.connectFilterChain();
    this.gateNode.connect(this.wetGain);

    this.inputNode.connect(this.analyserNode);
    this.wetGain.connect(this.outputNode);
    this.inputNode.connect(this.dryGain);
    this.dryGain.connect(this.outputNode);
    this.isGraphConnected = true;
  }

  /**
   * Samples ambient room noise during silence and checks speech detection threshold gate.
   * Returns speech state, decibel levels, and identified dominant noise frequencies.
   */
  public processSample(): NoiseAnalysisResult {
    if (!this.isContextRunning()) {
      return {
        isSpeech: false,
        currentLevelDb: -100,
        dominantNoiseFrequency: null,
        ambientNoiseFloorDb: Math.round(this.ambientNoiseFloorDb * 10) / 10,
      };
    }

    this.resetFiltersIfSampleRateChanged();

    const buffer = new Float32Array(this.analyserNode.fftSize);
    this.analyserNode.getFloatTimeDomainData(buffer);

    // Compute RMS amplitude in dB
    let sumSquares = 0;
    for (let i = 0; i < buffer.length; i++) {
      sumSquares += buffer[i] * buffer[i];
    }
    const rms = Math.sqrt(sumSquares / buffer.length);
    const currentLevelDb = rms > 0 ? 20 * Math.log10(rms) : -100;

    const isSpeech = currentLevelDb > this.speechThresholdDb;

    let dominantNoiseFrequency: number | null = null;

    if (!isSpeech) {
      // Silence detected: update ambient noise floor and profile background frequencies
      this.ambientNoiseFloorDb = 0.9 * this.ambientNoiseFloorDb + 0.1 * currentLevelDb;

      const freqBuffer = new Uint8Array(this.analyserNode.frequencyBinCount);
      this.analyserNode.getByteFrequencyData(freqBuffer);

      let maxBin = -1;
      let maxVal = 0;
      for (let i = 0; i < freqBuffer.length; i++) {
        if (freqBuffer[i] > maxVal) {
          maxVal = freqBuffer[i];
          maxBin = i;
        }
      }

      if (maxBin > 0 && maxVal > 60) {
        const nyquist = this.audioContext.sampleRate / 2;
        dominantNoiseFrequency = Math.round(
          (maxBin / freqBuffer.length) * nyquist,
        );

        // Dynamically tune the tracking notch filter to suppress the offending noise frequency
        this.tuneDynamicNotch(dominantNoiseFrequency);
      }
    }

    // Apply speech detection gate (open gate smoothly when speaking, clamp when silent)
    const targetGate = isSpeech ? 1.0 : 0.15; // -16.5 dB attenuation during background silence
    this.gateNode.gain.setTargetAtTime(
      targetGate,
      this.audioContext.currentTime,
      0.03,
    );

    return {
      isSpeech,
      currentLevelDb: Math.round(currentLevelDb * 10) / 10,
      dominantNoiseFrequency,
      ambientNoiseFloorDb: Math.round(this.ambientNoiseFloorDb * 10) / 10,
    };
  }

  /**
   * Adjusts the dynamic notch filter frequency to track narrowband noise (e.g. coffee grinder / machine whine).
   */
  public tuneDynamicNotch(frequency: number): void {
    if (
      this.isContextRunning() &&
      frequency >= 40 &&
      frequency <= 16000
    ) {
      this.dynamicNotchFrequency = frequency;
      this.dynamicNotchFilter.frequency.setTargetAtTime(
        frequency,
        this.audioContext.currentTime,
        0.05,
      );
    }
  }

  public setSpeechThreshold(thresholdDb: number): void {
    this.speechThresholdDb = thresholdDb;
  }

  public getSpeechThreshold(): number {
    return this.speechThresholdDb;
  }

  public setEnabled(enabled: boolean): void {
    if (this.isDisposed) return;
    this.isEnabled = enabled;
    this.updateGains();
  }

  public getIsEnabled(): boolean {
    return this.isEnabled;
  }

  public getIsBypassed(): boolean {
    return this.isBypassed;
  }

  private updateGains(): void {
    if (!this.isContextRunning()) {
      this.isBypassed = true;
      return;
    }

    const time = this.audioContext.currentTime;
    if (this.isEnabled) {
      this.wetGain.gain.setValueAtTime(1.0, time);
      this.dryGain.gain.setValueAtTime(0.0, time);
    } else {
      this.wetGain.gain.setValueAtTime(0.0, time);
      this.dryGain.gain.setValueAtTime(1.0, time);
    }
    this.isBypassed = !this.isEnabled;
  }

  private removeContextStateListener(): void {
    if (!this.stateListenerAttached) return;
    this.audioContext.removeEventListener(
      "statechange",
      this.handleContextStateChange,
    );
    this.stateListenerAttached = false;
  }

  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.isBypassed = true;
    this.removeContextStateListener();

    const nodes: AudioNode[] = [
      this.inputNode,
      this.outputNode,
      this.highpassFilter,
      ...this.notchFilters,
      this.dynamicNotchFilter,
      this.gateNode,
      this.analyserNode,
      this.dryGain,
      this.wetGain,
    ];

    for (const node of nodes) {
      try {
        node.disconnect();
      } catch {
        // A node may already be disconnected or its context may be closed.
      }
    }
  }
}

export default AdaptiveNoiseFilter;
