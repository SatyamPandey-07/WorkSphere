import {
  calculateBeaconCalibration,
  calculateMean,
  calculateStandardDeviation,
} from "@/lib/beaconCalibration";

describe("beacon calibration math", () => {
  it("calculates the sample mean and population standard deviation", () => {
    const samples = [-50, -52, -54];

    expect(calculateMean(samples)).toBe(-52);
    expect(calculateStandardDeviation(samples)).toBeCloseTo(Math.sqrt(8 / 3));
  });

  it("calculates the path-loss exponent and reference RSSI", () => {
    const calibration = calculateBeaconCalibration(
      [-50, -52, -54],
      1,
      [-59, -61, -63],
      3,
    );

    expect(calibration.firstMeanRssi).toBe(-52);
    expect(calibration.secondMeanRssi).toBe(-61);
    expect(calibration.firstStandardDeviation).toBeCloseTo(Math.sqrt(8 / 3));
    expect(calibration.secondStandardDeviation).toBeCloseTo(Math.sqrt(8 / 3));
    expect(calibration.pathLossExponent).toBeCloseTo(
      9 / (10 * Math.log10(3)),
    );
    expect(calibration.referenceRssi).toBeCloseTo(-52);
  });

  it("rejects empty and non-finite samples and invalid distances", () => {
    expect(() => calculateMean([])).toThrow(/at least one finite value/i);
    expect(() => calculateStandardDeviation([Number.NaN])).toThrow(
      /at least one finite value/i,
    );
    expect(() =>
      calculateBeaconCalibration([-50], 1, [-60], 1),
    ).toThrow(/positive and different/i);
  });
});
