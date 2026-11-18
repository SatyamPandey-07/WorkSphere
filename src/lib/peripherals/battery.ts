export type BatteryLevel = "good" | "medium" | "low";

/** Below this charge a peripheral counts as low. */
export const LOW_BATTERY_THRESHOLD = 20;
/** Above this charge a peripheral counts as good. */
export const GOOD_BATTERY_THRESHOLD = 50;

/**
 * Clamps a battery reading to 0-100 and rounds it to a whole percent.
 * Returns null for missing or non-numeric values so callers can hide the indicator.
 */
export function normalizeBatteryPercent(
  value: number | null | undefined,
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(Math.min(100, Math.max(0, value)));
}

/**
 * Colour tier for a charge level: good above 50%, medium from 20% to 50%
 * (inclusive), low below 20%. Returns null when there is no valid reading.
 */
export function getBatteryLevel(
  value: number | null | undefined,
): BatteryLevel | null {
  const percent = normalizeBatteryPercent(value);
  if (percent === null) return null;
  if (percent > GOOD_BATTERY_THRESHOLD) return "good";
  if (percent >= LOW_BATTERY_THRESHOLD) return "medium";
  return "low";
}

export function isLowBattery(value: number | null | undefined): boolean {
  return getBatteryLevel(value) === "low";
}

/** Warning text for a device below the low-battery threshold, otherwise null. */
export function getLowBatteryWarning(
  name: string,
  value: number | null | undefined,
): string | null {
  const percent = normalizeBatteryPercent(value);
  if (percent === null || !isLowBattery(percent)) return null;
  return `${name} is at ${percent}% battery and may run out during your session. Consider choosing another device or bringing a charger.`;
}
