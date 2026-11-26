/**
 * Auditable Venue Electricity Consumption & Scope 2 Emissions Ledger (#10687)
 *
 * Converts timestamped instantaneous power readings (kW) into energy (kWh)
 * by integrating over actual elapsed time, applies a versioned regional
 * grid emission factor with provenance, and records immutable ledger entries.
 */

export const SCOPE2_CALCULATION_METHOD_VERSION = "trapezoidal-kw-v1";

export interface PowerSample {
  timestampMs: number;
  powerKw: number;
}

export type EnergyQualityStatus = "COMPLETE" | "PARTIAL" | "INSUFFICIENT";

export interface EnergyIntegrationResult {
  measuredKwh: number;
  estimatedKwh: number;
  intervalStartMs: number | null;
  intervalEndMs: number | null;
  sampleCount: number;
  duplicateTimestampsRemoved: number;
  gapCount: number;
  unmeasuredGapMs: number;
  qualityStatus: EnergyQualityStatus;
  methodVersion: string;
}

export interface RegionalEmissionFactor {
  region: string;
  version: string;
  kgCo2ePerKwh: number;
  source: string;
  publishedAt: string;
  effectiveFromMs: number;
  effectiveToMs: number | null;
}

export type Scope2ReportStatus =
  | "VERIFIED"
  | "PARTIAL_COVERAGE"
  | "UNKNOWN_FACTOR"
  | "INSUFFICIENT_DATA";

export interface Scope2LedgerEntry {
  id: string;
  venueId: string;
  region: string;
  createdAtMs: number;
  intervalStartMs: number | null;
  intervalEndMs: number | null;
  sampleCount: number;
  measuredKwh: number;
  estimatedKwh: number;
  qualityStatus: EnergyQualityStatus;
  gapCount: number;
  unmeasuredGapMs: number;
  methodVersion: string;
  appliedFactor: RegionalEmissionFactor | null;
  scope2KgCo2e: number | null;
  status: Scope2ReportStatus;
}

const DEFAULT_MAX_GAP_MS = 15 * 60 * 1000; // 15 minutes
const MS_PER_HOUR = 3_600_000;

/**
 * Integrates timestamped instantaneous power readings (kW) into energy (kWh)
 * using trapezoidal integration over actual elapsed time.
 *
 * Intervals exceeding `maxGapMs` are not fabricated; they are excluded from
 * `measuredKwh` and surfaced via `gapCount`, `unmeasuredGapMs`, and `PARTIAL` status.
 */
