import {
  addGaussianNoise,
  calibrateGaussianSigma,
  clipByL2Sensitivity,
  composeRdp,
  DEFAULT_RDP_ORDERS,
  gaussianRdp,
  rdpToEpsilon,
} from "@/lib/privacy/rdpAccountant";

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe("RDP accountant", () => {
  it("clips vectors to the configured L2 sensitivity", () => {
    const clipped = clipByL2Sensitivity([3, 4], 2);
    expect(clipped[0]).toBeCloseTo(1.2, 10);
    expect(clipped[1]).toBeCloseTo(1.6, 10);
    expect(clipByL2Sensitivity([0.3, 0.4], 1)).toEqual([0.3, 0.4]);
    expect(() => clipByL2Sensitivity([1, Number.NaN], 1)).toThrow();
  });

  it("composes Gaussian RDP costs across submissions", () => {
    const oneSubmission = gaussianRdp(2, 1, [2, 4]);
    expect(oneSubmission).toEqual([0.25, 0.5]);
    expect(composeRdp(oneSubmission, oneSubmission)).toEqual([0.5, 1]);
  });

  it("converts RDP at each order and chooses the tightest epsilon bound", () => {
    const orders = [2, 4];
    const rdp = [0.5, 0.25];
    const expected = Math.min(
      0.5 + Math.log(1e5),
      0.25 + Math.log(1e5) / 3,
    );
    expect(rdpToEpsilon(rdp, 1e-5, orders)).toBeCloseTo(expected, 10);
  });

  it("calibrates each Gaussian submission to stay within the remaining budget", () => {
    const delta = 1e-5;
    const budget = 1;
    const firstSigma = calibrateGaussianSigma(1, budget, delta);
    if (firstSigma === null) throw new Error("Expected a feasible first release");
    expect(firstSigma).toBeGreaterThanOrEqual(
      Math.sqrt(2 * Math.log(1.25 / delta)) / budget,
    );
    const firstCost = gaussianRdp(firstSigma, 1);
    expect(rdpToEpsilon(firstCost, delta)).toBeLessThanOrEqual(budget + 1e-10);

    const composed = composeRdp(firstCost, firstCost);
    const secondSigma = calibrateGaussianSigma(1, budget, delta, firstCost);
    if (secondSigma === null) throw new Error("Expected a feasible second release");
    expect(secondSigma).toBeGreaterThan(firstSigma);
    expect(
      rdpToEpsilon(composeRdp(composed, gaussianRdp(secondSigma, 1)), delta),
    ).toBeLessThanOrEqual(budget + 1e-10);
  });

  it("produces approximately centered Gaussian noise at the requested scale", () => {
    const samples = addGaussianNoise(
      Array(20_000).fill(0),
      0.75,
      seededRandom(42),
    );
    const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
    const variance =
      samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      samples.length;
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(Math.sqrt(variance)).toBeCloseTo(0.75, 1);
  });

  it("uses the documented RDP order grid", () => {
    expect(DEFAULT_RDP_ORDERS[0]).toBeGreaterThan(1);
    expect(DEFAULT_RDP_ORDERS.length).toBeGreaterThan(8);
  });
});