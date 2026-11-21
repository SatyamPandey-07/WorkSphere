export function calculateCarbonSavingsPercent(
  baselineKg: number,
  actualKg: number
): number {
  if (
    typeof baselineKg !== 'number' ||
    typeof actualKg !== 'number' ||
    !Number.isFinite(baselineKg) ||
    !Number.isFinite(actualKg) ||
    baselineKg <= 0
  ) {
    return 0;
  }

  const rawPercent = ((baselineKg - actualKg) / baselineKg) * 100;
  if (!Number.isFinite(rawPercent)) {
    return 0;
  }

  const clamped = Math.max(0, rawPercent);
  return Math.round(clamped * 100) / 100;
}