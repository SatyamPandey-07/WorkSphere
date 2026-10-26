export interface CockpitRadioFilterOptions {
  lowCutFrequency?: number; // Aviation lower bound: 300Hz
  highCutFrequency?: number; // Aviation upper bound: 3400Hz
  distortionAmount?: number;
  enabled?: boolean;
}

export const COCKPIT_RADIO_DEFAULTS = {
  MIN_LOW_CUT_HZ: 50,
  MAX_LOW_CUT_HZ: 2000,
  DEFAULT_LOW_CUT_HZ: 300,
  MIN_HIGH_CUT_HZ: 1000,
  MAX_HIGH_CUT_HZ: 12000,
  DEFAULT_HIGH_CUT_HZ: 3400,
  DEFAULT_DISTORTION: 20,
  MIN_DISTORTION: 0,
  MAX_DISTORTION: 100,
  CURVE_SAMPLES: 44100,
} as const;

/**
 * Validates and clamps distortion amount within [0, 100].
 * Non-finite or missing values fall back to default (20).
 */
export function sanitizeDistortionAmount(amount?: number): number {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    return COCKPIT_RADIO_DEFAULTS.DEFAULT_DISTORTION;
  }
  return Math.max(
    COCKPIT_RADIO_DEFAULTS.MIN_DISTORTION,
    Math.min(COCKPIT_RADIO_DEFAULTS.MAX_DISTORTION, amount)
  );
}

/**
 * Validates low-cut and high-cut frequencies and ensures lowCut < highCut.
 */
export function sanitizeRadioFrequencies(
  lowCut?: number,
  highCut?: number,
  sampleRate: number = 48000
): { lowCut: number; highCut: number } {
  const nyquist = sampleRate / 2;
  const maxHigh = Math.min(COCKPIT_RADIO_DEFAULTS.MAX_HIGH_CUT_HZ, Math.max(1000, nyquist - 100));

  let low = typeof lowCut === 'number' && Number.isFinite(lowCut)
    ? Math.max(COCKPIT_RADIO_DEFAULTS.MIN_LOW_CUT_HZ, Math.min(COCKPIT_RADIO_DEFAULTS.MAX_LOW_CUT_HZ, lowCut))
    : COCKPIT_RADIO_DEFAULTS.DEFAULT_LOW_CUT_HZ;

  let high = typeof highCut === 'number' && Number.isFinite(highCut)
    ? Math.max(COCKPIT_RADIO_DEFAULTS.MIN_HIGH_CUT_HZ, Math.min(maxHigh, highCut))
    : COCKPIT_RADIO_DEFAULTS.DEFAULT_HIGH_CUT_HZ;

  if (low >= high) {
    low = COCKPIT_RADIO_DEFAULTS.DEFAULT_LOW_CUT_HZ;
    high = Math.min(COCKPIT_RADIO_DEFAULTS.DEFAULT_HIGH_CUT_HZ, maxHigh);
  }

  return { lowCut: low, highCut: high };
}

/**
 * Generates an artifact-free non-linear transfer curve for WaveShaperNode.
 * Guarantees zero-division safety and finite samples across all inputs.
 */
export function makeCockpitDistortionCurve(
  amount: number,
  nSamples: number = COCKPIT_RADIO_DEFAULTS.CURVE_SAMPLES
): Float32Array {
  const k = sanitizeDistortionAmount(amount);
  const curve = new Float32Array(nSamples);

  if (k === 0) {
    for (let i = 0; i < nSamples; ++i) {
      curve[i] = (i * 2) / nSamples - 1;
    }
    return curve;
  }

  const deg = Math.PI / 180;
  for (let i = 0; i < nSamples; ++i) {
    const x = (i * 2) / nSamples - 1;
    const denominator = Math.PI + k * Math.abs(x);
    curve[i] = ((3 + k) * x * 20 * deg) / denominator;
  }
  return curve;
}

export class CockpitRadioFilter {
  private audioContext: AudioContext;
  public inputNode: GainNode;
  public outputNode: GainNode;
  private highpassFilter: BiquadFilterNode;
  private lowpassFilter: BiquadFilterNode;
  private waveshaper: WaveShaperNode;
  private dryGain: GainNode;
  private wetGain: GainNode;
  private isEnabled: boolean;
  private distortionAmount: number;
  private isDisconnected: boolean = false;

