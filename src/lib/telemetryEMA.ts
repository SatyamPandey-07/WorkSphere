"use client";

export {
  calculateEMA,
  isOutlier3Sigma,
  computeMeanAndStdDev,
  TelemetrySmoother,
  useSmoothTelemetry,
  type TelemetrySmootherOptions,
  type SmoothedTelemetryResult,
} from "./telemetry";
