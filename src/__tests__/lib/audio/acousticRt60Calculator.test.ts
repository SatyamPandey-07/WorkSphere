import {
  calculateRt60FromImpulseResponse,
  calculateSabineRt60,
  MIN_RT60_SECONDS,
} from "@/lib/audio/acousticRt60Calculator";

describe("calculateSabineRt60", () => {
  it("calculates a finite reverberation time for valid room geometry", () => {
    const result = calculateSabineRt60({
      volumeM3: 120,
      surfaces: [
        { areaM2: 40, absorptionCoefficient: 0.4 },
        { areaM2: 60, absorptionCoefficient: 0.3 },
      ],
    });

    expect(result).toBeCloseTo(0.568235, 4);
    expect(Number.isFinite(result)).toBe(true);
  });

  it("rejects zero-volume, negative, and non-finite room geometry", () => {
    const surface = [{ areaM2: 20, absorptionCoefficient: 0.5 }];
    expect(calculateSabineRt60({ volumeM3: 0, surfaces: surface })).toBeNull();
    expect(calculateSabineRt60({ volumeM3: -10, surfaces: surface })).toBeNull();
    expect(calculateSabineRt60({ volumeM3: Number.NaN, surfaces: surface })).toBeNull();
  });

  it("rejects invalid absorption coefficients and zero total absorption", () => {
    expect(calculateSabineRt60({
      volumeM3: 50,
      surfaces: [{ areaM2: 10, absorptionCoefficient: 1.1 }],
    })).toBeNull();
    expect(calculateSabineRt60({
      volumeM3: 50,
      surfaces: [{ areaM2: 10, absorptionCoefficient: 0 }],
    })).toBeNull();
  });

  it("clamps highly absorptive rooms to the physical minimum", () => {
    const result = calculateSabineRt60({
      volumeM3: 1,
      surfaces: [{ areaM2: 100, absorptionCoefficient: 1 }],
    });
    expect(result).toBe(MIN_RT60_SECONDS);
  });
});

describe("calculateRt60FromImpulseResponse", () => {
  it("returns a finite RT60 estimate for a decaying impulse response", () => {
    const rir = new Float32Array(1200);
    for (let index = 0; index < rir.length; index += 1) {
      rir[index] = Math.exp(-index / 120);
    }

    const result = calculateRt60FromImpulseResponse(rir, 1000);
    expect(result).not.toBeNull();
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBeGreaterThanOrEqual(MIN_RT60_SECONDS);
  });

  it("clamps very short valid decay estimates to the minimum", () => {
    expect(
      calculateRt60FromImpulseResponse(new Float32Array([1, 0.1, 0]), 48_000),
    ).toBe(MIN_RT60_SECONDS);
  });

  it("rejects empty-energy, non-finite, and invalid sample-rate inputs", () => {
    expect(calculateRt60FromImpulseResponse(new Float32Array(8), 48_000)).toBeNull();
    expect(calculateRt60FromImpulseResponse(new Float32Array([1, Number.NaN]), 48_000)).toBeNull();
    expect(calculateRt60FromImpulseResponse(new Float32Array([1, 0]), 0)).toBeNull();
    expect(calculateRt60FromImpulseResponse(new Float32Array([1, 0]), Number.POSITIVE_INFINITY)).toBeNull();
  });
});
