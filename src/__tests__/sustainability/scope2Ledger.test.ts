import {
  EmissionFactorRegistry,
  Scope2ElectricityLedger,
  integratePowerSamplesKwh,
  SCOPE2_CALCULATION_METHOD_VERSION,
} from "@/lib/sustainability/scope2Ledger";

describe("Scope2ElectricityLedger (#10687)", () => {
  it("integrates constant power over elapsed duration into exact kWh", () => {
    const t0 = Date.UTC(2026, 0, 1, 10, 0, 0);
    // 10 kW constant for 30 minutes = 5 kWh
    const res = integratePowerSamplesKwh([
      { timestampMs: t0, powerKw: 10 },
      { timestampMs: t0 + 10 * 60_000, powerKw: 10 },
      { timestampMs: t0 + 30 * 60_000, powerKw: 10 },
    ], 30 * 60_000);

    expect(res.measuredKwh).toBe(5);
    expect(res.estimatedKwh).toBe(0);
    expect(res.qualityStatus).toBe("COMPLETE");
    expect(res.methodVersion).toBe(SCOPE2_CALCULATION_METHOD_VERSION);
  });

  it("handles irregular intervals and deduplicates identical timestamps", () => {
    const t0 = Date.UTC(2026, 0, 1, 10, 0, 0);
    // Duplicate t0: last sample wins (4 kW), then 15 min later 8 kW => avg 6 kW * 0.25h = 1.5 kWh
    const res = integratePowerSamplesKwh([
      { timestampMs: t0, powerKw: 2 },
      { timestampMs: t0, powerKw: 4 },
      { timestampMs: t0 + 15 * 60_000, powerKw: 8 },
    ]);

    expect(res.duplicateTimestampsRemoved).toBe(1);
    expect(res.measuredKwh).toBe(1.5);
    expect(res.qualityStatus).toBe("COMPLETE");
  });

  it("surfaces large sampling gaps as PARTIAL coverage without fabricating energy", () => {
    const t0 = Date.UTC(2026, 0, 1, 10, 0, 0);
    // 0 -> 10 min: 6 kW * (1/6 h) = 1 kWh
    // 10 -> 50 min: 40 min gap (> 15 min maxGapMs) -> excluded
    // 50 -> 60 min: 6 kW * (1/6 h) = 1 kWh
    const res = integratePowerSamplesKwh([
      { timestampMs: t0, powerKw: 6 },
      { timestampMs: t0 + 10 * 60_000, powerKw: 6 },
      { timestampMs: t0 + 50 * 60_000, powerKw: 6 },
      { timestampMs: t0 + 60 * 60_000, powerKw: 6 },
    ]);

    expect(res.measuredKwh).toBe(2);
    expect(res.gapCount).toBe(1);
    expect(res.unmeasuredGapMs).toBe(40 * 60_000);
    expect(res.qualityStatus).toBe("PARTIAL");
  });

  it("returns UNKNOWN_FACTOR when region has no factor instead of guessing", () => {
    const registry = new EmissionFactorRegistry([]);
    const ledger = new Scope2ElectricityLedger(registry);
    const t0 = Date.UTC(2026, 0, 1, 10, 0, 0);

    const entry = ledger.recordCalculation("venue-1", "XX-UNKNOWN", [
      { timestampMs: t0, powerKw: 10 },
      { timestampMs: t0 + 30 * 60_000, powerKw: 10 },
    ], { maxGapMs: 60 * 60_000 });

    expect(entry.status).toBe("UNKNOWN_FACTOR");
    expect(entry.scope2KgCo2e).toBeNull();
    expect(entry.appliedFactor).toBeNull();
  });

  it("preserves historical reproducibility even after factor registry updates", () => {
    const t0 = Date.UTC(2026, 0, 1, 10, 0, 0);
    const registry = new EmissionFactorRegistry([
      {
        region: "IN-MH",
        version: "CEA-2025.1",
        kgCo2ePerKwh: 0.7,
        source: "CEA",
        publishedAt: "2025-01-01",
        effectiveFromMs: Date.UTC(2025, 0, 1),
        effectiveToMs: null,
      },
    ]);
    const ledger = new Scope2ElectricityLedger(registry);
    const samples = [
      { timestampMs: t0, powerKw: 10 },
      { timestampMs: t0 + 30 * 60_000, powerKw: 10 },
    ];

    const entry = ledger.recordCalculation("venue-1", "IN-MH", samples, {
      maxGapMs: 60 * 60_000,
    });
    expect(entry.measuredKwh).toBe(5);
    expect(entry.scope2KgCo2e).toBe(3.5);
    expect(entry.appliedFactor?.version).toBe("CEA-2025.1");

    // Register a newer factor in the registry
    registry.registerFactor({
      region: "IN-MH",
      version: "CEA-2026.1",
      kgCo2ePerKwh: 0.5,
      source: "CEA",
      publishedAt: "2026-01-01",
      effectiveFromMs: Date.UTC(2026, 0, 1),
      effectiveToMs: null,
    });

    // Historical entry still reproduces its exact original result
    const reproduced = ledger.reproduceEntry(entry.id, samples, 60 * 60_000);
    expect(reproduced.matchesStored).toBe(true);
    expect(reproduced.recomputedKwh).toBe(5);
    expect(reproduced.recomputedKgCo2e).toBe(3.5);
  });
});