export function integratePowerSamplesKwh(
  samples: PowerSample[],
  maxGapMs: number = DEFAULT_MAX_GAP_MS,
): EnergyIntegrationResult {
  const valid = samples.filter(
    (s) =>
      Number.isFinite(s.timestampMs) &&
      Number.isFinite(s.powerKw) &&
      s.powerKw >= 0,
  );

  if (valid.length < 2) {
    return {
      measuredKwh: 0,
      estimatedKwh: 0,
      intervalStartMs: valid[0]?.timestampMs ?? null,
      intervalEndMs: valid[0]?.timestampMs ?? null,
      sampleCount: valid.length,
      duplicateTimestampsRemoved: 0,
      gapCount: 0,
      unmeasuredGapMs: 0,
      qualityStatus: "INSUFFICIENT",
      methodVersion: SCOPE2_CALCULATION_METHOD_VERSION,
    };
  }

  // Sort chronologically and deduplicate identical timestamps (last sample wins)
  const sorted = [...valid].sort((a, b) => a.timestampMs - b.timestampMs);
  const deduped: PowerSample[] = [];
  let duplicateTimestampsRemoved = 0;

  for (const sample of sorted) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.timestampMs === sample.timestampMs) {
      deduped[deduped.length - 1] = sample;
      duplicateTimestampsRemoved++;
    } else {
      deduped.push(sample);
    }
  }

  if (deduped.length < 2) {
    return {
      measuredKwh: 0,
      estimatedKwh: 0,
      intervalStartMs: deduped[0]?.timestampMs ?? null,
      intervalEndMs: deduped[0]?.timestampMs ?? null,
      sampleCount: deduped.length,
      duplicateTimestampsRemoved,
      gapCount: 0,
      unmeasuredGapMs: 0,
      qualityStatus: "INSUFFICIENT",
      methodVersion: SCOPE2_CALCULATION_METHOD_VERSION,
    };
  }

  let measuredKwh = 0;
  let gapCount = 0;
  let unmeasuredGapMs = 0;

  for (let i = 1; i < deduped.length; i++) {
    const prev = deduped[i - 1];
    const curr = deduped[i];
    const dtMs = curr.timestampMs - prev.timestampMs;

    if (dtMs > maxGapMs) {
      gapCount++;
      unmeasuredGapMs += dtMs;
      continue;
    }

    const avgPowerKw = (prev.powerKw + curr.powerKw) / 2;
    measuredKwh += avgPowerKw * (dtMs / MS_PER_HOUR);
  }

  const roundedKwh = Number(measuredKwh.toFixed(6));
  const qualityStatus: EnergyQualityStatus =
    gapCount > 0 ? "PARTIAL" : "COMPLETE";

  return {
    measuredKwh: roundedKwh,
    estimatedKwh: 0,
    intervalStartMs: deduped[0].timestampMs,
    intervalEndMs: deduped[deduped.length - 1].timestampMs,
    sampleCount: deduped.length,
    duplicateTimestampsRemoved,
    gapCount,
    unmeasuredGapMs,
    qualityStatus,
    methodVersion: SCOPE2_CALCULATION_METHOD_VERSION,
  };
}

export class EmissionFactorRegistry {
  private factors: RegionalEmissionFactor[] = [];

  constructor(initialFactors: RegionalEmissionFactor[] = []) {
    for (const factor of initialFactors) {
      this.registerFactor(factor);
    }
  }

  public registerFactor(factor: RegionalEmissionFactor): void {
    if (!factor.region.trim() || !factor.version.trim()) {
      throw new Error("Emission factor region and version are required");
    }
    if (!Number.isFinite(factor.kgCo2ePerKwh) || factor.kgCo2ePerKwh < 0) {
      throw new Error("kgCo2ePerKwh must be a non-negative finite number");
    }
    this.factors.push({ ...factor });
  }

  public lookupFactor(
    region: string,
    atTimestampMs: number,
  ): RegionalEmissionFactor | null {
    const candidates = this.factors.filter(
      (f) =>
        f.region === region &&
        atTimestampMs >= f.effectiveFromMs &&
        (f.effectiveToMs === null || atTimestampMs <= f.effectiveToMs),
    );
    if (candidates.length === 0) return null;

    // Pick the most recently effective factor version
    candidates.sort((a, b) => b.effectiveFromMs - a.effectiveFromMs);
    return { ...candidates[0] };
  }

  public getFactorByVersion(
    region: string,
    version: string,
  ): RegionalEmissionFactor | null {
    const found = this.factors.find(
      (f) => f.region === region && f.version === version,
    );
    return found ? { ...found } : null;
  }
}

export const DEFAULT_REGIONAL_FACTORS: RegionalEmissionFactor[] = [
  {
    region: "IN-MH",
    version: "CEA-2025.1",
    kgCo2ePerKwh: 0.716,
    source: "Central Electricity Authority (CEA) India CO2 Baseline v20",
    publishedAt: "2025-01-15",
    effectiveFromMs: Date.UTC(2025, 0, 1),
    effectiveToMs: null,
  },
  {
    region: "US-CA",
    version: "EPA-eGRID-2025.1",
    kgCo2ePerKwh: 0.214,
    source: "US EPA eGRID CAMX Subregion",
    publishedAt: "2025-02-01",
    effectiveFromMs: Date.UTC(2025, 0, 1),
    effectiveToMs: null,
  },
  {
    region: "EU-DE",
    version: "EEA-2025.1",
    kgCo2ePerKwh: 0.348,
    source: "European Environment Agency Grid Intensity",
    publishedAt: "2025-01-20",
    effectiveFromMs: Date.UTC(2025, 0, 1),
    effectiveToMs: null,
  },
];

