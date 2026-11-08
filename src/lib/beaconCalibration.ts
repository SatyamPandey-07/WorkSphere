export type BeaconCalibration = {
  referenceRssi: number;
  pathLossExponent: number;
  firstMeanRssi: number;
  firstStandardDeviation: number;
  secondMeanRssi: number;
  secondStandardDeviation: number;
};

export function calculateMean(samples: readonly number[]): number {
  if (samples.length === 0 || samples.some((sample) => !Number.isFinite(sample))) {
    throw new Error("RSSI samples must contain at least one finite value.");
  }

  return samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
}

export function calculateStandardDeviation(
  samples: readonly number[],
): number {
  const mean = calculateMean(samples);
  const squaredDifferences = samples.map((sample) => (sample - mean) ** 2);
  return Math.sqrt(
    squaredDifferences.reduce((sum, difference) => sum + difference, 0) /
      samples.length,
  );
}

export function calculateBeaconCalibration(
  firstSamples: readonly number[],
  firstDistance: number,
  secondSamples: readonly number[],
  secondDistance: number,
): BeaconCalibration {
  if (
    !Number.isFinite(firstDistance) ||
    !Number.isFinite(secondDistance) ||
    firstDistance <= 0 ||
    secondDistance <= 0 ||
    firstDistance === secondDistance
  ) {
    throw new Error("Calibration distances must be positive and different.");
  }

  const firstMeanRssi = calculateMean(firstSamples);
  const secondMeanRssi = calculateMean(secondSamples);
  const distanceRatioLog = Math.log10(secondDistance / firstDistance);
  const pathLossExponent =
    (firstMeanRssi - secondMeanRssi) / (10 * distanceRatioLog);
  if (!Number.isFinite(pathLossExponent) || pathLossExponent <= 0) {
    throw new Error(
      "RSSI measurements did not produce a positive path-loss exponent.",
    );
  }

  const referenceRssi =
    firstMeanRssi + 10 * pathLossExponent * Math.log10(firstDistance);
  if (!Number.isFinite(referenceRssi)) {
    throw new Error("Calibration produced an invalid reference RSSI.");
  }

  return {
    referenceRssi,
    pathLossExponent,
    firstMeanRssi,
    firstStandardDeviation: calculateStandardDeviation(firstSamples),
    secondMeanRssi,
    secondStandardDeviation: calculateStandardDeviation(secondSamples),
  };
}
