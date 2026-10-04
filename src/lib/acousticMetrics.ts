/**
 * IEC 61672-1 Acoustic Metrics Engine for WorkSphere
 *
 * Implements:
 * 1. IEC 61672-1:2013 frequency A-weighting gain calculation A(f).
 * 2. Spectral A-weighting for FFT magnitude spectrum analysis.
 * 3. Pre-warped digital IIR Biquad filter design & cascade processing for time-domain audio.
 * 4. Logarithmic energy-equivalent continuous sound level (Leq).
 * 5. Statistical noise percentiles (L10 intrusive peak, L50 median, L90 ambient floor).
 * 6. Work environment acoustic comfort classification.
 * 7. NIOSH & OSHA daily noise exposure dosimetry (dose % and 8-hour TWA).
 * 8. Real-time AcousticSessionMonitor for streaming session evaluations.
 */

export type AcousticComfortCategory =
  | "deep_focus"
  | "conversational"
  | "lively"
  | "hazardous_loud";

export interface AcousticComfortProfile {
  category: AcousticComfortCategory;
  label: string;
  description: string;
  focusSuitability: "ideal" | "acceptable" | "limited" | "unsuitable";
  recommendedSessionMinutes: number | null;
  minDb: number;
  maxDb: number;
}

export interface AcousticPercentiles {
  l10: number; // Exceeded 10% of time (intrusive peak noise)
  l50: number; // Exceeded 50% of time (median noise)
  l90: number; // Exceeded 90% of time (background noise floor)
  lMin: number;
  lMax: number;
  intrusiveness: number; // L10 - L90 spread
}

export interface NoiseDoseResult {
  dosePercentage: number;
  exposureHours: number;
  allowableHours: number;
  timeWeightedAverage: number;
  standard: "NIOSH" | "OSHA";
  isExceeded: boolean;
}

export interface BiquadCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export interface AcousticSessionSummary {
  frameCount: number;
  durationSeconds: number;
  leq: number;
  percentiles: AcousticPercentiles;
  comfortProfile: AcousticComfortProfile;
  noiseDose: NoiseDoseResult;
}

/**
 * Calculates the exact IEC 61672-1:2013 frequency-weighting gain A(f) in dB.
 *
 * At 1000 Hz, the standard A-weighting gain is precisely 0.00 dB.
 * Human hearing strongly attenuates low frequencies (<100 Hz) and ultra-high frequencies (>10 kHz).
 *
 * @param freqHz Frequency in Hertz
 * @returns Gain in decibels (dB), or -Infinity if freqHz <= 0
 */
export function calculateAWeightingGain(freqHz: number): number {
  if (freqHz <= 0 || !Number.isFinite(freqHz)) {
    return -Infinity;
  }

  const f2 = freqHz * freqHz;
  const c1 = 12194 ** 2; // 148693636
  const c2 = 20.6 ** 2; // 424.36
  const c3 = 107.7 ** 2; // 11599.29
  const c4 = 737.9 ** 2; // 544496.41

  const num = c1 * f2 * f2;
  const den = (f2 + c2) * Math.sqrt((f2 + c3) * (f2 + c4)) * (f2 + c1);

  if (den === 0) return -Infinity;

  const rA = num / den;
  // Offset of +1.9997 dB normalizes the response to exactly 0.0 dB at 1000 Hz
  return 20 * Math.log10(rA) + 1.9997;
}

/**
 * Applies IEC 61672-1 A-weighting to a frequency spectrum.
 *
 * @param frequencies Array of bin center frequencies in Hertz
 * @param magnitudes Array of magnitude values at each frequency
 * @param isDbScale If true, magnitudes are in dB (gain added). If false, magnitudes are linear (linear multiplier applied).
 * @returns Array of A-weighted magnitudes
 */
export function applyAWeightingToSpectrum(
  frequencies: number[],
  magnitudes: number[],
  isDbScale = true,
): number[] {
  const length = Math.min(frequencies.length, magnitudes.length);
  const result: number[] = new Array(length);

  for (let i = 0; i < length; i++) {
    const gainDb = calculateAWeightingGain(frequencies[i]);
    if (isDbScale) {
      result[i] = Number.isFinite(gainDb) ? magnitudes[i] + gainDb : -Infinity;
    } else {
      const linearGain = Number.isFinite(gainDb) ? Math.pow(10, gainDb / 20) : 0;
      result[i] = magnitudes[i] * linearGain;
    }
  }

  return result;
}

