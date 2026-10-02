import {
  computeGradient,
  createInitialModel,
  dpSgdStep,
  featuresFromArray,
  scoreVenue,
  sgdStep,
  sigmoid,
  trainBatch,
} from "@/lib/federated/linearVenueModel";
import {
  addGaussianNoise,
  clipByL2Norm,
  l2Norm,
  resolveDpConfig,
  sampleStandardNormal,
  secureRandom,
} from "@/lib/federated/differentialPrivacy";
import { DEFAULT_DP_CONFIG, FEATURE_DIM } from "@/lib/federated/types";
import { featuresToOnnxTensor } from "@/lib/federated/onnxBridge";

jest.mock("onnxruntime-web", () => ({
  env: { wasm: { numThreads: 1, simd: true } },
  Tensor: jest.fn().mockImplementation((_type: string, data: Float32Array, dims: number[]) => ({
    data,
    dims,
  })),
}));

describe("linearVenueModel", () => {
  it("scores venues in [0, 1]", () => {
    const model = createInitialModel(0.05);
    model.weights.fill(0);
    model.bias = 0;
    const features = featuresFromArray(Array(FEATURE_DIM).fill(0.5));
    const score = scoreVenue(model, features);
    expect(score).toBeCloseTo(sigmoid(0), 5);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("raises the score after positive engagement SGD steps", () => {
    const model = createInitialModel(0.2);
    model.weights.fill(0);
    model.bias = 0;
    const features = featuresFromArray([
      1, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0.2, 0.9,
    ]);

    const before = scoreVenue(model, features);
    for (let i = 0; i < 25; i++) {
      sgdStep(model, { features, label: 1 });
    }
    const after = scoreVenue(model, features);
    expect(after).toBeGreaterThan(before);
  });

  it("trains a batch of examples", () => {
    const model = createInitialModel(0.1);
    const features = featuresFromArray(Array(FEATURE_DIM).fill(0.8));
    const steps = trainBatch(model, [
      { features, label: 1 },
      { features, label: 0 },
    ]);
    expect(steps).toBe(2);
  });
});

describe("onnxBridge", () => {
  it("packs features into an ONNX float32 tensor", () => {
    const features = new Float32Array(FEATURE_DIM).fill(0.25);
    const tensor = featuresToOnnxTensor(features);
    expect(tensor.data).toBe(features);
    expect(tensor.dims).toEqual([1, FEATURE_DIM]);
  });
});

/** Deterministic uniform [0, 1) source (mulberry32) for reproducible noise. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function zeroModel(learningRate = 0.1) {
  const model = createInitialModel(learningRate);
  model.weights.fill(0);
  model.bias = 0;
  return model;
}

describe("differentialPrivacy", () => {
  it("defaults to maxGradNorm 1.0 with DP enabled", () => {
    expect(DEFAULT_DP_CONFIG.enabled).toBe(true);
    expect(DEFAULT_DP_CONFIG.maxGradNorm).toBe(1.0);
    expect(resolveDpConfig()).toEqual(DEFAULT_DP_CONFIG);
  });

  it("merges overrides and rejects invalid parameters", () => {
    expect(resolveDpConfig({ noiseMultiplier: 0.5 })).toEqual({
      ...DEFAULT_DP_CONFIG,
      noiseMultiplier: 0.5,
    });
    expect(() => resolveDpConfig({ maxGradNorm: 0 })).toThrow();
    expect(() => resolveDpConfig({ maxGradNorm: Number.NaN })).toThrow();
    expect(() => resolveDpConfig({ noiseMultiplier: -1 })).toThrow();
  });

  it("clips gradients whose L2 norm exceeds the bound, preserving direction", () => {
    const grad = new Float32Array([3, 4]);
    const before = clipByL2Norm(grad, 1);
    expect(before).toBeCloseTo(5, 5);
    expect(l2Norm(grad)).toBeCloseTo(1, 5);
    expect(grad[0]).toBeCloseTo(0.6, 5);
    expect(grad[1]).toBeCloseTo(0.8, 5);
  });

  it("leaves gradients within the bound untouched", () => {
    const grad = new Float32Array([0.3, 0.4]);
    clipByL2Norm(grad, 1);
    expect(Array.from(grad)).toEqual([
      Math.fround(0.3),
      Math.fround(0.4),
    ]);
  });

  it("handles a zero gradient without producing NaN", () => {
    const grad = new Float32Array(4);
    clipByL2Norm(grad, 1);
    expect(Array.from(grad)).toEqual([0, 0, 0, 0]);
  });

  it("samples standard normals with mean ≈ 0 and variance ≈ 1", () => {
    const random = seededRandom(42);
    const n = 20000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const x = sampleStandardNormal(random);
      sum += x;
      sumSq += x * x;
    }
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    expect(Math.abs(mean)).toBeLessThan(0.05);
    expect(variance).toBeGreaterThan(0.9);
    expect(variance).toBeLessThan(1.1);
  });

  it("adds Gaussian noise with the requested standard deviation", () => {
    const n = 20000;
    const values = new Float32Array(n);
    addGaussianNoise(values, 0.5, seededRandom(7));
    let sumSq = 0;
    for (const v of values) sumSq += v * v;
    expect(Math.sqrt(sumSq / n)).toBeCloseTo(0.5, 1);
  });

  it("is a no-op when the noise std is zero", () => {
    const values = new Float32Array([1, 2, 3]);
    addGaussianNoise(values, 0);
    expect(Array.from(values)).toEqual([1, 2, 3]);
  });

  it("produces uniform values in [0, 1) from the secure source", () => {
    for (let i = 0; i < 100; i++) {
      const u = secureRandom();
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
  });
});

describe("DP-SGD training", () => {
  const features = featuresFromArray(Array(FEATURE_DIM).fill(1));

  it("computes a gradient covering every weight plus the bias", () => {
    const model = zeroModel();
    const { gradient } = computeGradient(model, { features, label: 1 });
    expect(gradient.length).toBe(FEATURE_DIM + 1);
    // pred = 0.5, label = 1 → error = -0.5 on every coordinate
    for (const g of gradient) expect(g).toBeCloseTo(-0.5, 5);
  });

  it("bounds the parameter update by lr * maxGradNorm when noise is off", () => {
    const lr = 0.1;
    const model = zeroModel(lr);
    // Unclipped norm = 0.5 * sqrt(13) ≈ 1.8, so clipping must engage
    dpSgdStep(model, { features, label: 1 }, {
      enabled: true,
      maxGradNorm: 1.0,
      noiseMultiplier: 0,
    });
    const update = new Float32Array([...model.weights, model.bias]);
    expect(l2Norm(update)).toBeCloseTo(lr * 1.0, 5);
  });

  it("differs from plain SGD once noise is applied", () => {
    const plain = zeroModel();
    const noisy = zeroModel();
    sgdStep(plain, { features, label: 1 });
    dpSgdStep(
      noisy,
      { features, label: 1 },
      { enabled: true, maxGradNorm: 10, noiseMultiplier: 1 },
      seededRandom(1),
    );
    expect(Array.from(noisy.weights)).not.toEqual(Array.from(plain.weights));
  });

  it("is reproducible for a fixed random source", () => {
    const dp = { enabled: true, maxGradNorm: 1.0, noiseMultiplier: 1.0 };
    const a = zeroModel();
    const b = zeroModel();
    dpSgdStep(a, { features, label: 1 }, dp, seededRandom(99));
    dpSgdStep(b, { features, label: 1 }, dp, seededRandom(99));
    expect(Array.from(a.weights)).toEqual(Array.from(b.weights));
    expect(a.bias).toBe(b.bias);
  });

  it("matches plain SGD when DP is disabled", () => {
    const plain = zeroModel();
    const viaBatch = zeroModel();
    sgdStep(plain, { features, label: 1 });
    trainBatch(viaBatch, [{ features, label: 1 }], {
      ...DEFAULT_DP_CONFIG,
      enabled: false,
    });
    expect(Array.from(viaBatch.weights)).toEqual(Array.from(plain.weights));
    expect(viaBatch.bias).toBe(plain.bias);
  });

  it("still learns positive engagement under default DP noise", () => {
    const model = zeroModel(0.05);
    const random = seededRandom(2024);
    const before = scoreVenue(model, features);
    const examples = Array.from({ length: 400 }, () => ({
      features,
      label: 1 as const,
    }));
    const steps = trainBatch(model, examples, DEFAULT_DP_CONFIG, random);
    expect(steps).toBe(400);
    expect(scoreVenue(model, features)).toBeGreaterThan(before);
  });
});
