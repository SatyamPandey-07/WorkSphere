export function mean(numbers: number[]): number {
  if (!numbers || !Array.isArray(numbers)) return 0;
  const valid = numbers.filter((n) => typeof n === "number" && Number.isFinite(n));
  if (valid.length === 0) return 0;
  return valid.reduce((sum, n) => sum + n, 0) / valid.length;
}

export function variance(numbers: number[]): number {
  if (!numbers || !Array.isArray(numbers)) return 0;
  const valid = numbers.filter((n) => typeof n === "number" && Number.isFinite(n));
  if (valid.length <= 1) return 0;
  const m = mean(valid);
  return (
    valid.reduce((sum, n) => sum + Math.pow(n - m, 2), 0) /
    (valid.length - 1)
  );
}

export function standardDeviation(numbers: number[]): number {
  return Math.sqrt(variance(numbers));
}

export function median(numbers: number[]): number {
  if (!numbers || !Array.isArray(numbers)) return 0;
  const valid = numbers.filter((n) => typeof n === "number" && Number.isFinite(n));
  if (valid.length === 0) return 0;
  const sorted = [...valid].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