  constructor(audioContext: AudioContext, options: CockpitRadioFilterOptions = {}) {
    if (!audioContext) {
      throw new Error("CockpitRadioFilter requires a valid AudioContext");
    }
    this.audioContext = audioContext;
    this.isEnabled = options.enabled ?? true;
    this.distortionAmount = sanitizeDistortionAmount(options.distortionAmount);

    const { lowCut, highCut } = sanitizeRadioFrequencies(
      options.lowCutFrequency,
      options.highCutFrequency,
      this.audioContext.sampleRate || 48000
    );

    this.inputNode = this.audioContext.createGain();
    this.outputNode = this.audioContext.createGain();
    this.dryGain = this.audioContext.createGain();
    this.wetGain = this.audioContext.createGain();

    // Bandpass staging: Highpass at ~300Hz, Lowpass at ~3400Hz
    this.highpassFilter = this.audioContext.createBiquadFilter();
    this.highpassFilter.type = 'highpass';
    this.highpassFilter.frequency.setValueAtTime(lowCut, this.audioContext.currentTime);

    this.lowpassFilter = this.audioContext.createBiquadFilter();
    this.lowpassFilter.type = 'lowpass';
    this.lowpassFilter.frequency.setValueAtTime(highCut, this.audioContext.currentTime);

    // WaveShaper saturation overdrive
    this.waveshaper = this.audioContext.createWaveShaper();
    this.waveshaper.curve = this.makeDistortionCurve(this.distortionAmount);
    this.waveshaper.oversample = '4x';

    // Wet chain routing
    this.inputNode.connect(this.highpassFilter);
    this.highpassFilter.connect(this.lowpassFilter);
    this.lowpassFilter.connect(this.waveshaper);
    this.waveshaper.connect(this.wetGain);
    this.wetGain.connect(this.outputNode);

    // Dry chain routing
    this.inputNode.connect(this.dryGain);
    this.dryGain.connect(this.outputNode);

    this.updateGains();
  }

  public makeDistortionCurve(amount: number): Float32Array {
    return makeCockpitDistortionCurve(amount);
  }

  private updateGains(): void {
    const now = this.audioContext.currentTime;
    if (this.isEnabled) {
      this.dryGain.gain.setValueAtTime(0, now);
      this.wetGain.gain.setValueAtTime(1, now);
    } else {
      this.dryGain.gain.setValueAtTime(1, now);
      this.wetGain.gain.setValueAtTime(0, now);
    }
  }

  public setEnabled(enabled: boolean): void {
    this.isEnabled = Boolean(enabled);
    this.updateGains();
  }

  public getEnabled(): boolean {
    return this.isEnabled;
  }

  public getFrequencyBounds(): { lowCut: number; highCut: number } {
    return {
      lowCut: this.highpassFilter.frequency.value,
      highCut: this.lowpassFilter.frequency.value,
    };
  }

  public setLowCutFrequency(frequency: number): void {
    const currentHigh = this.lowpassFilter.frequency.value || COCKPIT_RADIO_DEFAULTS.DEFAULT_HIGH_CUT_HZ;
    const { lowCut } = sanitizeRadioFrequencies(
      frequency,
      currentHigh,
      this.audioContext.sampleRate || 48000
    );
    this.highpassFilter.frequency.setValueAtTime(lowCut, this.audioContext.currentTime);
  }

  public setHighCutFrequency(frequency: number): void {
    const currentLow = this.highpassFilter.frequency.value || COCKPIT_RADIO_DEFAULTS.DEFAULT_LOW_CUT_HZ;
    const { highCut } = sanitizeRadioFrequencies(
      currentLow,
      frequency,
      this.audioContext.sampleRate || 48000
    );
    this.lowpassFilter.frequency.setValueAtTime(highCut, this.audioContext.currentTime);
  }

  public setDistortionAmount(amount: number): void {
    this.distortionAmount = sanitizeDistortionAmount(amount);
    this.waveshaper.curve = this.makeDistortionCurve(this.distortionAmount);
  }

  public getDistortionAmount(): number {
    return this.distortionAmount;
  }

  public disconnect(): void {
    if (this.isDisconnected) return;
    this.isDisconnected = true;

    try { this.inputNode.disconnect(); } catch (_) {}
    try { this.outputNode.disconnect(); } catch (_) {}
    try { this.highpassFilter.disconnect(); } catch (_) {}
    try { this.lowpassFilter.disconnect(); } catch (_) {}
    try { this.waveshaper.disconnect(); } catch (_) {}
    try { this.dryGain.disconnect(); } catch (_) {}
    try { this.wetGain.disconnect(); } catch (_) {}
  }
}

export default CockpitRadioFilter;
