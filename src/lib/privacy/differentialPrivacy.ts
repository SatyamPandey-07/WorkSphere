/**
 * Differential privacy module for protecting user occupancy counts.
 */

/**
 * Generates Laplace distributed noise using inverse transform sampling.
 * X = -b * sgn(U) * ln(1 - 2|U|)
 * U ~ Uniform(-0.5, 0.5)
 * b = Δf / ε
 *
 * @param epsilon The privacy budget (ε > 0)
 * @param deltaF The global sensitivity (Δf)
 */
export function generateLaplaceNoise(epsilon: number, deltaF: number = 1): number {
  if (epsilon <= 0) {
    throw new Error("Epsilon must be > 0");
  }
  
  const b = deltaF / epsilon;
  
  // Math.random() is in [0, 1), so Math.random() - 0.5 is in [-0.5, 0.5)
  let U = Math.random() - 0.5;
  
  // Avoid |U| = 0.5 which would result in ln(0) = -Infinity
  if (Math.abs(U) === 0.5) {
    U = 0.4999999999999999;
  }
  
  const sgn = Math.sign(U) || 1; 
  const X = -b * sgn * Math.log(1 - 2 * Math.abs(U));
  
  return X;
}

/**
 * Applies a differential privacy filter to an occupancy count.
 * 
 * @param trueCount The actual headcount
 * @param maxCapacity The maximum valid capacity (for clamping)
 * @param epsilon Privacy budget (default: 1.0)
 * @param threshold Only apply privacy if trueCount < threshold (default: 10)
 */
export function applyPrivacyFilter(
  trueCount: number,
  maxCapacity: number,
  epsilon: number = 1.0,
  threshold: number = 10
): number {
  // API Integration: Apply the privacy filter to public venue occupancy queries 
  // when active visitors are below threshold N < 10.
  if (trueCount >= threshold) {
    return trueCount;
  }
  
  const noise = generateLaplaceNoise(epsilon, 1);
  
  // Add noise and round to get an integer headcount
  let noisyCount = Math.round(trueCount + noise);
  
  // Clamp noisy output to valid integer ranges [0, maxCapacity]
  noisyCount = Math.max(0, Math.min(noisyCount, maxCapacity));
  
  return noisyCount;
}
