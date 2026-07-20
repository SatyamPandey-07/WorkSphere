import * as ort from "onnxruntime-web";

// Configure WebAssembly execution provider with multithreading
ort.env.wasm.numThreads = 2;
ort.env.wasm.simd = true;

let session: ort.InferenceSession | null = null;

// Initialize ONNX Session with quantized WASM model (< 1.5MB)
async function initSession() {
  if (!session) {
    session = await ort.InferenceSession.create(
      "/models/foot_traffic_quantized.onnx",
      {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      }
    );
  }
}

self.onmessage = async (e: MessageEvent) => {
  const { venueId, historicalTelemetry, weatherScore, eventImpact } = e.data;

  try {
    await initSession();
    if (!session) throw new Error("ONNX Session failed to initialize.");

    // Prepare input tensor (24 hours x 3 features: telemetry, weather, events)
    const inputArray = new Float32Array(24 * 3);
    for (let h = 0; h < 24; h++) {
      inputArray[h * 3] = historicalTelemetry[h] ?? 0.5;
      inputArray[h * 3 + 1] = weatherScore;
      inputArray[h * 3 + 2] = eventImpact;
    }

    const tensor = new ort.Tensor("float32", inputArray, [1, 24, 3]);
    const feeds = { input: tensor };

    // Run WASM inference
    const outputMap = await session.run(feeds);
    const predictions = Array.from(outputMap.output.data as Float32Array);

    self.postMessage({ venueId, predictions, success: true });
  } catch (error) {
    self.postMessage({
      venueId,
      error: (error as Error).message,
      success: false,
    });
  }
};