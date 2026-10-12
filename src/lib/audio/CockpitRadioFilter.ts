// @ts-nocheck
export interface CockpitRadioFilterOptions {
  lowCutFrequency?: number; // Aviation lower bound: 300Hz
  highCutFrequency?: number; // Aviation upper bound: 3400Hz
  distortionAmount?: number;
  enabled?: boolean;
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

  constructor(audioContext: AudioContext, options: CockpitRadioFilterOptions = {}) {
    this.audioContext = audioContext;
    this.isEnabled = options.enabled ?? true;

    const lowCut = options.lowCutFrequency ?? 300;
    const highCut = options.highCutFrequency ?? 3400;
    const distortion = options.distortionAmount ?? 20;

    this.inputNode = this.audioContext.createGain();
    this.outputNode = this.audioContext.createGain();
    this.dryGain = this.audioContext.createGain();
    this.wetGain = this.audioContext.createGain();

    // Bandpass staging: Highpass at 300Hz, Lowpass at 3400Hz
    this.highpassFilter = this.audioContext.createBiquadFilter();
    this.highpassFilter.type = 'highpass';
    this.highpassFilter.frequency.setValueAtTime(lowCut, this.audioContext.currentTime);

    this.lowpassFilter = this.audioContext.createBiquadFilter();
    this.lowpassFilter.type = 'lowpass';
    this.lowpassFilter.frequency.setValueAtTime(highCut, this.audioContext.currentTime);

    // Subtle overdrive saturation
    this.waveshaper = this.audioContext.createWaveShaper();
    this.waveshaper.curve = this.makeDistortionCurve(distortion);
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

  private makeDistortionCurve(amount: number): Float32Array {
    const k = typeof amount === 'number' ? amount : 20;
    const n_samples = 44100;
    const curve = new Float32Array(n_samples);
    const deg = Math.PI / 180;

    for (let i = 0; i < n_samples; ++i) {
      const x = (i * 2) / n_samples - 1;
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
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
    this.isEnabled = enabled;
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

  public disconnect(): void {
    this.inputNode.disconnect();
    this.outputNode.disconnect();
    this.highpassFilter.disconnect();
    this.lowpassFilter.disconnect();
    this.waveshaper.disconnect();
    this.dryGain.disconnect();
    this.wetGain.disconnect();
  }
}

export default CockpitRadioFilter;