import {
  getCompressionTelemetry,
  type CompressionTelemetrySnapshot,
} from "../../crdt/compressionTelemetry";

export interface LatencySample {
  route?: string;
  durationMs: number;
  timestampMs: number;
  statusCode?: number;
}

export interface LatencyPercentiles {
  count: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

export interface RouteVitalsSummary extends LatencyPercentiles {
  route: string;
}

export interface SystemVitalsSnapshot {
  /** CRDT differential snapshot compression telemetry (#8015) */
  crdtSnapshotCompression?: CompressionTelemetrySnapshot;
  generatedAt: string;
  windowSeconds: number;
  uptimeSeconds: number;
  memoryBytes: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
  };
  latency: {
    overall: LatencyPercentiles;
    byRoute: RouteVitalsSummary[];
  };
}

/**
 * Computes a single percentile `q` (0..100) from a pre-sorted ascending array of numbers
 * using linear interpolation between adjacent ranks (NIST Type-7 / R-7 quantile method).
 */
export function computeSortedQuantile(
  sortedAsc: readonly number[],
  percentile: number,
): number {
  if (sortedAsc.length === 0) {
    return 0;
  }

  if (percentile <= 0) {
    return sortedAsc[0];
  }

  if (percentile >= 100) {
    return sortedAsc[sortedAsc.length - 1];
  }

  if (sortedAsc.length === 1) {
    return sortedAsc[0];
  }

  const index = (percentile / 100) * (sortedAsc.length - 1);
  const lowerIdx = Math.floor(index);
  const upperIdx = Math.ceil(index);
  const weight = index - lowerIdx;

  if (lowerIdx === upperIdx) {
    return sortedAsc[lowerIdx];
  }

  return sortedAsc[lowerIdx] * (1 - weight) + sortedAsc[upperIdx] * weight;
}

function roundMetric(value: number, decimals = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Computes avg, min, max, p50, p95, and p99 latency statistics over an unsorted array of durations (ms).
 */
export function calculateLatencyPercentiles(
  durationsMs: readonly number[],
): LatencyPercentiles {
  const valid = durationsMs.filter((d) => Number.isFinite(d) && d >= 0);

  if (valid.length === 0) {
    return {
      count: 0,
      avgMs: 0,
      minMs: 0,
      maxMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
    };
  }

  const sorted = [...valid].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, val) => acc + val, 0);

  return {
    count: sorted.length,
    avgMs: roundMetric(sum / sorted.length),
    minMs: roundMetric(sorted[0]),
    maxMs: roundMetric(sorted[sorted.length - 1]),
    p50Ms: roundMetric(computeSortedQuantile(sorted, 50)),
    p95Ms: roundMetric(computeSortedQuantile(sorted, 95)),
    p99Ms: roundMetric(computeSortedQuantile(sorted, 99)),
  };
}

/**
 * Bounded rolling telemetry ring buffer storing recent latency samples within a configurable TTL window.
 */
export class RollingTelemetryBuffer {
  private samples: LatencySample[] = [];
  private readonly maxCapacity: number;
  private readonly windowMs: number;

  constructor(options: { maxCapacity?: number; windowSeconds?: number } = {}) {
    this.maxCapacity = options.maxCapacity ?? 10_000;
    this.windowMs = (options.windowSeconds ?? 300) * 1000;
  }

  public get windowSeconds(): number {
    return Math.round(this.windowMs / 1000);
  }

  public record(
    sample: Omit<LatencySample, "timestampMs"> & { timestampMs?: number },
  ): void {
    const now = sample.timestampMs ?? Date.now();
    this.prune(now);

    if (this.samples.length >= this.maxCapacity) {
      this.samples.shift();
    }

    this.samples.push({
      route: sample.route ?? "unknown",
      durationMs: sample.durationMs,
      timestampMs: now,
      statusCode: sample.statusCode,
    });
  }

  public prune(nowMs: number = Date.now()): void {
    const cutoff = nowMs - this.windowMs;
    while (this.samples.length > 0 && this.samples[0].timestampMs < cutoff) {
      this.samples.shift();
    }
  }