/**
 * Single second-order section (biquad) IIR filter implementing Direct Form II Transposed.
 */
export class BiquadSection {
  private b0: number;
  private b1: number;
  private b2: number;
  private a1: number;
  private a2: number;
  private z1 = 0;
  private z2 = 0;

  constructor(coeffs: BiquadCoefficients) {
    this.b0 = coeffs.b0;
    this.b1 = coeffs.b1;
    this.b2 = coeffs.b2;
    this.a1 = coeffs.a1;
    this.a2 = coeffs.a2;
  }

  /**
   * Process a single audio sample through this biquad section.
   */
  process(sample: number): number {
    const out = this.b0 * sample + this.z1;
    this.z1 = this.b1 * sample - this.a1 * out + this.z2;
    this.z2 = this.b2 * sample - this.a2 * out;
    return out;
  }

  /**
   * Resets internal delay states.
   */
  reset(): void {
    this.z1 = 0;
    this.z2 = 0;
  }
}

/**
 * Cascaded series of biquad filter sections.
 */
export class CascadedBiquadFilter {
  private sections: BiquadSection[];
  private overallGain: number;

  constructor(coefficients: BiquadCoefficients[], overallGain = 1.0) {
    this.sections = coefficients.map((c) => new BiquadSection(c));
    this.overallGain = overallGain;
  }

  /**
   * Processes a single audio sample through the cascaded filter.
   */
  processSample(sample: number): number {
    let current = sample * this.overallGain;
    for (let i = 0; i < this.sections.length; i++) {
      current = this.sections[i].process(current);
    }
    return current;
  }

  /**
   * Processes a buffer of time-domain audio samples.
   */
  processBuffer(buffer: Float32Array | number[]): Float32Array {
    const output = new Float32Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      output[i] = this.processSample(buffer[i]);
    }
    return output;
  }

  /**
   * Resets all internal delay states in the cascaded sections.
   */
  reset(): void {
    for (let i = 0; i < this.sections.length; i++) {
      this.sections[i].reset();
    }
  }
}

/**
 * Designs digital second-order biquad filter sections for IEC 61672-1 A-weighting
 * using bilinear transform with frequency pre-warping.
 *
 * @param sampleRate Sampling frequency in Hz (defaults to 48000 Hz)
 * @returns Array of 3 biquad filter coefficient sections
 */
export function designAWeightingBiquads(sampleRate = 48000): BiquadCoefficients[] {
  if (sampleRate <= 0) {
    throw new Error("Sample rate must be positive.");
  }

  const c = 2 * sampleRate;
  const warp = (f: number) => 2 * sampleRate * Math.tan((Math.PI * f) / sampleRate);

  const w1 = warp(20.598997);
  const w2 = warp(107.65265);
  const w3 = warp(737.86223);
  const w4 = warp(12194.217);

  // Section 1: High-pass at w1 (multiplicity 2)
  const a0_1 = (c + w1) ** 2;
  const sec1: BiquadCoefficients = {
    b0: (c * c) / a0_1,
    b1: (-2 * c * c) / a0_1,
    b2: (c * c) / a0_1,
    a1: (-2 * (c * c - w1 * w1)) / a0_1,
    a2: (c - w1) ** 2 / a0_1,
  };

  // Section 2: Mid-range bandpass shaping at w2 and w3
  const a0_2 = (c + w2) * (c + w3);
  const sec2: BiquadCoefficients = {
    b0: (c * c) / a0_2,
    b1: (-2 * c * c) / a0_2,
    b2: (c * c) / a0_2,
    a1: (-2 * (c * c - w2 * w3)) / a0_2,
    a2: ((c - w2) * (c - w3)) / a0_2,
  };

  // Section 3: Low-pass rolloff at w4 (multiplicity 2)
  const a0_3 = (c + w4) ** 2;
  const sec3: BiquadCoefficients = {
    b0: (w4 * w4) / a0_3,
    b1: (2 * w4 * w4) / a0_3,
    b2: (w4 * w4) / a0_3,
    a1: (-2 * (c * c - w4 * w4)) / a0_3,
    a2: (c - w4) ** 2 / a0_3,
  };

  return [sec1, sec2, sec3];
}

