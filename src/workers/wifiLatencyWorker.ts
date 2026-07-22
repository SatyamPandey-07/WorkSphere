/**
 * WiFi Latency Prediction WebWorker
 *
 * Runs ONNX Runtime Web with WASM SIMD execution provider to predict
 * venue WiFi latency and packet loss based on historical telemetry,
 * time of day, weather, and event impact features.
 */

import * as ort from "onnxruntime-web";

ort.env.wasm.numThreads = navigator.hardwareConcurrency || 2;
ort.env.wasm.simd = true;

let session: ort.InferenceSession | null = null;
let isInitialized = false;

async function initModel(): Promise<void> {
  if (isInitialized) return;

  try {
    session = await ort.InferenceSession.create(
      "/models/wifi_latency_quantized.onnx",
      {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      },
    );
    isInitialized = true;
  } catch {
    console.warn(
      "[WiFiLatency] ONNX model not available, using heuristic fallback",
    );
    isInitialized = true;
  }
}

interface VenueTelemetry {
  historicalLatency: number[];
  historicalPacketLoss: number[];
  timeOfDay: number;
  dayOfWeek: number;
  weatherScore: number;
  eventImpact: number;
  currentLoad: number;
}

interface PredictionResult {
  hourlyLatency: number[];
  hourlyPacketLoss: number[];
  peakHours: number[];
  bestTimeSlot: { hour: number; latency: number };
  confidence: number;
}

function heuristicPredict(telemetry: VenueTelemetry): PredictionResult {
  const hourlyLatency: number[] = [];
  const hourlyPacketLoss: number[] = [];
  const peakHours: number[] = [];

  for (let h = 0; h < 24; h++) {
    const baseLatency =
      telemetry.historicalLatency[h] ??
      telemetry.historicalLatency.reduce((a, b) => a + b, 0) /
        Math.max(telemetry.historicalLatency.length, 1);
    const basePacketLoss =
      telemetry.historicalPacketLoss[h] ??
      telemetry.historicalPacketLoss.reduce((a, b) => a + b, 0) /
        Math.max(telemetry.historicalPacketLoss.length, 1);

    // Time-of-day pattern (peak at 10-12, 14-16)
    const hourFactor =
      h >= 10 && h <= 12
        ? 1.3
        : h >= 14 && h <= 16
          ? 1.25
          : h >= 22 || h <= 6
            ? 0.7
            : 1.0;

    const weatherPenalty = telemetry.weatherScore > 0.7 ? 1.2 : 1.0;
    const eventPenalty = telemetry.eventImpact > 0.5 ? 1.3 : 1.0;
    const loadFactor = 1 + telemetry.currentLoad * 0.3;

    const predictedLatency =
      baseLatency * hourFactor * weatherPenalty * eventPenalty * loadFactor;
    const predictedPacketLoss =
      basePacketLoss * hourFactor * weatherPenalty * loadFactor;

    hourlyLatency.push(Math.round(predictedLatency * 10) / 10);
    hourlyPacketLoss.push(
      Math.min(100, Math.round(predictedPacketLoss * 100) / 100),
    );

    if (predictedLatency > baseLatency * 1.15) {
      peakHours.push(h);
    }
  }

  const bestHour = hourlyLatency.indexOf(Math.min(...hourlyLatency));

  return {
    hourlyLatency,
    hourlyPacketLoss,
    peakHours,
    bestTimeSlot: { hour: bestHour, latency: hourlyLatency[bestHour] },
    confidence: 0.75,
  };
}

self.onmessage = async (e: MessageEvent) => {
  const { venueId, telemetry } = e.data as {
    venueId: string;
    telemetry: VenueTelemetry;
  };

  try {
    await initModel();

    let result: PredictionResult;

    if (session) {
      // Build input tensor: 24 hours x 6 features
      const inputArray = new Float32Array(24 * 6);
      for (let h = 0; h < 24; h++) {
        inputArray[h * 6] = telemetry.historicalLatency[h] ?? 0;
        inputArray[h * 6 + 1] = telemetry.historicalPacketLoss[h] ?? 0;
        inputArray[h * 6 + 2] = (h + telemetry.timeOfDay) / 24;
        inputArray[h * 6 + 3] = telemetry.dayOfWeek / 7;
        inputArray[h * 6 + 4] = telemetry.weatherScore;
        inputArray[h * 6 + 5] = telemetry.eventImpact;
      }

      const tensor = new ort.Tensor("float32", inputArray, [1, 24, 6]);
      const outputMap = await session.run({ input: tensor });
      const predictions = Array.from(outputMap.latency.data as Float32Array);
      const packetLossPred = Array.from(
        outputMap.packet_loss.data as Float32Array,
      );

      const peakHours: number[] = [];
      for (let h = 0; h < 24; h++) {
        if (predictions[h] > 50) peakHours.push(h);
      }
      const bestHour = predictions.indexOf(Math.min(...predictions));

      result = {
        hourlyLatency: predictions.map((v) => Math.round(v * 10) / 10),
        hourlyPacketLoss: packetLossPred.map(
          (v) => Math.round(Math.min(100, v) * 100) / 100,
        ),
        peakHours,
        bestTimeSlot: { hour: bestHour, latency: predictions[bestHour] },
        confidence: 0.92,
      };
    } else {
      result = heuristicPredict(telemetry);
    }

    self.postMessage({
      venueId,
      predictions: result,
      success: true,
    });
  } catch {
    self.postMessage({
      venueId,
      predictions: heuristicPredict(telemetry),
      success: true,
      fallback: true,
    });
  }
};
