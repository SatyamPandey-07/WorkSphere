export const DEFAULT_RDP_ORDERS = [
  1.25, 1.5, 2, 3, 4, 5, 8, 10, 16, 24, 32, 48, 64, 96, 128, 256,
] as const;

export type RdpVector = number[];
export type RandomSource = () => number;

export function clipByL2Sensitivity(
  values: ArrayLike<number>,
  sensitivity: number,
): number[] {
  if (!Number.isFinite(sensitivity) || sensitivity <= 0) {
    throw new Error("Sensitivity must be a positive finite number");
  }

  let normSquared = 0;
  const clipped = Array.from(values, (value) => {
    if (!Number.isFinite(value)) {
      throw new Error("Values must contain only finite numbers");
    }
    normSquared += value * value;
    return value;
  });

  const norm = Math.sqrt(normSquared);
  if (norm > sensitivity) {
    const scale = sensitivity / norm;
    for (let i = 0; i < clipped.length; i++) clipped[i] *= scale;
  }
  return clipped;
}

export function gaussianRdp(
  sigma: number,
  sensitivity: number,
  orders: readonly number[] = DEFAULT_RDP_ORDERS,
): RdpVector {
  if (!Number.isFinite(sigma) || sigma <= 0) {
    throw new Error("Gaussian sigma must be a positive finite number");
  }
  if (!Number.isFinite(sensitivity) || sensitivity <= 0) {
    throw new Error("Sensitivity must be a positive finite number");
  }
  validateOrders(orders);
  const variance = sigma * sigma;
  return orders.map((order) => (order * sensitivity * sensitivity) / (2 * variance));
}

export function composeRdp(...vectors: RdpVector[]): RdpVector {
  if (vectors.length === 0) return [];
  const length = vectors[0].length;
  if (vectors.some((vector) => vector.length !== length)) {
    throw new Error("RDP vectors must have matching lengths");
  }
  return Array.from({ length }, (_, index) =>
    vectors.reduce((total, vector) => total + vector[index], 0),
  );
}

export function rdpToEpsilon(
  rdp: RdpVector,
  delta: number,
  orders: readonly number[] = DEFAULT_RDP_ORDERS,
): number {
  if (!Number.isFinite(delta) || delta <= 0 || delta >= 1) {
    throw new Error("Delta must be between 0 and 1");
  }
  if (rdp.length !== orders.length) {
    throw new Error("RDP values and orders must have matching lengths");
  }
  validateOrders(orders);
  return Math.min(
    ...orders.map((order, index) => {
      const cost = rdp[index];
      if (!Number.isFinite(cost) || cost < 0) {
        throw new Error("RDP costs must be non-negative finite numbers");
      }
      return cost + Math.log(1 / delta) / (order - 1);
    }),
  );
}

/** Calibrate a Gaussian release to the remaining composed (epsilon, delta) budget. */
export function calibrateGaussianSigma(
  sensitivity: number,
  epsilonBudget: number,
  delta: number,
  spentRdp: RdpVector = DEFAULT_RDP_ORDERS.map(() => 0),
  orders: readonly number[] = DEFAULT_RDP_ORDERS,
): number | null {
  if (!Number.isFinite(epsilonBudget) || epsilonBudget <= 0) {
    throw new Error("Epsilon budget must be a positive finite number");
  }
  if (spentRdp.length !== orders.length) {
    throw new Error("RDP values and orders must have matching lengths");
  }
  validateOrders(orders);

  const classicGaussianSigma =
    (sensitivity * Math.sqrt(2 * Math.log(1.25 / delta))) / epsilonBudget;
  if (rdpToEpsilon(spentRdp, delta, orders) >= epsilonBudget) return null;
  let lower = classicGaussianSigma;
  let upper = classicGaussianSigma;
  const fitsBudget = (sigma: number) =>
    rdpToEpsilon(
      composeRdp(spentRdp, gaussianRdp(sigma, sensitivity, orders)),
      delta,
      orders,
    ) <= epsilonBudget;

  let expansions = 0;
  while (!fitsBudget(upper)) {
    lower = upper;
    upper *= 2;
    if (!Number.isFinite(upper) || ++expansions > 64) return null;
  }

  for (let iteration = 0; iteration < 64; iteration++) {
    const midpoint = (lower + upper) / 2;
    if (fitsBudget(midpoint)) upper = midpoint;
    else lower = midpoint;
  }
  return upper;
}

export function sampleStandardNormal(random: RandomSource = secureRandom): number {
  let first = 0;
  while (first === 0) first = random();
  const second = random();
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
}

export function addGaussianNoise(
  values: number[],
  sigma: number,
  random: RandomSource = secureRandom,
): number[] {
  if (!Number.isFinite(sigma) || sigma < 0) {
    throw new Error("Gaussian sigma must be a non-negative finite number");
  }
  return values.map((value) => value + sigma * sampleStandardNormal(random));
}

function secureRandom(): number {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== "function") {
    throw new Error("A cryptographically secure random source is required for DP");
  }
  const randomValue = new Uint32Array(1);
  cryptoApi.getRandomValues(randomValue);
  return randomValue[0] / 0x100000000;
}

function validateOrders(orders: readonly number[]): void {
  if (
    orders.length === 0 ||
    orders.some((order) => !Number.isFinite(order) || order <= 1)
  ) {
    throw new Error("RDP orders must be finite values greater than 1");
  }
}