/**
 * Creates an A-weighting digital filter instance calibrated to 0 dB at 1000 Hz.
 *
 * @param sampleRate Sampling rate in Hz (defaults to 48000 Hz)
 */
export function createAWeightingFilter(sampleRate = 48000): CascadedBiquadFilter {
  const sections = designAWeightingBiquads(sampleRate);

  // Compute gain at 1000 Hz to normalize the filter
  const fRef = 1000;
  const wRef = (2 * Math.PI * fRef) / sampleRate;
  const cos1 = Math.cos(wRef);
  const sin1 = Math.sin(wRef);
  const cos2 = Math.cos(2 * wRef);
  const sin2 = Math.sin(2 * wRef);

  let totalGain = 1.0;
  for (const s of sections) {
    const numReal = s.b0 + s.b1 * cos1 + s.b2 * cos2;
    const numImag = -s.b1 * sin1 - s.b2 * sin2;
    const denReal = 1 + s.a1 * cos1 + s.a2 * cos2;
    const denImag = -s.a1 * sin1 - s.a2 * sin2;
    totalGain *= Math.hypot(numReal, numImag) / Math.hypot(denReal, denImag);
  }

  const overallGain = totalGain > 0 ? 1.0 / totalGain : 1.0;
  return new CascadedBiquadFilter(sections, overallGain);
}

/**
 * Calculates Equivalent Continuous Sound Level (Leq) via logarithmic acoustic energy summation.
 *
 * Leq = 10 * log10( (1 / N) * sum( 10^(L_i / 10) ) )
 *
 * @param decibelFrames Array of sound levels in dB or dBA
 * @param options Configuration options
 * @returns Logarithmically integrated sound level rounded to specified decimal places
 */
export function calculateLeq(
  decibelFrames: number[],
  options: { noiseFloor?: number; roundDecimals?: number } = {},
): number {
  const noiseFloor = options.noiseFloor ?? 30.0;
  const roundDecimals = options.roundDecimals ?? 1;

  const validFrames = decibelFrames.filter(
    (val) => typeof val === "number" && Number.isFinite(val),
  );

  if (validFrames.length === 0) {
    return noiseFloor;
  }

  let energySum = 0;
  for (let i = 0; i < validFrames.length; i++) {
    energySum += Math.pow(10, validFrames[i] / 10);
  }

  const meanEnergy = energySum / validFrames.length;
  if (meanEnergy <= 0) {
    return noiseFloor;
  }

  const rawLeq = 10 * Math.log10(meanEnergy);
  const factor = Math.pow(10, roundDecimals);
  return Math.round(rawLeq * factor) / factor;
}

/**
 * Computes acoustic statistical percentiles (L10, L50, L90, Lmin, Lmax, and Intrusiveness).
 *
 * In acoustic engineering:
 * - L10 is the level exceeded 10% of the measurement time (intermittent peaks like sirens, slammed doors).
 * - L50 is the median sound level (exceeded 50% of the time).
 * - L90 is the background noise floor (exceeded 90% of the time, free of transient noise).
 * - Intrusiveness is L10 - L90.
 *
 * @param decibelFrames Recorded sound levels in dBA
 * @param options Configuration options
 * @returns Statistical percentiles
 */
