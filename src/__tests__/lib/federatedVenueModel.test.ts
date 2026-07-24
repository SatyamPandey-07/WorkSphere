import {
  createInitialModel,
  featuresFromArray,
  scoreVenue,
  sgdStep,
  sigmoid,
  trainBatch,
} from "@/lib/federated/linearVenueModel";
import { FEATURE_DIM } from "@/lib/federated/types";
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