export class Scope2ElectricityLedger {
  private entries = new Map<string, Scope2LedgerEntry>();
  private counter = 0;

  constructor(
    private readonly registry: EmissionFactorRegistry = new EmissionFactorRegistry(
      DEFAULT_REGIONAL_FACTORS,
    ),
  ) {}

  public recordCalculation(
    venueId: string,
    region: string,
    samples: PowerSample[],
    options: { maxGapMs?: number; nowMs?: number } = {},
  ): Scope2LedgerEntry {
    const nowMs = options.nowMs ?? Date.now();
    const energy = integratePowerSamplesKwh(samples, options.maxGapMs);
    const factorTimestamp = energy.intervalEndMs ?? nowMs;
    const factor = this.registry.lookupFactor(region, factorTimestamp);

    let status: Scope2ReportStatus;
    let scope2KgCo2e: number | null = null;

    if (energy.qualityStatus === "INSUFFICIENT") {
      status = "INSUFFICIENT_DATA";
    } else if (!factor) {
      status = "UNKNOWN_FACTOR";
    } else {
      scope2KgCo2e = Number(
        (energy.measuredKwh * factor.kgCo2ePerKwh).toFixed(6),
      );
      status =
        energy.qualityStatus === "PARTIAL" ? "PARTIAL_COVERAGE" : "VERIFIED";
    }

    const id = `scope2_${nowMs}_${++this.counter}`;
    const entry: Scope2LedgerEntry = {
      id,
      venueId,
      region,
      createdAtMs: nowMs,
      intervalStartMs: energy.intervalStartMs,
      intervalEndMs: energy.intervalEndMs,
      sampleCount: energy.sampleCount,
      measuredKwh: energy.measuredKwh,
      estimatedKwh: energy.estimatedKwh,
      qualityStatus: energy.qualityStatus,
      gapCount: energy.gapCount,
      unmeasuredGapMs: energy.unmeasuredGapMs,
      methodVersion: energy.methodVersion,
      appliedFactor: factor,
      scope2KgCo2e,
      status,
    };

    this.entries.set(id, entry);
    return entry;
  }

  /**
   * Reproduces a historical ledger calculation using the exact factor snapshot
   * stored on that entry, guaranteeing reproducibility even after registry updates.
   */
  public reproduceEntry(
    entryId: string,
    samples: PowerSample[],
    maxGapMs: number = DEFAULT_MAX_GAP_MS,
  ): { matchesStored: boolean; recomputedKwh: number; recomputedKgCo2e: number | null } {
    const stored = this.entries.get(entryId);
    if (!stored) {
      throw new Error(`Scope 2 ledger entry ${entryId} not found`);
    }
    const energy = integratePowerSamplesKwh(samples, maxGapMs);
    const recomputedKgCo2e =
      stored.appliedFactor && energy.qualityStatus !== "INSUFFICIENT"
        ? Number(
            (energy.measuredKwh * stored.appliedFactor.kgCo2ePerKwh).toFixed(6),
          )
        : null;

    return {
      matchesStored:
        energy.measuredKwh === stored.measuredKwh &&
        recomputedKgCo2e === stored.scope2KgCo2e,
      recomputedKwh: energy.measuredKwh,
      recomputedKgCo2e,
    };
  }

  public getEntry(entryId: string): Scope2LedgerEntry | undefined {
    return this.entries.get(entryId);
  }
}

export const defaultScope2Ledger = new Scope2ElectricityLedger();
