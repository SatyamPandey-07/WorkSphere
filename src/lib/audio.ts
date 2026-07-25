export function calculateRMS(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

export function rmsToDecibels(rms: number): number {
  // Floor to avoid -Infinity for perfect silence
  if (rms <= 0) return 30;

  // Browsers provide uncalibrated linear amplitudes roughly mapped from -1 to 1.
  // 0 dBFS (full scale) corresponds to rms = 1 (or 0.707 sine wave).
  // A typical smartphone mic might map 0 dBFS to ~100-110 dBSPL.
  // We use a +100 dB calibration offset to get values in the 30-90 dB range.
  const calibrationOffset = 100;
  const db = 20 * Math.log10(rms) + calibrationOffset;

  return Math.max(30, Math.min(db, 120)); // clamp to realistic values
}
