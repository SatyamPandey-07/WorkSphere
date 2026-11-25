export const WASM_PAGE_SIZE_BYTES = 65_536;
export const DEFAULT_MEMORY_WARNING_THRESHOLD = 0.8;

export interface WasmMemoryLike {
  buffer: ArrayBufferLike;
  grow?: (deltaPages: number) => number;
}

export interface WasmMemoryPressureMetrics {
  allocatedBytes: number;
  pageCount: number;
  usedBytes: number;
  utilizationRatio: number;
  utilizationPercent: number;
  growthDeltaBytes: number;
  growthDeltaPages: number;
  highPressureWarning: boolean;
  timestampMs: number;
}

export interface WasmMemoryTelemetryOptions {
  warningThreshold?: number;
  nowFn?: () => number;
  onMemoryWarning?: (metrics: WasmMemoryPressureMetrics) => void;
}

export class WasmMemoryTelemetryMonitor {
  private readonly warningThreshold: number;
  private readonly nowFn: () => number;
  private readonly onMemoryWarning?: (metrics: WasmMemoryPressureMetrics) => void;

  private memory: WasmMemoryLike | null = null;
  private trackedUsedBytes = 0;
  private lastAllocatedBytes = 0;
  private lastPageCount = 0;
  private warningEmittedForCurrentSpike = false;
  private latestMetrics: WasmMemoryPressureMetrics;

  constructor(options: WasmMemoryTelemetryOptions = {}) {
    const rawThreshold = options.warningThreshold;
    this.warningThreshold =
      typeof rawThreshold === 'number' &&
      Number.isFinite(rawThreshold) &&
      rawThreshold > 0 &&
      rawThreshold <= 1
        ? rawThreshold
        : DEFAULT_MEMORY_WARNING_THRESHOLD;
    this.nowFn = options.nowFn ?? Date.now;
    this.onMemoryWarning = options.onMemoryWarning;
    this.latestMetrics = this.buildEmptyMetrics(this.nowFn());
  }

  private buildEmptyMetrics(timestampMs: number): WasmMemoryPressureMetrics {
    return {
      allocatedBytes: 0,
      pageCount: 0,
      usedBytes: 0,
      utilizationRatio: 0,
      utilizationPercent: 0,
      growthDeltaBytes: 0,
      growthDeltaPages: 0,
      highPressureWarning: false,
      timestampMs,
    };
  }

  public attachMemory(
    memory: WasmMemoryLike | null | undefined,
    initialUsedBytes = 0
  ): WasmMemoryPressureMetrics {
    this.memory = memory ?? null;
    this.lastAllocatedBytes = 0;
    this.lastPageCount = 0;
    this.warningEmittedForCurrentSpike = false;

    const allocatedBytes = this.memory?.buffer?.byteLength ?? 0;
    const safeUsed =
      typeof initialUsedBytes === 'number' &&
      Number.isFinite(initialUsedBytes) &&
      initialUsedBytes >= 0
        ? Math.min(allocatedBytes, Math.floor(initialUsedBytes))
        : 0;

    this.trackedUsedBytes = safeUsed;
    return this.sample(safeUsed);
  }

  public recordAllocation(deltaBytes: number): WasmMemoryPressureMetrics {
    const safeDelta =
      typeof deltaBytes === 'number' && Number.isFinite(deltaBytes)
        ? deltaBytes
        : 0;
    const nextUsed = Math.max(0, this.trackedUsedBytes + safeDelta);
    return this.sample(nextUsed);
  }

  public setUsedBytes(usedBytes: number): WasmMemoryPressureMetrics {
    const safeUsed =
      typeof usedBytes === 'number' &&
      Number.isFinite(usedBytes) &&
      usedBytes >= 0
        ? Math.floor(usedBytes)
        : 0;
    return this.sample(safeUsed);
  }

  public sample(explicitUsedBytes?: number): WasmMemoryPressureMetrics {
    const nowMs = this.nowFn();
    const allocatedBytes = Math.max(0, this.memory?.buffer?.byteLength ?? 0);
    const pageCount = Math.floor(allocatedBytes / WASM_PAGE_SIZE_BYTES);

    const candidateUsed =
      explicitUsedBytes !== undefined
        ? Math.max(0, Math.floor(explicitUsedBytes))
        : this.trackedUsedBytes;

    const clampedUsed =
      allocatedBytes > 0 ? Math.min(allocatedBytes, candidateUsed) : 0;
    this.trackedUsedBytes = clampedUsed;

    const growthDeltaBytes = allocatedBytes - this.lastAllocatedBytes;
    const growthDeltaPages = pageCount - this.lastPageCount;
    this.lastAllocatedBytes = allocatedBytes;
    this.lastPageCount = pageCount;

    const utilizationRatio =
      allocatedBytes > 0
        ? Math.min(1, Math.max(0, clampedUsed / allocatedBytes))
        : 0;
    const utilizationPercent = Math.round(utilizationRatio * 1000) / 10;
    const highPressureWarning =
      allocatedBytes > 0 && utilizationRatio >= this.warningThreshold;

    if (highPressureWarning && !this.warningEmittedForCurrentSpike) {
      this.warningEmittedForCurrentSpike = true;
      this.onMemoryWarning?.({
        allocatedBytes,
        pageCount,
        usedBytes: clampedUsed,
        utilizationRatio,
        utilizationPercent,
        growthDeltaBytes,
        growthDeltaPages,
        highPressureWarning: true,
        timestampMs: nowMs,
      });
    } else if (!highPressureWarning) {
      this.warningEmittedForCurrentSpike = false;
    }

    this.latestMetrics = {
      allocatedBytes,
      pageCount,
      usedBytes: clampedUsed,
      utilizationRatio,
      utilizationPercent,
      growthDeltaBytes,
      growthDeltaPages,
      highPressureWarning,
      timestampMs: nowMs,
    };

    return { ...this.latestMetrics };
  }

  public getMetrics(): WasmMemoryPressureMetrics {
    return { ...this.latestMetrics };
  }

  public reset(): void {
    this.memory = null;
    this.trackedUsedBytes = 0;
    this.lastAllocatedBytes = 0;
    this.lastPageCount = 0;
    this.warningEmittedForCurrentSpike = false;
    this.latestMetrics = this.buildEmptyMetrics(this.nowFn());
  }
}

export function createWasmMemoryTelemetry(
  options?: WasmMemoryTelemetryOptions
): WasmMemoryTelemetryMonitor {
  return new WasmMemoryTelemetryMonitor(options);
}
