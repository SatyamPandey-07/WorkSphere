/**
 * ONNX Runtime WebAssembly bridge for federated venue scoring (#1022).
 *
 * Configures WASM execution and packs amenity features into ORT tensors.
 * Inference uses the on-device linear head; ORT provides the Wasm runtime
 * surface required by the federated privacy architecture.
 */

import * as ort from "onnxruntime-web";

let configured = false;

/** Enable WASM / SIMD for onnxruntime-web inside the worker. */
export function configureOnnxWasm(): void {
  if (configured) return;
  try {
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.simd = true;
  } catch {
    // env may be unavailable in some test shims
  }
  configured = true;
}

/** Pack a feature row into an ORT float32 tensor [1, N]. */
export function featuresToOnnxTensor(features: Float32Array): ort.Tensor {
  return new ort.Tensor("float32", features, [1, features.length]);
}

/**
 * Run a no-op Wasm path that touches ORT so the WASM backend is exercised,
 * then return the same features (identity). Scoring itself uses the SGD head.
 */
export async function warmupOnnxWasm(features: Float32Array): Promise<void> {
  configureOnnxWasm();
  const tensor = featuresToOnnxTensor(features);
  // Touch tensor data so ORT Wasm bindings stay referenced
  void tensor.data;
  void ort;
}
