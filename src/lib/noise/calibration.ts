/**
 * Microphone dB Calibration & Acoustic Offset Utility
 * Manages device-specific gain offsets and reference calibration for noise level telemetry.
 */

export interface MicCalibrationProfile {
  offsetDb: number; // Applied offset in dB (-30 to +30)
  sensitivity: number; // Scaling factor (0.1 to 2.0)
  profileType: "built_in" | "smartphone" | "headset" | "studio_mic" | "custom";
  deviceName?: string;
  calibratedAt: string; // ISO string
  baselineNoiseFloorDb?: number;
}

export const DEFAULT_CALIBRATION: MicCalibrationProfile = {
  offsetDb: 0,
  sensitivity: 1.0,
  profileType: "built_in",
  calibratedAt: new Date().toISOString(),
};

export const DEVICE_PRESETS: Record<
  MicCalibrationProfile["profileType"],
  { label: string; description: string; defaultOffset: number }
> = {
  built_in: {
    label: "Built-in Laptop / PC Mic",
    description: "Standard integrated omnidirectional microphone (default baseline).",
    defaultOffset: 0,
  },
  smartphone: {
    label: "Smartphone / Tablet Mic",
    description: "Mobile microphones usually have higher preamp sensitivity (+4 dB offset).",
    defaultOffset: 4,
  },
  headset: {
    label: "USB / Bluetooth Headset",
    description: "Close-proximity boom microphone with background noise attenuation (-5 dB offset).",
    defaultOffset: -5,
  },
  studio_mic: {
    label: "External / Studio Condenser Mic",
    description: "High sensitivity cardioid or condenser microphone (-8 dB offset).",
    defaultOffset: -8,
  },
  custom: {
    label: "Custom Calibration",
    description: "User-calibrated against a reference acoustic source or sound meter.",
    defaultOffset: 0,
  },
};

const STORAGE_KEY = "worksphere_mic_calibration";

/**
 * Load saved calibration profile from localStorage.
 */
export function getMicCalibration(): MicCalibrationProfile {
  if (typeof window === "undefined") {
    return DEFAULT_CALIBRATION;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CALIBRATION;
    const parsed = JSON.parse(raw);
    return {
      offsetDb: typeof parsed.offsetDb === "number" ? parsed.offsetDb : 0,
      sensitivity: typeof parsed.sensitivity === "number" ? parsed.sensitivity : 1.0,
      profileType: parsed.profileType || "built_in",
      deviceName: parsed.deviceName,
      calibratedAt: parsed.calibratedAt || new Date().toISOString(),
      baselineNoiseFloorDb: parsed.baselineNoiseFloorDb,
    };
  } catch {
    return DEFAULT_CALIBRATION;
  }
}

/**
 * Save calibration profile to localStorage.
 */
export function saveMicCalibration(profile: MicCalibrationProfile): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    window.dispatchEvent(new CustomEvent("worksphere:mic-calibration-changed", { detail: profile }));
  } catch (err) {
    console.error("Failed to save mic calibration:", err);
  }
}

/**
 * Reset calibration profile to factory defaults.
 */
export function resetMicCalibration(): MicCalibrationProfile {
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(STORAGE_KEY);
      window.dispatchEvent(new CustomEvent("worksphere:mic-calibration-changed", { detail: DEFAULT_CALIBRATION }));
    } catch {}
  }
  return DEFAULT_CALIBRATION;
}

/**
 * Converts audio RMS to Calibrated Decibels (dB SPL equivalent).
 * Clamps output between 0 dB (absolute silence) and 130 dB (threshold of pain)
 * to filter out acoustic distortion spikes and microphone clipping.
 */
export function rmsToCalibratedDb(
  rms: number,
  calibration: MicCalibrationProfile = getMicCalibration()
): number {
  if (rms <= 0.000001) {
    const calibratedSpl = calibration.offsetDb;
    return Math.max(0, Math.min(120, Math.round(calibratedSpl * 10) / 10));
  }

  // Raw dBFS calculation (0 dBFS is digital maximum)
  const dbfs = 20 * Math.log10(rms * calibration.sensitivity);

  // Standard conversion mapping full scale to ~100-110 dB SPL reference range
  const rawSpl = dbfs + 100;

  // Apply calibration offset
  const calibratedSpl = rawSpl + calibration.offsetDb;

  // Clamp within normalized acoustic range (0 dB floor to 120 dB SPL maximum)
  return Math.max(0, Math.min(120, Math.round(calibratedSpl * 10) / 10));
}

/**
 * Normalizes raw frequency gain or decibel value to a percentage/height bounded strictly in [0, 100].
 * Prevents extreme burst signals from causing visual spectrum bars to overflow SVG container bounds.
 */
export function normalizeFrequencyGain(val: number): number {
  if (typeof val !== "number" || isNaN(val)) return 0;
  return Math.min(100, Math.max(0, val));
}

