/**
 * AdaptiveNoiseFilter.ts
 * Dynamic ambient noise cancellation filter using chained BiquadFilterNode instances (#6481).
 *
 * Samples ambient room noise during silence and configures dynamic high-pass and notch
 * filters to suppress cafe espresso machine whine and HVAC rumble (12-18 dB attenuation)
 * while passing clear human vocal frequencies (300Hz - 3400Hz). Includes a speech detection gate.
 */

export interface AdaptiveNoiseFilterOptions {
  speechThresholdDb?: number; // Threshold in dB to distinguish speech from ambient noise (default: -42 dB)
  highPassCutoff?: number; // Cutoff for HVAC rumble (default: 150 Hz)
  notchFrequencies?: number[]; // Fixed or initial notch frequencies (e.g. 60Hz hum, 2400Hz espresso whine)
  notchQ?: number; // Quality factor for notch filters (default: 8.0)
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
  private ambientNoiseFloorDb: number = -60;
  private notchQ: number;

  constructor(
    audioContext: AudioContext,
    options: AdaptiveNoiseFilterOptions = {},
  ) {
    this.audioContext = audioContext;
    this.isEnabled = options.enabled ?? true;
    this.speechThresholdDb = options.speechThresholdDb ?? -42;
    this.notchQ = options.notchQ ?? 8.0;

    const highPassFreq = options.highPassCutoff ?? 150;
    const initialNotches = options.notchFrequencies ?? [60, 120, 2400]; // 60/120Hz hum + 2.4kHz espresso whine

    // Create Gain & Control Nodes
    this.inputNode = this.audioContext.createGain();
    this.outputNode = this.audioContext.createGain();
    this.dryGain = this.audioContext.createGain();
    this.wetGain = this.audioContext.createGain();
    this.gateNode = this.audioContext.createGain();

    // Create Spectrum Analyser for ambient noise profiling & VAD
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 1024;
    this.analyserNode.smoothingTimeConstant = 0.8;

    // Highpass Filter: Cuts low-frequency HVAC hum, table bumps, and rumblings (< 150-300Hz)
    this.highpassFilter = this.audioContext.createBiquadFilter();
    this.highpassFilter.type = "highpass";
    this.highpassFilter.frequency.setValueAtTime(
      highPassFreq,
      this.audioContext.currentTime,
    );
    this.highpassFilter.Q.setValueAtTime(0.707, this.audioContext.currentTime);

    // Dynamic Notch Filter: Adjusted in real-time to track cafe espresso machine resonance
    this.dynamicNotchFilter = this.audioContext.createBiquadFilter();
    this.dynamicNotchFilter.type = "notch";
    this.dynamicNotchFilter.frequency.setValueAtTime(
      2800,
      this.audioContext.currentTime,
    );
    this.dynamicNotchFilter.Q.setValueAtTime(
      this.notchQ,
      this.audioContext.currentTime,
    );

    // Build chained filter pipeline
    let lastNode: AudioNode = this.highpassFilter;

    // Add static/configured notch filters (e.g. electrical 60Hz/120Hz + machine hum)
    for (const freq of initialNotches) {
      const notch = this.createNotchFilter(freq);
      this.notchFilters.push(notch);
      lastNode.connect(notch);
      lastNode = notch;
    }

    // Connect dynamic tracking notch filter
    lastNode.connect(this.dynamicNotchFilter);
    lastNode = this.dynamicNotchFilter;

    // Connect to Speech Detection Gate
    lastNode.connect(this.gateNode);
    this.gateNode.connect(this.wetGain);

    // Audio Graph Routing:
    // Input -> Analyser (for noise sampling)
    this.inputNode.connect(this.analyserNode);

    // Input -> Highpass -> Notches -> Dynamic Notch -> Gate -> WetGain -> Output
    this.inputNode.connect(this.highpassFilter);
    this.wetGain.connect(this.outputNode);

    // Input -> DryGain -> Output (bypassed when filter active)
    this.inputNode.connect(this.dryGain);
    this.dryGain.connect(this.outputNode);

    this.updateGains();
  }

  private createNotchFilter(frequency: number): BiquadFilterNode {
    const notch = this.audioContext.createBiquadFilter();
    notch.type = "notch";
    notch.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
    notch.Q.setValueAtTime(this.notchQ, this.audioContext.currentTime);
    return notch;
  }

  /**
   * Samples ambient room noise during silence and checks speech detection threshold gate.
   * Returns speech state, decibel levels, and identified dominant noise frequencies.
   */
  public processSample(): NoiseAnalysisResult {
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
    if (frequency >= 40 && frequency <= 16000) {
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
    this.isEnabled = enabled;
    this.updateGains();
  }

  public getIsEnabled(): boolean {
    return this.isEnabled;
  }

  private updateGains(): void {
    const time = this.audioContext.currentTime;
    if (this.isEnabled) {
      this.wetGain.gain.setValueAtTime(1.0, time);
      this.dryGain.gain.setValueAtTime(0.0, time);
    } else {
      this.wetGain.gain.setValueAtTime(0.0, time);
      this.dryGain.gain.setValueAtTime(1.0, time);
    }
  }

  public dispose(): void {
    try {
      this.inputNode.disconnect();
      this.outputNode.disconnect();
      this.highpassFilter.disconnect();
      for (const notch of this.notchFilters) {
        notch.disconnect();
      }
      this.dynamicNotchFilter.disconnect();
      this.gateNode.disconnect();
      this.analyserNode.disconnect();
      this.dryGain.disconnect();
      this.wetGain.disconnect();
    } catch {
      // Ignore disconnect errors
    }
  }
}

export default AdaptiveNoiseFilter;
