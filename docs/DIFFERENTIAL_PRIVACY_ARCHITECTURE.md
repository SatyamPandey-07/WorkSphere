# Differential Privacy & Client-Side Noise Injection Architecture

This document outlines the architectural and mathematical principles of the Differential Privacy (DP) telemetry pipeline in WorkSphere. It details the mechanisms for Laplace noise injection, epsilon ($\epsilon$) privacy budget tracking, client-side coordinate perturbation, and backend aggregation.

## 1. Overview

To protect individual user privacy while still allowing for aggregate analytical queries (e.g., global workspace density, cluster syncing), WorkSphere implements $\epsilon$-differential privacy at the client level. Instead of sending raw, precise spatial coordinates or analytics vectors to the server, the client injects calibrated noise into the data before transmission.

## 2. Laplace Noise Injection Algorithm

WorkSphere uses the Laplace mechanism to satisfy $\epsilon$-differential privacy. The Laplace distribution $Lap(\mu, b)$ has a probability density function:

$$ f(x | \mu, b) = \frac{1}{2b} \exp\left(-\frac{|x - \mu|}{b}\right) $$

where $\mu$ is the true value (mean) and $b$ is the scale parameter, defined as $b = \frac{\Delta f}{\epsilon}$ ($\Delta f$ being the sensitivity of the function).

### 2.1 Noise Generation Implementation

To generate Laplace noise in the browser, we use the inverse cumulative distribution function (CDF) technique applied to a uniform random variable $u \in (-0.5, 0.5]$:

$$ x = \mu - b \cdot \text{sgn}(u) \cdot \ln(1 - 2|u|) $$

**TypeScript Listing: Laplace Noise Generation**

```typescript
/**
 * Generates Laplace noise using the inverse CDF method.
 * @param scale The scale parameter (b) which equals sensitivity / epsilon.
 * @returns A randomly drawn value from the Laplace distribution.
 */
export function generateLaplaceNoise(scale: number): number {
  // Generate uniform random variable in range (-0.5, 0.5]
  let u = Math.random() - 0.5;

  // Prevent log(0)
  if (u === 0.5) u = 0.4999999999999999;

  // Apply inverse CDF of Laplace distribution
  return -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
}
```

## 3. Client-Side Coordinate Perturbation

For spatial telemetry (like heatmap coordinates or venue check-ins), we perturb the raw coordinates on the client before making any network requests.

**TypeScript Listing: Coordinate Perturbation**

```typescript
export interface GeoCoordinate {
  latitude: number;
  longitude: number;
}

/**
 * Perturbs an exact coordinate to preserve location privacy.
 * @param coord The true coordinates.
 * @param sensitivity The geographic sensitivity parameter.
 * @param epsilon The privacy budget allocated for this sync.
 * @returns The perturbed coordinates.
 */
export function perturbCoordinate(
  coord: GeoCoordinate,
  sensitivity: number,
  epsilon: number,
): GeoCoordinate {
  const scale = sensitivity / epsilon;

  let noisyLat = coord.latitude + generateLaplaceNoise(scale);
  let noisyLng = coord.longitude + generateLaplaceNoise(scale);

  // Edge Case: Ensure perturbed coordinates remain within valid geographic bounds
  noisyLat = Math.max(-90, Math.min(90, noisyLat));
  noisyLng = Math.max(-180, Math.min(180, noisyLng));

  return {
    latitude: noisyLat,
    longitude: noisyLng,
  };
}
```

## 4. Epsilon ($\epsilon$) Privacy Budget Tracking

Under the composition theorem of differential privacy, each independent telemetry sync consumes a portion of the user's total privacy budget ($\epsilon$). WorkSphere rigorously tracks this on the client.

### 4.1 Budget Management Rules

1. **Initial Allocation**: A session starts with a fixed global privacy budget (e.g., $\epsilon_{total} = 5.0$).
2. **Consumption**: Every time data is perturbed and sent, the $\epsilon$ used for that specific perturbation is deducted.
3. **Exhaustion**: If a sync requires an $\epsilon_{request}$ that exceeds the remaining budget, the client **must halt** the telemetry request entirely. No data is sent.

**TypeScript Listing: Budget Tracking**

```typescript
export interface PrivacyBudget {
  totalAllocated: number;
  consumed: number;
}

export function canSync(
  budget: PrivacyBudget,
  requiredEpsilon: number,
): boolean {
  return budget.consumed + requiredEpsilon <= budget.totalAllocated;
}

export function recordSync(
  budget: PrivacyBudget,
  epsilonUsed: number,
): PrivacyBudget {
  if (!canSync(budget, epsilonUsed)) {
    throw new Error("Privacy budget exhausted. Sync aborted.");
  }
  return {
    ...budget,
    consumed: budget.consumed + epsilonUsed,
  };
}
```

## 5. Backend Aggregation

Because the noise injected on the client side has a mean of zero ($\mu = 0$), aggregating a sufficiently large number of perturbed coordinate sets on the server side cancels out the noise.

1. **Law of Large Numbers**: As $N$ (number of user inputs) grows, the sample mean of the noisy data converges to the true mean of the underlying population.
2. **Global Density Maps**: Heatmaps and density metrics remain statistically accurate for the venue at a macro level, but no individual user's specific pathway or precise desk location can be reverse-engineered (preventing centroid inversion attacks).