export function calculateNoisePercentiles(
  decibelFrames: number[],
  options: { roundDecimals?: number } = {},
): AcousticPercentiles {
  const roundDecimals = options.roundDecimals ?? 1;
  const factor = Math.pow(10, roundDecimals);
  const roundVal = (v: number) => Math.round(v * factor) / factor;

  const validFrames = decibelFrames.filter(
    (v) => typeof v === "number" && Number.isFinite(v),
  );

  if (validFrames.length === 0) {
    return {
      l10: 30,
      l50: 30,
      l90: 30,
      lMin: 30,
      lMax: 30,
      intrusiveness: 0,
    };
  }

  // Sort descending because L_p is the level exceeded for p% of the time
  const sortedDesc = [...validFrames].sort((a, b) => b - a);
  const n = sortedDesc.length;

  const interpolatePercentile = (p: number): number => {
    if (n === 1) return sortedDesc[0];
    const rank = (p / 100) * (n - 1);
    const lower = Math.floor(rank);
    const upper = Math.ceil(rank);
    const weight = rank - lower;
    return sortedDesc[lower] * (1 - weight) + sortedDesc[upper] * weight;
  };

  const l10 = roundVal(interpolatePercentile(10));
  const l50 = roundVal(interpolatePercentile(50));
  const l90 = roundVal(interpolatePercentile(90));
  const lMax = roundVal(sortedDesc[0]);
  const lMin = roundVal(sortedDesc[n - 1]);
  const intrusiveness = roundVal(Math.max(0, l10 - l90));

  return {
    l10,
    l50,
    l90,
    lMin,
    lMax,
    intrusiveness,
  };
}

/**
 * Classifies an acoustic environment into comfort categories and focus suitability profiles.
 *
 * @param leq Energy-equivalent sound level in dBA
 * @param l90 Optional background noise floor in dBA
 */
export function classifyAcousticComfort(
  leq: number,
  l90?: number,
): AcousticComfortProfile {
  // Use Leq as primary determinant
  if (leq < 50) {
    return {
      category: "deep_focus",
      label: "Deep Focus Zone",
      description:
        "Whisper-quiet library acoustic conditions. Pristine environment for intense cognitive tasks, complex coding, and deep analytical thought.",
      focusSuitability: "ideal",
      recommendedSessionMinutes: null, // Unlimited
      minDb: 30,
      maxDb: 49.9,
    };
  }

  if (leq < 65) {
    return {
      category: "conversational",
      label: "Conversational Ambience",
      description:
        "Balanced acoustic ambience with mild murmur. Well-suited for collaborative discussions, standard work tasks, and video conferences.",
      focusSuitability: "acceptable",
      recommendedSessionMinutes: 480, // Up to 8 hours
      minDb: 50,
      maxDb: 64.9,
    };
  }

  if (leq < 75) {
    return {
      category: "lively",
      label: "Lively Bustle",
      description:
        "Active cafe or busy open office with noticeable chatter and ambient clatter. Suitable for casual reading, email, and creative brainstorming.",
      focusSuitability: "limited",
      recommendedSessionMinutes: 180, // Up to 3 hours
      minDb: 65,
      maxDb: 74.9,
    };
  }

  return {
    category: "hazardous_loud",
    label: "Loud & Disruptive",
    description:
      "Acoustically stressful sound levels exceeding 75 dBA. Prolonged exposure causes fatigue and reduces focus. Ear protection recommended.",
    focusSuitability: "unsuitable",
    recommendedSessionMinutes: 45, // Under 45 minutes
    minDb: 75,
    maxDb: 120,
  };
}

/**
 * Calculates daily noise exposure dose according to NIOSH or OSHA standards.
 *
 * NIOSH: Criterion Level = 85 dBA, Exchange Rate = 3 dB (T = 8 / 2^((L - 85)/3))
 * OSHA:  Criterion Level = 90 dBA, Exchange Rate = 5 dB (T = 8 / 2^((L - 90)/5))
 *
 * @param decibelLevel Sound level in dBA
 * @param durationMinutes Exposure duration in minutes
 * @param standard Standard used ("NIOSH" | "OSHA", defaults to "NIOSH")
 * @returns Noise dosimetry evaluation
 */
