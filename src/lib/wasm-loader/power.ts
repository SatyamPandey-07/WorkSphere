export const WASM_PAGE_SIZE_BYTES = 65_536;
export const DEFAULT_MEMORY_WARNING_THRESHOLD = 0.8;
export interface WasmMemoryLike { buffer: ArrayBufferLike; grow?: (deltaPages: number) => number; }
export interface WasmMemoryPressureMetrics { allocatedBytes: number; pageCount: number; usedBytes: number; utilizationRatio: number; utilizationPercent: number; growthDeltaBytes: number; growthDeltaPages: number; highPressureWarning: boolean; timestampMs: number; }
export interface WasmMemoryTelemetryOptions { warningThreshold?: number; nowFn?: () => number; onMemoryWarning?: (metrics: WasmMemoryPressureMetrics) => void; }
export class WasmMemoryTelemetryMonitor {
  private readonly warningThreshold: number; private readonly nowFn: () => number; private readonly onMemoryWarning?: (metrics: WasmMemoryPressureMetrics) => void;
  private memory: WasmMemoryLike | null = null; private trackedUsedBytes = 0; private lastAllocatedBytes = 0; private lastPageCount = 0; private warningEmittedForCurrentSpike = false; private latestMetrics: WasmMemoryPressureMetrics;
  constructor(options: WasmMemoryTelemetryOptions = {}) {
    const t = options.warningThreshold; this.warningThreshold = typeof t === 'number' && Number.isFinite(t) && t > 0 && t <= 1 ? t : DEFAULT_MEMORY_WARNING_THRESHOLD;
    this.nowFn = options.nowFn ?? Date.now; this.onMemoryWarning = options.onMemoryWarning; this.latestMetrics = this.empty(this.nowFn());
  }
  private empty(timestampMs: number): WasmMemoryPressureMetrics { return { allocatedBytes: 0, pageCount: 0, usedBytes: 0, utilizationRatio: 0, utilizationPercent: 0, growthDeltaBytes: 0, growthDeltaPages: 0, highPressureWarning: false, timestampMs }; }
  public attachMemory(memory: WasmMemoryLike | null | undefined, initialUsedBytes = 0): WasmMemoryPressureMetrics {
    this.memory = memory ?? null; this.lastAllocatedBytes = 0; this.lastPageCount = 0; this.warningEmittedForCurrentSpike = false;
    const alloc = this.memory?.buffer?.byteLength ?? 0;
    this.trackedUsedBytes = typeof initialUsedBytes === 'number' && Number.isFinite(initialUsedBytes) && initialUsedBytes >= 0 ? Math.min(alloc, Math.floor(initialUsedBytes)) : 0;
    return this.sample(this.trackedUsedBytes);
  }
  public recordAllocation(deltaBytes: number): WasmMemoryPressureMetrics { return this.sample(Math.max(0, this.trackedUsedBytes + (typeof deltaBytes === 'number' && Number.isFinite(deltaBytes) ? deltaBytes : 0))); }
  public setUsedBytes(usedBytes: number): WasmMemoryPressureMetrics { return this.sample(typeof usedBytes === 'number' && Number.isFinite(usedBytes) && usedBytes >= 0 ? Math.floor(usedBytes) : 0); }
  public sample(explicitUsedBytes?: number): WasmMemoryPressureMetrics {
    const nowMs = this.nowFn(); const allocatedBytes = Math.max(0, this.memory?.buffer?.byteLength ?? 0); const pageCount = Math.floor(allocatedBytes / WASM_PAGE_SIZE_BYTES);
    const clampedUsed = allocatedBytes > 0 ? Math.min(allocatedBytes, Math.max(0, Math.floor(explicitUsedBytes ?? this.trackedUsedBytes))) : 0;
    this.trackedUsedBytes = clampedUsed;
    const growthDeltaBytes = allocatedBytes - this.lastAllocatedBytes; const growthDeltaPages = pageCount - this.lastPageCount;
    this.lastAllocatedBytes = allocatedBytes; this.lastPageCount = pageCount;
    const utilizationRatio = allocatedBytes > 0 ? Math.min(1, Math.max(0, clampedUsed / allocatedBytes)) : 0;
    const utilizationPercent = Math.round(utilizationRatio * 1000) / 10;
    const highPressureWarning = allocatedBytes > 0 && utilizationRatio >= this.warningThreshold;
    if (highPressureWarning && !this.warningEmittedForCurrentSpike) { this.warningEmittedForCurrentSpike = true; this.onMemoryWarning?.({ allocatedBytes, pageCount, usedBytes: clampedUsed, utilizationRatio, utilizationPercent, growthDeltaBytes, growthDeltaPages, highPressureWarning: true, timestampMs: nowMs }); }
    else if (!highPressureWarning) this.warningEmittedForCurrentSpike = false;
    this.latestMetrics = { allocatedBytes, pageCount, usedBytes: clampedUsed, utilizationRatio, utilizationPercent, growthDeltaBytes, growthDeltaPages, highPressureWarning, timestampMs: nowMs };
    return { ...this.latestMetrics };
  }
  public getMetrics(): WasmMemoryPressureMetrics { return { ...this.latestMetrics }; }
  public reset(): void { this.memory = null; this.trackedUsedBytes = 0; this.lastAllocatedBytes = 0; this.lastPageCount = 0; this.warningEmittedForCurrentSpike = false; this.latestMetrics = this.empty(this.nowFn()); }
}
export function createWasmMemoryTelemetry(options?: WasmMemoryTelemetryOptions): WasmMemoryTelemetryMonitor { return new WasmMemoryTelemetryMonitor(options); }
