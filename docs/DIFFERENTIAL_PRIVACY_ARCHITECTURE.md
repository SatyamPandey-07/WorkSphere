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

## 6. DP-SGD in the Federated Venue Trainer

The on-device venue recommender (`src/workers/federatedTrainer.worker.ts`) fine-tunes a linear scoring head with SGD on private engagement labels. Raw labels never leave the device, but the trained weights are a function of them — and the planned weight-sync architecture (see `federated-learning-architecture.md`) would upload those weights. To bound what any single interaction can reveal through the weights, every gradient step uses **DP-SGD** (Abadi et al., 2016): per-example L2 clipping followed by Gaussian noise.

### 6.1 Algorithm

For each training example $x_i$ with label $y_i$, the trainer:

1. **Computes the gradient** of the binary cross-entropy loss over all parameters, weights and bias together:
   $$ g_i = \big[(\hat{y}_i - y_i)\,x_i,\ \hat{y}_i - y_i\big] $$
2. **Clips to a maximum L2 norm $C$** (`maxGradNorm`), which bounds the sensitivity of a single update:
   $$ \bar{g}_i = g_i \cdot \min\!\left(1, \frac{C}{\lVert g_i \rVert_2}\right) $$
3. **Adds Gaussian noise** scaled to that sensitivity, with $\sigma$ = `noiseMultiplier`:
   $$ \tilde{g}_i = \bar{g}_i + \mathcal{N}(0,\ \sigma^2 C^2 I) $$
4. **Applies the update**: $\theta \leftarrow \theta - \eta\,\tilde{g}_i$.

Clipping covers the weights and the bias jointly. Clipping only the weights would leave the bias as an unbounded channel that leaks the label.

### 6.2 Configuration

| Field             | Default | Meaning                                                                 |
| ----------------- | ------- | ----------------------------------------------------------------------- |
| `enabled`         | `true`  | `false` falls back to plain SGD (no clipping, no noise).                |
| `maxGradNorm`     | `1.0`   | Per-example clipping bound $C$. Must be finite and `> 0`.               |
| `noiseMultiplier` | `1.0`   | Noise std is `noiseMultiplier * maxGradNorm`. Must be finite and `>= 0`. |

Defaults live in `DEFAULT_DP_CONFIG` (`src/lib/federated/types.ts`). Override them when you start the trainer:

```typescript
import { FederatedVenueTrainer } from "@/lib/federated/federatedTrainer";

const trainer = new FederatedVenueTrainer();
await trainer.init(0.05, { maxGradNorm: 1.0, noiseMultiplier: 1.1 });
await trainer.train([{ features, label: 1 }]);
```

The worker validates overrides with `resolveDpConfig`. An invalid value, such as `maxGradNorm: 0`, rejects `init()` and never runs training with a broken privacy guarantee.

### 6.3 Implementation Map

| File                                       | Responsibility                                                                          |
| ------------------------------------------ | --------------------------------------------------------------------------------------- |
| `src/lib/federated/differentialPrivacy.ts` | `clipByL2Norm`, `addGaussianNoise`, Box–Muller `sampleStandardNormal`, `secureRandom`, `resolveDpConfig` |
| `src/lib/federated/linearVenueModel.ts`    | `computeGradient`, `dpSgdStep`, and `trainBatch(model, examples, dp?)`                  |
| `src/workers/federatedTrainer.worker.ts`   | Holds the resolved config and passes it to every `train` request                        |
| `src/lib/federated/federatedTrainer.ts`    | Main-thread client; forwards `dp` overrides in the `init` message                       |

**Randomness:** noise comes from `crypto.getRandomValues` (available in Web Workers). The DP guarantee assumes an adversary can't predict the noise, so `Math.random` is used only as a fallback when Web Crypto is unavailable. Every noise function also accepts an injectable `RandomSource`, which keeps the tests deterministic.

### 6.4 Privacy / Utility Trade-off

- The noise is zero-mean, so it averages out across many steps while each individual update stays masked. Higher `noiseMultiplier` gives stronger privacy and slower, noisier personalization.
- A lower `maxGradNorm` reduces the noise added in absolute terms, but it also clips informative gradients more aggressively. `1.0` is the conventional starting point.
- The overall $(\epsilon, \delta)$ guarantee depends on $\sigma$, the number of steps, and the sampling rate, under composition. The trainer does not yet run a privacy accountant (such as RDP / moments accountant). Add one before weights are shared off-device, and enforce a budget the same way §4 does for telemetry.