export function calculateDailyNoiseDose(
  decibelLevel: number,
  durationMinutes: number,
  standard: "NIOSH" | "OSHA" = "NIOSH",
): NoiseDoseResult {
  const exposureHours = Math.max(0, durationMinutes) / 60;
  const isNiosh = standard === "NIOSH";

  const criterionLevel = isNiosh ? 85 : 90;
  const exchangeRate = isNiosh ? 3 : 5;

  // Allowable exposure hours T
  const allowableHours =
    8 / Math.pow(2, (decibelLevel - criterionLevel) / exchangeRate);

  // Dose percentage D = (C / T) * 100 (preserves precision for small fractions)
  const rawDose = (exposureHours / allowableHours) * 100;
  const dosePercentage =
    rawDose > 0 && rawDose < 0.1
      ? Math.round(rawDose * 1000) / 1000
      : Math.round(rawDose * 10) / 10;

  // Time Weighted Average (TWA)
  let twa = 0;
  if (rawDose > 0) {
    if (isNiosh) {
      twa = (exchangeRate / Math.log10(2)) * Math.log10(rawDose / 100) + criterionLevel;
    } else {
      twa = 16.61 * Math.log10(rawDose / 100) + criterionLevel;
    }
  }
  const timeWeightedAverage = Math.max(30, Math.round(twa * 10) / 10);

  return {
    dosePercentage,
    exposureHours: Math.round(exposureHours * 100) / 100,
    allowableHours: Math.round(allowableHours * 100) / 100,
    timeWeightedAverage,
    standard,
    isExceeded: dosePercentage >= 100,
  };
}

/**
 * Real-time Acoustic Session Monitor for accumulating sound level readings
 * and computing live rolling metrics.
 */
export class AcousticSessionMonitor {
  private frames: number[] = [];
  private maxWindowSize: number;
  private standard: "NIOSH" | "OSHA";

  constructor(options: { maxWindowSize?: number; standard?: "NIOSH" | "OSHA" } = {}) {
    this.maxWindowSize = options.maxWindowSize ?? 3600; // default 1 hour of 1Hz frames
    this.standard = options.standard ?? "NIOSH";
  }

  /**
   * Adds a single dBA frame reading.
   */
  addFrame(dBA: number): void {
    if (typeof dBA === "number" && Number.isFinite(dBA)) {
      this.frames.push(dBA);
      if (this.frames.length > this.maxWindowSize) {
        this.frames.shift();
      }
    }
  }

  /**
   * Appends an array of dBA frame readings.
   */
  addFrames(newFrames: number[]): void {
    for (let i = 0; i < newFrames.length; i++) {
      this.addFrame(newFrames[i]);
    }
  }

  /**
   * Gets the total count of valid recorded frames.
   */
  getFrameCount(): number {
    return this.frames.length;
  }

  /**
   * Returns a copy of the recorded frame values.
   */
  getFrames(): number[] {
    return [...this.frames];
  }

  /**
   * Calculates live Leq from accumulated frames.
   */
  getCurrentLeq(): number {
    return calculateLeq(this.frames);
  }

  /**
   * Calculates live statistical percentiles.
   */
  getPercentiles(): AcousticPercentiles {
    return calculateNoisePercentiles(this.frames);
  }

  /**
   * Classifies current acoustic comfort profile.
   */
  getComfortProfile(): AcousticComfortProfile {
    const leq = this.getCurrentLeq();
    const percentiles = this.getPercentiles();
    return classifyAcousticComfort(leq, percentiles.l90);
  }

  /**
   * Computes noise dose for elapsed session duration.
   * If durationMinutes is omitted, defaults to frames.length / 60 (assuming 1 frame/sec).
   */
  getNoiseDose(durationMinutes?: number): NoiseDoseResult {
    const minutes = durationMinutes ?? Math.max(1, this.frames.length / 60);
    const leq = this.getCurrentLeq();
    return calculateDailyNoiseDose(leq, minutes, this.standard);
  }

  /**
   * Returns a complete session summary.
   */
  getSummary(durationMinutes?: number): AcousticSessionSummary {
    const frameCount = this.frames.length;
    const elapsedMinutes = durationMinutes ?? Math.max(1 / 60, frameCount / 60);
    const leq = this.getCurrentLeq();
    const percentiles = this.getPercentiles();
    const comfortProfile = classifyAcousticComfort(leq, percentiles.l90);
    const noiseDose = calculateDailyNoiseDose(leq, elapsedMinutes, this.standard);

    return {
      frameCount,
      durationSeconds: Math.round(elapsedMinutes * 60),
      leq,
      percentiles,
      comfortProfile,
      noiseDose,
    };
  }

  /**
   * Clears all recorded frames.
   */
  clear(): void {
    this.frames = [];
  }
}
