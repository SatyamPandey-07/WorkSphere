/**
 * Telemetry Pipeline, Metric Producers, and Anomaly Detection Type Definitions.
 */

export interface TelemetryRecord {
  venueId: string;
  download: number;
  upload: number;
  latency: number;
  crowdLevel: string;
  timestamp: string;
}

export type PerfSample = {
  route: string;
  durationMs: number;
  region: string;
  timestamp: number;
};

export interface FpsTelemetryData {
  fps: number;
  frameTimeMs: number;
  raymarchSteps: number;
  timestamp: number;
}

export type PerformanceSummary = {
  generatedAt: string;
  overview: {
    totalRequests: number;
    slowRequests: number;
    avgMs: number;
    p95Ms: number;
    slowThresholdMs: number;
  };
  latencyTrend: Array<{
    hour: string;
    avgMs: number;
    p95Ms: number;
    requestCount: number;
  }>;
  recentSamples: Array<{
    route: string;
    durationMs: number;
    region: string;
    timestamp: number;
  }>;
  regionBreakdown: Array<{ region: string; count: number; avgMs: number }>;
  routeBreakdown: Array<{
    route: string;
    avgMs: number;
    p95Ms: number;
    requestCount: number;
  }>;
};

export type DbQuerySample = {
  durationMs: number;
  timestamp: number;
};

// ─── Anomaly Detection Types ──────────────────────────────────────────────────

export type TelemetryMetricType =
  | "noise_db"
  | "occupancy_percent"
  | "wifi_latency_ms"
  | "generic";

export type AnomalySeverity =
  | "normal"
  | "mild_deviation"
  | "critical_surge"
  | "sensor_fault";

export interface TelemetryPoint {
  value: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface AnomalyDetectionConfig {
  windowSize: number;
  minSamplesForDetection: number;
  modifiedZScoreThreshold: number;
  emaAlpha: number;
  volatilityBandMultiplier: number;
  maxRateOfChangePerSec?: number;
  physicalBounds?: {
    min?: number;
    max?: number;
  };
}

export interface AnomalyResult {
  isAnomaly: boolean;
  severity: AnomalySeverity;
  value: number;
  timestamp: number;
  zScore: number | null;
  ema: number | null;
  baselineMedian: number | null;
  mad: number | null;
  rateOfChange: number | null;
  reason?: string;
}

export interface BaselineStats {
  sampleCount: number;
  median: number | null;
  mad: number | null;
  ema: number | null;
  mean: number | null;
  stdDev: number | null;
  min: number | null;
  max: number | null;
}

// ─── EMA & Smoother Types ─────────────────────────────────────────────────────

export interface TelemetrySmootherOptions {
  /** Smoothing factor alpha in range [0.1, 0.4]. Defaults to 0.25. */
  alpha?: number;
  /** Number of historical readings for 3-sigma calculation. Defaults to 10. */
  windowSize?: number;
  /** Sigma multiplier threshold for outlier detection. Defaults to 3. */
  sigmaThreshold?: number;
}

export interface SmoothedTelemetryResult {
  smoothed: number;
  raw: number;
  isOutlier: boolean;
  history: number[];
}

// ─── Pipeline Types ───────────────────────────────────────────────────────────

export type TelemetryBatchHandler<T> = (batch: T[]) => Promise<void>;
export type TelemetrySubscriber<T> = (event: T) => void | Promise<void>;
export type TelemetryMiddleware<T> = (event: T) => T | null | Promise<T | null>;

export interface TelemetryPipelineOptions<T> {
  name?: string;
  batchSize?: number;
  flushIntervalMs?: number;
  maxBufferSize?: number;
  batchHandler?: TelemetryBatchHandler<T>;
}

// ─── Route Latency Heatmap Types ──────────────────────────────────────────────

export type LatencySeverity = "optimal" | "normal" | "amber" | "red" | "idle";

export interface RouteHeatmapCell {
  bucketIndex: number;
  timeLabel: string;
  timestamp: number;
  route: string;
  count: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  status: LatencySeverity;
}

export interface RouteHeatmapRow {
  route: string;
  displayName: string;
  category: "api" | "auth" | "admin" | "db" | "ai" | "telemetry" | "wallet" | "service";
  totalRequests: number;
  overallAvgMs: number;
  overallP95Ms: number;
  isSlowPath: boolean;
  severity: "optimal" | "normal" | "amber" | "red";
  cells: RouteHeatmapCell[];
}

export interface RouteLatencyHeatmapData {
  generatedAt: string;
  range: "1h" | "24h" | "7d";
  bucketIntervalMinutes: number;
  timeBuckets: Array<{ index: number; label: string; timestamp: number }>;
  routes: RouteHeatmapRow[];
  summary: {
    totalEndpoints: number;
    slowEndpointsCount: number;
    criticalEndpointsCount: number;
    systemP95Ms: number;
    systemAvgMs: number;
    totalRequests: number;
  };
}

