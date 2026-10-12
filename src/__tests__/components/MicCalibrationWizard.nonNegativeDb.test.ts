import { describe, it, expect } from "vitest";
import {
  rmsToCalibratedDb,
  getMicCalibration,
  type MicCalibrationProfile,
} from "@/lib/noise/calibration";

describe("MicCalibrationWizard Non-Negative Decibel Normalization (#5728)", () => {
  it("clamps uncalibrated and calibrated decibels to minimum 0 dB display floor", () => {
    // Extreme silence / zero RMS amplitude
    const zeroRms = 0;
    const dbZero = rmsToCalibratedDb(zeroRms);
    expect(dbZero).toBeGreaterThanOrEqual(0);
    expect(dbZero).toBeLessThanOrEqual(120);

    // Negative offset with near-zero RMS
    const profileWithNegativeOffset: MicCalibrationProfile = {
      offsetDb: -25,
      sensitivity: 1.0,
      profileType: "headset",
      calibratedAt: new Date().toISOString(),
    };

    const dbNegativeOffset = rmsToCalibratedDb(0.0000001, profileWithNegativeOffset);
    expect(dbNegativeOffset).toBe(0);
  });

  it("normalizes output strictly between 0 dB and 120 dB SPL across input audio spectrum", () => {
    // Spectrum of RMS amplitudes from infinitesimal to extreme clipping
    const testRmsValues = [
      0.0,
      1e-9,
      1e-6,
      0.00001, // extremely faint room silence
      0.001,   // whisper / low noise
      0.01,    // quiet conversation
      0.1,     // loud speech / music
      0.5,     // shouting
      1.0,     // 0 dBFS full digital ceiling
      2.0,     // clipped signal
      10.0,    // extreme overload
    ];

    const testOffsets = [-30, -15, -8, -5, 0, 4, 10, 20, 30];

    testOffsets.forEach((offset) => {
      const profile: MicCalibrationProfile = {
        offsetDb: offset,
        sensitivity: 1.0,
        profileType: "custom",
        calibratedAt: new Date().toISOString(),
      };

      testRmsValues.forEach((rms) => {
        const db = rmsToCalibratedDb(rms, profile);
        expect(db).toBeGreaterThanOrEqual(0);
        expect(db).toBeLessThanOrEqual(120);
        expect(Number.isFinite(db)).toBe(true);
      });
    });
  });

  it("prevents negative raw values when offset is 0 dB", () => {
    const rawProfile: MicCalibrationProfile = {
      offsetDb: 0,
      sensitivity: 1.0,
      profileType: "built_in",
      calibratedAt: new Date().toISOString(),
    };

    const silenceDb = rmsToCalibratedDb(0, rawProfile);
    expect(silenceDb).toBe(0);
  });
});
