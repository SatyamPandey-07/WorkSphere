/**
 * Frequency Band Spectrum Analyzer & Acoustic Rumble Detector
 *
 * Segregates audio spectrum into 3 psychoacoustic frequency bands:
 * 1. Low Band (20 - 250 Hz): Bass, HVAC rumble, subway / traffic rumble.
 * 2. Mid Band (250 - 4000 Hz): Speech, vocal range, coffee shop chatter.
 * 3. High Band (4000 - 20000 Hz): Steam wands, cutlery clatter, hiss, keyboard clicks.
 *
 * Computes linear relative energy distribution per band and classifies acoustic profiles:
 * - "Heavy HVAC Rumble" (>= 45% low band)
 * - "Chatter Heavy" (>= 55% mid band)
 * - "High Clatter & Hiss" (>= 35% high band)
 * - "Balanced Ambience" (evenly distributed)
 */

export const LOW_BAND_MIN_HZ = 20;
export const LOW_BAND_MAX_HZ = 250;
export const MID_BAND_MIN_HZ = 250;
export const MID_BAND_MAX_HZ = 4000;
export const HIGH_BAND_MIN_HZ = 4000;
export const HIGH_BAND_MAX_HZ = 20000;

export type DominantFrequencyBand = "low" | "mid" | "high" | "balanced";

export interface FrequencyProfileResult {
  tag: string;
  description: string;
  dominantBand: DominantFrequencyBand;
  badgeColor: string;
}

export interface FrequencyBandSpectrum {
  lowEnergy: number;
  midEnergy: number;
  highEnergy: number;
  lowPercentage: number;
  midPercentage: number;
  highPercentage: number;
  dominantBand: DominantFrequencyBand;
  profileTag: string;
  description: string;
  badgeColor: string;
}

/**
 * Classifies relative frequency band energy percentages into acoustic profile tags.
 */
export function getFrequencyProfile(
  lowPct: number,
  midPct: number,
  highPct: number,
): FrequencyProfileResult {
  if (lowPct >= 45 || (lowPct >= 40 && lowPct > midPct && lowPct > highPct)) {
    return {
      tag: "Heavy HVAC Rumble",
      description: "Dominant low-frequency bass & machinery rumble (20–250 Hz)",
      dominantBand: "low",
      badgeColor: "text-purple-400 bg-purple-500/10 border-purple-500/30",
    };
  }

  if (midPct >= 55 || (midPct >= 45 && midPct > lowPct * 1.2 && midPct > highPct * 1.2)) {
    return {
      tag: "Chatter Heavy",
      description: "Dominant speech & conversation midrange frequencies (250–4000 Hz)",
      dominantBand: "mid",
      badgeColor: "text-amber-400 bg-amber-500/10 border-amber-500/30",
    };
  }

  if (highPct >= 35 || (highPct >= 30 && highPct > lowPct && highPct > midPct * 0.8)) {
    return {
      tag: "High Clatter & Hiss",
      description: "Prominent high-frequency steam, cutlery, and transient noise (4000–20000 Hz)",
      dominantBand: "high",
      badgeColor: "text-cyan-400 bg-cyan-500/10 border-cyan-500/30",
    };
  }

  return {
    tag: "Balanced Ambience",
    description: "Evenly distributed acoustic spectrum across all frequency bands",
    dominantBand: "balanced",
    badgeColor: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  };
}

/**
 * Analyzes AnalyserNode frequency data (dBFS bins) into Low, Mid, and High band energy distribution.
 *
 * @param frequencyBins Frequency magnitudes in dBFS (typically <= 0 dBFS from getFloatFrequencyData) or linear bytes
 * @param sampleRate Audio sampling rate in Hz (defaults to 48000 Hz)
 * @param fftSize FFT frame size (defaults to 512)
 */