  public getActiveSamples(nowMs: number = Date.now()): LatencySample[] {
    this.prune(nowMs);
    return [...this.samples];
  }

  public clear(): void {
    this.samples = [];
  }
}

// Global singleton rolling buffer shared across Next.js route handlers
const globalForVitals = globalThis as unknown as {
  __worksphereVitalsBuffer?: RollingTelemetryBuffer;
};

export const sharedVitalsBuffer =
  globalForVitals.__worksphereVitalsBuffer ??
  new RollingTelemetryBuffer({ maxCapacity: 10_000, windowSeconds: 300 });

if (!globalForVitals.__worksphereVitalsBuffer) {
  globalForVitals.__worksphereVitalsBuffer = sharedVitalsBuffer;
}

/**
 * Builds a complete SystemVitalsSnapshot containing overall and per-route p50, p95, and p99 percentiles.
 */
export function buildSystemVitalsSnapshot(
  buffer: RollingTelemetryBuffer = sharedVitalsBuffer,
  nowMs: number = Date.now(),
): SystemVitalsSnapshot {
  const samples = buffer.getActiveSamples(nowMs);
  const allDurations = samples.map((s) => s.durationMs);
  const overall = calculateLatencyPercentiles(allDurations);

  const groupedByRoute = new Map<string, number[]>();
  for (const sample of samples) {
    const routeKey = sample.route ?? "unknown";
    const bucket = groupedByRoute.get(routeKey);
    if (bucket) {
      bucket.push(sample.durationMs);
    } else {
      groupedByRoute.set(routeKey, [sample.durationMs]);
    }
  }

  const byRoute: RouteVitalsSummary[] = Array.from(groupedByRoute.entries())
    .map(([route, durations]) => ({
      route,
      ...calculateLatencyPercentiles(durations),
    }))
    .sort((a, b) => b.p95Ms - a.p95Ms);

  const mem =
    typeof process !== "undefined" && typeof process.memoryUsage === "function"
      ? process.memoryUsage()
      : { rss: 0, heapTotal: 0, heapUsed: 0, external: 0 };

  const uptimeSeconds =
    typeof process !== "undefined" && typeof process.uptime === "function"
      ? Math.floor(process.uptime())
      : 0;

  return {
    generatedAt: new Date(nowMs).toISOString(),
    windowSeconds: buffer.windowSeconds,
    uptimeSeconds,
    memoryBytes: {
      rss: mem.rss,
      heapTotal: mem.heapTotal,
      heapUsed: mem.heapUsed,
      external: mem.external,
    },
    latency: {
      overall,
      byRoute,
    },
    crdtSnapshotCompression: getCompressionTelemetry(),
  };
}

function escapePrometheusLabel(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/"/g, '\\"');
}

/**
 * Serializes a SystemVitalsSnapshot into Prometheus text exposition format (version 0.0.4),
 * exposing p50, p95, and p99 quantiles alongside sum, count, avg, and process memory gauges.
 */
