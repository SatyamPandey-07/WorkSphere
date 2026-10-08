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

function sanitizeNumber(val: unknown, fallback: number): number {
  return typeof val === "number" && Number.isFinite(val) ? val : fallback;
}

function heuristicPredict(telemetry: VenueTelemetry): PredictionResult {
  const hourlyLatency: number[] = [];
  const hourlyPacketLoss: number[] = [];
  const peakHours: number[] = [];

  const rawLatencies = (telemetry.historicalLatency || []).filter((v) => typeof v === "number" && Number.isFinite(v));
  const rawPacketLoss = (telemetry.historicalPacketLoss || []).filter((v) => typeof v === "number" && Number.isFinite(v));

  const avgLatency =
    rawLatencies.length > 0
      ? rawLatencies.reduce((a, b) => a + b, 0) / rawLatencies.length
      : 25;
  const avgPacketLoss =
    rawPacketLoss.length > 0
      ? rawPacketLoss.reduce((a, b) => a + b, 0) / rawPacketLoss.length
      : 1.0;

  const weatherScore = sanitizeNumber(telemetry.weatherScore, 0.3);
  const eventImpact = sanitizeNumber(telemetry.eventImpact, 0.1);
  const currentLoad = sanitizeNumber(telemetry.currentLoad, 0.4);

  for (let h = 0; h < 24; h++) {
    const baseLatency = sanitizeNumber(telemetry.historicalLatency?.[h], avgLatency);
    const basePacketLoss = sanitizeNumber(telemetry.historicalPacketLoss?.[h], avgPacketLoss);

    // Time-of-day pattern (peak at 10-12, 14-16)
    const hourFactor =
      h >= 10 && h <= 12
        ? 1.3
        : h >= 14 && h <= 16
          ? 1.25
          : h >= 22 || h <= 6
            ? 0.7
            : 1.0;

    const weatherPenalty = weatherScore > 0.7 ? 1.2 : 1.0;
    const eventPenalty = eventImpact > 0.5 ? 1.3 : 1.0;
    const loadFactor = 1 + currentLoad * 0.3;

    const predictedLatency = Math.max(
      1,
      baseLatency * hourFactor * weatherPenalty * eventPenalty * loadFactor,
    );
    const predictedPacketLoss = Math.max(
      0,
      basePacketLoss * hourFactor * weatherPenalty * loadFactor,
    );

    hourlyLatency.push(Math.round(predictedLatency * 10) / 10);
    hourlyPacketLoss.push(
      Math.min(100, Math.round(predictedPacketLoss * 100) / 100),
    );

    if (predictedLatency > baseLatency * 1.15) {
      peakHours.push(h);
    }
  }

  const minLatency = Math.min(...hourlyLatency);
  const bestHour = Math.max(0, hourlyLatency.indexOf(minLatency));

  return {
    hourlyLatency,
    hourlyPacketLoss,
    peakHours,
    bestTimeSlot: {
      hour: bestHour,
      latency: hourlyLatency[bestHour] ?? avgLatency,
    },
    confidence: 0.75,
  };
}

const activeTimers = new Set<
  ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>
>();

export function clearAllPingTimers(): void {
  for (const timer of activeTimers) {
    clearInterval(timer);
    clearTimeout(timer);
  }
  activeTimers.clear();
}

self.onmessage = async (e: MessageEvent) => {
  const data = e.data;
  if (!data) return;

  // Handle explicit worker termination and resource release
  if (
    data.type === "TERMINATE" ||
    data.type === "STOP" ||
    data.type === "CANCEL"
  ) {
    clearAllPingTimers();
    session = null;
    isInitialized = false;
    try {
      self.close();
    } catch {
      // Ignore if close is unavailable in test environment
    }
    return;
  }

  const venueId = data.venueId;
  const telemetry = data.telemetry as VenueTelemetry;
  if (!telemetry) return;

  try {
    await initModel();

    let result: PredictionResult;

    if (session) {
      // Build input tensor: 24 hours x 6 features
      const inputArray = new Float32Array(24 * 6);
      for (let h = 0; h < 24; h++) {
        inputArray[h * 6] = sanitizeNumber(telemetry.historicalLatency?.[h], 25);
        inputArray[h * 6 + 1] = sanitizeNumber(telemetry.historicalPacketLoss?.[h], 1.0);
        inputArray[h * 6 + 2] = (h + sanitizeNumber(telemetry.timeOfDay, 12)) / 24;
        inputArray[h * 6 + 3] = sanitizeNumber(telemetry.dayOfWeek, 1) / 7;
        inputArray[h * 6 + 4] = sanitizeNumber(telemetry.weatherScore, 0.3);
        inputArray[h * 6 + 5] = sanitizeNumber(telemetry.eventImpact, 0.1);
      }

      const tensor = new ort.Tensor("float32", inputArray, [1, 24, 6]);
      const outputMap = await session.run({ input: tensor });
      const predictions = Array.from(outputMap.latency.data as Float32Array);
      const packetLossPred = Array.from(
        outputMap.packet_loss.data as Float32Array,
      );

      const hasInvalidNumbers =
        predictions.some((v) => !Number.isFinite(v)) ||
        packetLossPred.some((v) => !Number.isFinite(v));

      if (hasInvalidNumbers) {
        result = heuristicPredict(telemetry);
      } else {
        const peakHours: number[] = [];
        for (let h = 0; h < 24; h++) {
          if (predictions[h] > 50) peakHours.push(h);
        }
        const minLatency = Math.min(...predictions);
        const bestHour = Math.max(0, predictions.indexOf(minLatency));

        result = {
          hourlyLatency: predictions.map((v) => Math.round(Math.max(1, v) * 10) / 10),
          hourlyPacketLoss: packetLossPred.map(
            (v) => Math.round(Math.min(100, Math.max(0, v)) * 100) / 100,
          ),
          peakHours,
          bestTimeSlot: { hour: bestHour, latency: predictions[bestHour] ?? 25 },
          confidence: 0.92,
        };
      }
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
