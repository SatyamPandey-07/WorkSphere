export function mean(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  return numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
}

export function variance(numbers: number[]): number {
  if (numbers.length <= 1) return 0;
  const m = mean(numbers);
  return (
    numbers.reduce((sum, n) => sum + Math.pow(n - m, 2), 0) /
    (numbers.length - 1)
  );
}

export function standardDeviation(numbers: number[]): number {
  return Math.sqrt(variance(numbers));
}