export function analyzeFrequencyBands(
  frequencyBins: Float32Array | Uint8Array | number[],
  sampleRate = 48000,
  fftSize = 512,
): FrequencyBandSpectrum {
  const binCount = frequencyBins.length;
  if (binCount === 0) {
    const profile = getFrequencyProfile(33.3, 33.3, 33.4);
    return {
      lowEnergy: 0,
      midEnergy: 0,
      highEnergy: 0,
      lowPercentage: 33.3,
      midPercentage: 33.3,
      highPercentage: 33.4,
      dominantBand: profile.dominantBand,
      profileTag: profile.tag,
      description: profile.description,
      badgeColor: profile.badgeColor,
    };
  }

  const hzPerBin = sampleRate / (fftSize > 0 ? fftSize : binCount * 2);

  let lowEnergy = 0;
  let midEnergy = 0;
  let highEnergy = 0;

  for (let i = 0; i < binCount; i++) {
    const freq = i * hzPerBin;
    const rawVal = frequencyBins[i];

    // Linear energy calculation from dBFS or byte level
    let energy = 0;
    if (frequencyBins instanceof Uint8Array) {
      // Byte frequency range 0 - 255
      energy = Math.pow(rawVal / 255, 2);
    } else {
      // Float dBFS range typically -100 dBFS to 0 dBFS
      if (Number.isFinite(rawVal) && rawVal > -120) {
        energy = Math.pow(10, Math.max(-100, Math.min(0, rawVal)) / 10);
      }
    }

    if (freq >= LOW_BAND_MIN_HZ && freq < LOW_BAND_MAX_HZ) {
      lowEnergy += energy;
    } else if (freq >= MID_BAND_MIN_HZ && freq < MID_BAND_MAX_HZ) {
      midEnergy += energy;
    } else if (freq >= HIGH_BAND_MIN_HZ && freq <= HIGH_BAND_MAX_HZ) {
      highEnergy += energy;
    }
  }

  const totalEnergy = lowEnergy + midEnergy + highEnergy;

  let lowPercentage = 33.3;
  let midPercentage = 33.3;
  let highPercentage = 33.4;

  if (totalEnergy > 0) {
    lowPercentage = Math.round((lowEnergy / totalEnergy) * 1000) / 10;
    midPercentage = Math.round((midEnergy / totalEnergy) * 1000) / 10;
    highPercentage = Math.round((highEnergy / totalEnergy) * 1000) / 10;
  }

  const profile = getFrequencyProfile(lowPercentage, midPercentage, highPercentage);

  return {
    lowEnergy: Math.round(lowEnergy * 10000) / 10000,
    midEnergy: Math.round(midEnergy * 10000) / 10000,
    highEnergy: Math.round(highEnergy * 10000) / 10000,
    lowPercentage,
    midPercentage,
    highPercentage,
    dominantBand: profile.dominantBand,
    profileTag: profile.tag,
    description: profile.description,
    badgeColor: profile.badgeColor,
  };
}

/**
 * Computes frequency band energy directly from time-domain PCM samples using DFT on key test frequencies.
 * Designed for synthetic audio buffer testing and time-domain analysis.
 */
export function analyzeTimeDomainBands(
  samples: Float32Array | number[],
  sampleRate = 48000,
): FrequencyBandSpectrum {
  const n = samples.length;
  if (n === 0) return analyzeFrequencyBands([], sampleRate, 512);

  // Band representative test frequencies (logarithmically spaced)
  const lowFreqs = [50, 100, 150, 200];
  const midFreqs = [500, 1000, 2000, 3000];
  const highFreqs = [5000, 8000, 12000, 16000];

  const calcEnergyAtFreq = (f: number): number => {
    let real = 0;
    let imag = 0;
    const omega = (2 * Math.PI * f) / sampleRate;
    for (let i = 0; i < n; i++) {
      const s = samples[i];
      real += s * Math.cos(omega * i);
      imag -= s * Math.sin(omega * i);
    }
    return (real * real + imag * imag) / n;
  };

  let lowEnergy = 0;
  for (const f of lowFreqs) lowEnergy += calcEnergyAtFreq(f);

  let midEnergy = 0;
  for (const f of midFreqs) midEnergy += calcEnergyAtFreq(f);

  let highEnergy = 0;
  for (const f of highFreqs) highEnergy += calcEnergyAtFreq(f);

  const total = lowEnergy + midEnergy + highEnergy;

  let lowPercentage = 33.3;
  let midPercentage = 33.3;
  let highPercentage = 33.4;

  if (total > 0) {
    lowPercentage = Math.round((lowEnergy / total) * 1000) / 10;
    midPercentage = Math.round((midEnergy / total) * 1000) / 10;
    highPercentage = Math.round((highEnergy / total) * 1000) / 10;
  }

  const profile = getFrequencyProfile(lowPercentage, midPercentage, highPercentage);

  return {
    lowEnergy: Math.round(lowEnergy * 10000) / 10000,
    midEnergy: Math.round(midEnergy * 10000) / 10000,
    highEnergy: Math.round(highEnergy * 10000) / 10000,
    lowPercentage,
    midPercentage,
    highPercentage,
    dominantBand: profile.dominantBand,
    profileTag: profile.tag,
    description: profile.description,
    badgeColor: profile.badgeColor,
  };
}
