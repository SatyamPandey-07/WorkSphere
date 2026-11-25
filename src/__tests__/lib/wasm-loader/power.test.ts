import {
  createWasmMemoryTelemetry,
  WASM_PAGE_SIZE_BYTES,
} from '@/lib/wasm-loader/power';

describe('WASM Linear Memory Pressure Telemetry (power.ts)', () => {
  it('reports allocated byte pages, buffer utilization ratio, and growth deltas', () => {
    const buffer = new ArrayBuffer(WASM_PAGE_SIZE_BYTES * 4);
    const monitor = createWasmMemoryTelemetry({ nowFn: () => 5_000 });

    const initial = monitor.attachMemory({ buffer }, WASM_PAGE_SIZE_BYTES * 2);
    expect(initial.allocatedBytes).toBe(WASM_PAGE_SIZE_BYTES * 4);
    expect(initial.pageCount).toBe(4);
    expect(initial.growthDeltaPages).toBe(4);
    expect(initial.utilizationRatio).toBe(0.5);
    expect(initial.utilizationPercent).toBe(50);
    expect(initial.highPressureWarning).toBe(false);

    const grown = monitor.recordAllocation(WASM_PAGE_SIZE_BYTES);
    expect(grown.usedBytes).toBe(WASM_PAGE_SIZE_BYTES * 3);
    expect(grown.utilizationRatio).toBe(0.75);
    expect(grown.growthDeltaBytes).toBe(0);
  });

  it('emits warning callback above 80% memory threshold and resets cleanly on cleanup', () => {
    const warnings: number[] = [];
    const buffer = new ArrayBuffer(WASM_PAGE_SIZE_BYTES * 10);
    const monitor = createWasmMemoryTelemetry({
      warningThreshold: 0.8,
      onMemoryWarning: (m) => warnings.push(m.utilizationPercent),
    });

    monitor.attachMemory({ buffer }, WASM_PAGE_SIZE_BYTES * 7);
    expect(warnings).toHaveLength(0);

    const spiked = monitor.setUsedBytes(Math.floor(WASM_PAGE_SIZE_BYTES * 8.5));
    expect(spiked.highPressureWarning).toBe(true);
    expect(warnings).toEqual([85]);

    monitor.setUsedBytes(Math.floor(WASM_PAGE_SIZE_BYTES * 9));
    expect(warnings).toHaveLength(1);

    monitor.reset();
    const afterReset = monitor.getMetrics();
    expect(afterReset.allocatedBytes).toBe(0);
    expect(afterReset.pageCount).toBe(0);
    expect(afterReset.usedBytes).toBe(0);
    expect(afterReset.utilizationRatio).toBe(0);
    expect(afterReset.highPressureWarning).toBe(false);
  });
});
