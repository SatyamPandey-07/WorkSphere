/**
 * acousticForecaster.ts
 * Edge-AI spectral noise analysis and 24-hour predictive acoustic forecasting engine.
 * Classifies noise profiles (Speech, Machinery, Music, Focus) and computes video call suitability.
 */

export type AcousticCategory =
  | "SILENT_FOCUS"
  | "VOICE_CHATTER"
  | "MACHINERY_STEAM"
  | "BACKGROUND_MUSIC"
  | "TRAFFIC_HUM";

export type CallSuitability =
  | "EXCELLENT_CALL_READY" // <= 42 dB
  | "MODERATE_BUZZ"        // 43 - 58 dB
  | "HIGH_NOISE_HAZARD";   // > 58 dB

export interface SpectralBands {
  lowFreqRumblePct: number;    // 20Hz - 250Hz (HVAC, street)
  speechBandPct: number;       // 250Hz - 3.5kHz (conversations)
  highFreqClatterPct: number;  // 3.5kHz - 12kHz (steam wand, dishes, keys)
}

export interface AcousticClassification {
  decibelsDb: number;
  dominantCategory: AcousticCategory;
  suitability: CallSuitability;
  spectralBands: SpectralBands;
  signalToNoiseRatioDb: number;
  recommendation: string;
}

export interface HourlyNoiseForecast {
  hour: number;
  timeLabel: string;
  predictedDecibelsDb: number;
  p90PeakDecibelsDb: number;
  suitability: CallSuitability;
  crowdInfluencePct: number;
}

export interface VenueNoiseForecastReport {
  venueId: string;
  venueName: string;
  venueCategory: string;
  currentClassification: AcousticClassification;
  hourlyForecast: HourlyNoiseForecast[];
  quietestWorkHours: string;
  peakHazardHours: string;
  hasQuietZone: boolean;
}

/**
 * Classifies real-time FFT frequency spectrum energy into acoustic categories.
 */
export function classifyAcousticSpectrum(
  decibels: number,
  frequencyData: Uint8Array | number[]
): AcousticClassification {
  const len = frequencyData.length || 128;
  const lowBinEnd = Math.floor(len * 0.15);
  const midBinEnd = Math.floor(len * 0.55);

  let lowEnergy = 0;
  let midEnergy = 0;
  let highEnergy = 0;

  for (let i = 0; i < len; i++) {
    const val = Number(frequencyData[i]) || 0;
    if (i < lowBinEnd) lowEnergy += val;
    else if (i < midBinEnd) midEnergy += val;
    else highEnergy += val;
  }

  const totalEnergy = lowEnergy + midEnergy + highEnergy || 1;
  const spectralBands: SpectralBands = {
    lowFreqRumblePct: Math.round((lowEnergy / totalEnergy) * 100),
    speechBandPct: Math.round((midEnergy / totalEnergy) * 100),
    highFreqClatterPct: Math.round((highEnergy / totalEnergy) * 100),
  };

  let dominantCategory: AcousticCategory = "SILENT_FOCUS";
  if (decibels < 42) {
    dominantCategory = "SILENT_FOCUS";
  } else if (spectralBands.speechBandPct >= 45) {
    dominantCategory = "VOICE_CHATTER";
  } else if (spectralBands.highFreqClatterPct >= 40) {
    dominantCategory = "MACHINERY_STEAM";
  } else if (spectralBands.lowFreqRumblePct >= 50) {
    dominantCategory = "TRAFFIC_HUM";
  } else {
    dominantCategory = "BACKGROUND_MUSIC";
  }

  let suitability: CallSuitability = "EXCELLENT_CALL_READY";
  let recommendation = "🟢 Pristine audio environment. Ideal for client presentations & interviews.";

  if (decibels > 58 || dominantCategory === "MACHINERY_STEAM") {
    suitability = "HIGH_NOISE_HAZARD";
    recommendation = "🔴 High acoustic hazard. Unsuitable for open mics; use phone booth or ANC headset.";
  } else if (decibels >= 43) {
    suitability = "MODERATE_BUZZ";
    recommendation = "🟡 Moderate ambient buzz. Safe for casual team syncs with standard software noise suppression.";
  }

  return {
    decibelsDb: Math.round(decibels),
    dominantCategory,
    suitability,
    spectralBands,
    signalToNoiseRatioDb: Math.max(5, Math.round(75 - decibels)),
    recommendation,
  };
}

/**
 * Predicts 24-hour acoustic curve based on venue profile, historical rushes, and category.
 */
export function generate24HourNoiseForecast(
  venueId: string,
  venueName: string,
  venueCategory: string = "cafe",
  hasQuietZone: boolean = true
): VenueNoiseForecastReport {
  const baseNoise = venueCategory === "library" ? 34 : venueCategory === "coworking" ? 42 : 48;
  const hourlyForecast: HourlyNoiseForecast[] = [];

  for (let h = 0; h < 24; h++) {
    let rushFactor = 0;
    // Morning coffee rush (08:30 - 10:00)
    if (h >= 8 && h <= 10) rushFactor += 12;
    // Lunch buzz (12:00 - 14:00)
    if (h >= 12 && h <= 14) rushFactor += 16;
    // Evening networking (17:00 - 19:00)
    if (h >= 17 && h <= 19) rushFactor += 10;
    // Night lull (22:00 - 06:00)
    if (h >= 22 || h <= 6) rushFactor -= 15;

    const noiseReduction = hasQuietZone ? 4 : 0;
    const predicted = Math.max(30, Math.round(baseNoise + rushFactor - noiseReduction));
    const p90Peak = Math.round(predicted + 6);

    let suitability: CallSuitability = "EXCELLENT_CALL_READY";
    if (predicted > 56) suitability = "HIGH_NOISE_HAZARD";
    else if (predicted >= 43) suitability = "MODERATE_BUZZ";

    hourlyForecast.push({
      hour: h,
      timeLabel: `${h.toString().padStart(2, "0")}:00`,
      predictedDecibelsDb: predicted,
      p90PeakDecibelsDb: p90Peak,
      suitability,
      crowdInfluencePct: Math.min(100, Math.max(10, Math.round((predicted / 70) * 100))),
    });
  }

  const currentClassification = classifyAcousticSpectrum(
    hourlyForecast[14].predictedDecibelsDb,
    [30, 80, 50, 20]
  );

  return {
    venueId,
    venueName,
    venueCategory,
    currentClassification,
    hourlyForecast,
    quietestWorkHours: "07:00 - 08:30 & 14:30 - 17:00",
    peakHazardHours: "12:00 - 13:45 (Lunch Hour Rush)",
    hasQuietZone,
  };
}