export function formatSystemVitalsPrometheus(
  snapshot: SystemVitalsSnapshot,
): string {
  const lines: string[] = [];
  const { overall, byRoute } = snapshot.latency;

  lines.push(
    "# HELP worksphere_process_uptime_seconds Process uptime in seconds",
    "# TYPE worksphere_process_uptime_seconds gauge",
    `worksphere_process_uptime_seconds ${snapshot.uptimeSeconds}`,
    "",
    "# HELP worksphere_process_memory_bytes Node.js process memory usage in bytes",
    "# TYPE worksphere_process_memory_bytes gauge",
    `worksphere_process_memory_bytes{type="rss"} ${snapshot.memoryBytes.rss}`,
    `worksphere_process_memory_bytes{type="heap_total"} ${snapshot.memoryBytes.heapTotal}`,
    `worksphere_process_memory_bytes{type="heap_used"} ${snapshot.memoryBytes.heapUsed}`,
    `worksphere_process_memory_bytes{type="external"} ${snapshot.memoryBytes.external}`,
    "",
    "# HELP worksphere_http_request_duration_ms Rolling window HTTP response latency percentiles in milliseconds",
    "# TYPE worksphere_http_request_duration_ms summary",
    `worksphere_http_request_duration_ms{quantile="0.5"} ${overall.p50Ms}`,
    `worksphere_http_request_duration_ms{quantile="0.95"} ${overall.p95Ms}`,
    `worksphere_http_request_duration_ms{quantile="0.99"} ${overall.p99Ms}`,
    `worksphere_http_request_duration_ms_avg ${overall.avgMs}`,
    `worksphere_http_request_duration_ms_max ${overall.maxMs}`,
    `worksphere_http_request_duration_ms_count ${overall.count}`,
  );

  if (byRoute.length > 0) {
    lines.push(
      "",
      "# HELP worksphere_route_request_duration_ms Per-route rolling latency percentiles in milliseconds",
      "# TYPE worksphere_route_request_duration_ms summary",
    );

    for (const r of byRoute) {
      const escapedRoute = escapePrometheusLabel(r.route);
      lines.push(
        `worksphere_route_request_duration_ms{route="${escapedRoute}",quantile="0.5"} ${r.p50Ms}`,
        `worksphere_route_request_duration_ms{route="${escapedRoute}",quantile="0.95"} ${r.p95Ms}`,
        `worksphere_route_request_duration_ms{route="${escapedRoute}",quantile="0.99"} ${r.p99Ms}`,
        `worksphere_route_request_duration_ms_avg{route="${escapedRoute}"} ${r.avgMs}`,
        `worksphere_route_request_duration_ms_count{route="${escapedRoute}"} ${r.count}`,
      );
    }
  }

  const crdt = snapshot.crdtSnapshotCompression;
  if (crdt) {
    lines.push(
      "",
      "# HELP worksphere_crdt_snapshot_compressions_total Number of CRDT snapshot compressions performed",
      "# TYPE worksphere_crdt_snapshot_compressions_total counter",
      `worksphere_crdt_snapshot_compressions_total ${crdt.compressionOps}`,
      "# HELP worksphere_crdt_snapshot_decompressions_total Number of CRDT snapshot decompressions performed",
      "# TYPE worksphere_crdt_snapshot_decompressions_total counter",
      `worksphere_crdt_snapshot_decompressions_total ${crdt.decompressionOps}`,
      "# HELP worksphere_crdt_snapshot_raw_bytes_total Raw (uncompressed) bytes fed into snapshot compression",
      "# TYPE worksphere_crdt_snapshot_raw_bytes_total counter",
      `worksphere_crdt_snapshot_raw_bytes_total ${crdt.rawBytesCompressed}`,
      "# HELP worksphere_crdt_snapshot_compressed_bytes_total Compressed bytes produced by snapshot compression",
      "# TYPE worksphere_crdt_snapshot_compressed_bytes_total counter",
      `worksphere_crdt_snapshot_compressed_bytes_total ${crdt.compressedBytes}`,
      "# HELP worksphere_crdt_snapshot_compression_duration_ms_total Total time spent compressing snapshots in milliseconds",
      "# TYPE worksphere_crdt_snapshot_compression_duration_ms_total counter",
      `worksphere_crdt_snapshot_compression_duration_ms_total ${crdt.compressionMs}`,
      "# HELP worksphere_crdt_snapshot_decompression_duration_ms_total Total time spent decompressing snapshots in milliseconds",
      "# TYPE worksphere_crdt_snapshot_decompression_duration_ms_total counter",
      `worksphere_crdt_snapshot_decompression_duration_ms_total ${crdt.decompressionMs}`,
      "# HELP worksphere_crdt_snapshot_compression_ratio Aggregate compression ratio, 1 - compressed/raw",
      "# TYPE worksphere_crdt_snapshot_compression_ratio gauge",
      `worksphere_crdt_snapshot_compression_ratio ${crdt.compressionRatio}`,
    );
  }

  return `${lines.join("\n")}\n`;
}
