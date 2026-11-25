export type WebGpuLimitBucket =
  | "small"
  | "medium"
  | "large"
  | "very-large"
  | "unavailable";

export interface WebGpuCapabilityReport {
  version: 1;
  adapterAvailable: boolean;
  features: {
    timestampQuery: boolean;
    shaderF16: boolean;
    subgroups: boolean;
  };
  limits: {
    bufferSize: WebGpuLimitBucket;
    workgroupSizeX: WebGpuLimitBucket;
    workgroupInvocations: WebGpuLimitBucket;
    workgroupsPerDimension: WebGpuLimitBucket;
  };
}

type AdapterLike = {
  features?: { has: (feature: string) => boolean };
  limits?: Record<string, unknown>;
};

type GpuNavigatorLike = Navigator & {
  gpu?: {
    requestAdapter: (options?: { powerPreference?: "low-power" | "high-performance" }) => Promise<AdapterLike | null>;
  };
};

function bucket(value: unknown, thresholds: [number, number, number]): WebGpuLimitBucket {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "unavailable";
  }
  if (value <= thresholds[0]) return "small";
  if (value <= thresholds[1]) return "medium";
  if (value <= thresholds[2]) return "large";
  return "very-large";
}

/**
 * Collects coarse WebGPU capability buckets without reading adapter vendor,
 * device, architecture, driver, or exact numeric limits. The result is suitable
 * for privacy-limited operational diagnostics rather than device fingerprinting.
 */
export async function collectWebGpuCapabilityReport(): Promise<WebGpuCapabilityReport> {
  const unsupported: WebGpuCapabilityReport = {
    version: 1,
    adapterAvailable: false,
    features: {
      timestampQuery: false,
      shaderF16: false,
      subgroups: false,
    },
    limits: {
      bufferSize: "unavailable",
      workgroupSizeX: "unavailable",
      workgroupInvocations: "unavailable",
      workgroupsPerDimension: "unavailable",
    },
  };

  if (typeof navigator === "undefined") return unsupported;
  const gpu = (navigator as GpuNavigatorLike).gpu;
  if (!gpu || typeof gpu.requestAdapter !== "function") return unsupported;

  try {
    const adapter = await gpu.requestAdapter({ powerPreference: "low-power" });
    if (!adapter) return unsupported;

    const features = adapter.features;
    const limits = adapter.limits ?? {};
    return {
      version: 1,
      adapterAvailable: true,
      features: {
        timestampQuery: Boolean(features?.has("timestamp-query")),
        shaderF16: Boolean(features?.has("shader-f16")),
        subgroups: Boolean(features?.has("subgroups")),
      },
      limits: {
        bufferSize: bucket(limits.maxBufferSize, [
          256 * 1024 * 1024,
          512 * 1024 * 1024,
          1024 * 1024 * 1024,
        ]),
        workgroupSizeX: bucket(limits.maxComputeWorkgroupSizeX, [64, 128, 256]),
        workgroupInvocations: bucket(
          limits.maxComputeInvocationsPerWorkgroup,
          [128, 256, 512],
        ),
        workgroupsPerDimension: bucket(
          limits.maxComputeWorkgroupsPerDimension,
          [32_768, 65_535, 131_072],
        ),
      },
    };
  } catch {
    return unsupported;
  }
}

/** Strictly accepts only the allowlisted, coarse capability schema from clients. */
export function normalizeWebGpuCapabilityReport(
  input: unknown,
): WebGpuCapabilityReport | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  const features = value.features;
  const limits = value.limits;
  if (
    value.version !== 1 ||
    typeof value.adapterAvailable !== "boolean" ||
    !features ||
    typeof features !== "object" ||
    !limits ||
    typeof limits !== "object"
  ) {
    return null;
  }

  const rawFeatures = features as Record<string, unknown>;
  const rawLimits = limits as Record<string, unknown>;
  const featureKeys = ["timestampQuery", "shaderF16", "subgroups"] as const;
  const limitKeys = [
    "bufferSize",
    "workgroupSizeX",
    "workgroupInvocations",
    "workgroupsPerDimension",
  ] as const;
  const allowedBuckets = new Set([
    "small",
    "medium",
    "large",
    "very-large",
    "unavailable",
  ]);

  if (featureKeys.some((key) => typeof rawFeatures[key] !== "boolean")) {
    return null;
  }
  if (
    limitKeys.some(
      (key) =>
        typeof rawLimits[key] !== "string" ||
        !allowedBuckets.has(rawLimits[key] as string),
    )
  ) {
    return null;
  }

  const adapterAvailable = value.adapterAvailable;
  return {
    version: 1,
    adapterAvailable,
    features: {
      timestampQuery: adapterAvailable && rawFeatures.timestampQuery === true,
      shaderF16: adapterAvailable && rawFeatures.shaderF16 === true,
      subgroups: adapterAvailable && rawFeatures.subgroups === true,
    },
    limits: {
      bufferSize: adapterAvailable
        ? (rawLimits.bufferSize as WebGpuLimitBucket)
        : "unavailable",
      workgroupSizeX: adapterAvailable
        ? (rawLimits.workgroupSizeX as WebGpuLimitBucket)
        : "unavailable",
      workgroupInvocations: adapterAvailable
        ? (rawLimits.workgroupInvocations as WebGpuLimitBucket)
        : "unavailable",
      workgroupsPerDimension: adapterAvailable
        ? (rawLimits.workgroupsPerDimension as WebGpuLimitBucket)
        : "unavailable",
    },
  };
}

export interface WebGpuCapabilitySummary {
  sampleCount: number;
  adaptersAvailable: number;
  featureSupport: {
    timestampQuery: number;
    shaderF16: number;
    subgroups: number;
  };
  latestReportAt: string | null;
}

export function summarizeWebGpuCapabilityReports(
  rows: Array<{ details: string | null; createdAt: Date | string }>,
): WebGpuCapabilitySummary {
  const reports: WebGpuCapabilityReport[] = [];
  let latest: string | null = null;

  for (const row of rows) {
    const timestamp = new Date(row.createdAt).toISOString();
    if (!latest || timestamp > latest) latest = timestamp;
    if (!row.details) continue;
    try {
      const normalized = normalizeWebGpuCapabilityReport(JSON.parse(row.details));
      if (normalized) reports.push(normalized);
    } catch {
      // Ignore malformed legacy audit rows.
    }
  }

  return {
    sampleCount: reports.length,
    adaptersAvailable: reports.filter((report) => report.adapterAvailable).length,
    featureSupport: {
      timestampQuery: reports.filter((report) => report.features.timestampQuery).length,
      shaderF16: reports.filter((report) => report.features.shaderF16).length,
      subgroups: reports.filter((report) => report.features.subgroups).length,
    },
    latestReportAt: latest,
  };
}
