import { createHash } from "crypto";

export const TELEMETRY_IDENTITY_VERSION = "v1";

export interface TelemetryEventIdentityInput {
  gatewayId?: string;
  sensorId: string;
  channel: string;
  recordedAtMs: number;
  sessionId?: string;
  sequenceNumber?: number;
}

export interface CanonicalTelemetryRecord extends TelemetryEventIdentityInput {
  canonicalId: string;
  payloadDigest: string;
  value: number;
}

export type IngestionDisposition = "ACCEPTED" | "DUPLICATE" | "CONFLICT";

export interface ReconciledDeviceState {
  deviceKey: string;
  sessionId: string;
  highestContiguousSeq: number;
  highestSeenSeq: number;
  missingSequences: number[];
  lateArrivalsCount: number;
}

export interface WindowAggregate {
  windowKey: string;
  count: number;
  sum: number;
  avg: number;
  provisional: boolean;
}

export function computeCanonicalEventId(
  input: TelemetryEventIdentityInput,
): string {
  const gateway = input.gatewayId?.trim() || "default-gw";
  const channel = input.channel.trim() || "sensor";

  const keyMaterial =
    typeof input.sequenceNumber === "number" &&
    Number.isSafeInteger(input.sequenceNumber)
      ? `${TELEMETRY_IDENTITY_VERSION}:seq:${gateway}:${input.sensorId}:${channel}:${input.sessionId ?? "default"}:${input.sequenceNumber}`
      : `${TELEMETRY_IDENTITY_VERSION}:ts:${gateway}:${input.sensorId}:${channel}:${input.recordedAtMs}`;

  return createHash("sha256").update(keyMaterial, "utf8").digest("hex");
}

export function computePayloadDigest(value: number): string {
  return createHash("sha256")
    .update(`${value}`, "utf8")
    .digest("hex")
    .slice(0, 16);
}

/**
 * Per-device ordering reconciler with canonical idempotency, conflict detection,
 * gap tracking, and deterministic window aggregate recomputation.
 */
export class PerDeviceOrderingReconciler {
  private acceptedByCanonicalId = new Map<string, CanonicalTelemetryRecord>();
  private deviceStates = new Map<string, ReconciledDeviceState>();
  private seenSequences = new Map<string, Set<number>>();

  public ingest(
    input: TelemetryEventIdentityInput,
    value: number,
  ): {
    disposition: IngestionDisposition;
    canonicalId: string;
    isLateArrival: boolean;
    deviceState?: ReconciledDeviceState;
    reason?: string;
  } {
    const canonicalId = computeCanonicalEventId(input);
    const payloadDigest = computePayloadDigest(value);

    const existing = this.acceptedByCanonicalId.get(canonicalId);
    if (existing) {
      if (existing.payloadDigest === payloadDigest) {
        return {
          disposition: "DUPLICATE",
          canonicalId,
          isLateArrival: false,
        };
      }
      return {
        disposition: "CONFLICT",
        canonicalId,
        isLateArrival: false,
        reason: `Conflicting payload for canonicalId ${canonicalId} (existing=${existing.value}, incoming=${value})`,
      };
    }

    const record: CanonicalTelemetryRecord = {
      ...input,
      canonicalId,
      payloadDigest,
      value,
    };
    this.acceptedByCanonicalId.set(canonicalId, record);

    let isLateArrival = false;
    let deviceState: ReconciledDeviceState | undefined;

    if (
      typeof input.sequenceNumber === "number" &&
      Number.isSafeInteger(input.sequenceNumber) &&
      input.sequenceNumber >= 0
    ) {
      const sessionId = input.sessionId ?? "default";
      const deviceKey = `${input.gatewayId ?? "default-gw"}::${input.sensorId}::${sessionId}`;
      let state = this.deviceStates.get(deviceKey);
      let seqSet = this.seenSequences.get(deviceKey);

      if (!state || !seqSet) {
        state = {
          deviceKey,
          sessionId,
          highestContiguousSeq: -1,
          highestSeenSeq: -1,
          missingSequences: [],
          lateArrivalsCount: 0,
        };
        seqSet = new Set<number>();
        this.deviceStates.set(deviceKey, state);
        this.seenSequences.set(deviceKey, seqSet);
      }

      const seq = input.sequenceNumber;
      if (seq < state.highestSeenSeq) {
        isLateArrival = true;
        state.lateArrivalsCount++;
      }

      seqSet.add(seq);
      if (seq > state.highestSeenSeq) {
        state.highestSeenSeq = seq;
      }

      // Advance contiguous watermark monotonically
      while (seqSet.has(state.highestContiguousSeq + 1)) {
        state.highestContiguousSeq++;
      }

      // Recompute missing gaps between contiguous watermark and highestSeenSeq
      const missing: number[] = [];
      for (
        let s = state.highestContiguousSeq + 1;
        s < state.highestSeenSeq;
        s++
      ) {
        if (!seqSet.has(s)) {
          missing.push(s);
        }
      }
      state.missingSequences = missing;
      deviceState = { ...state, missingSequences: [...missing] };
    }

    return {
      disposition: "ACCEPTED",
      canonicalId,
      isLateArrival,
      deviceState,
    };
  }

  /**
   * Deterministically computes 1-minute window aggregates from accepted events.
   * Marks windows as provisional if any device still has missing sequence gaps.
   */
  public computeMinuteWindowAggregates(): WindowAggregate[] {
    const hasOpenGaps = Array.from(this.deviceStates.values()).some(
      (s) => s.missingSequences.length > 0,
    );

    const buckets = new Map<string, { count: number; sum: number }>();
    for (const rec of this.acceptedByCanonicalId.values()) {
      const minuteBucket = Math.floor(rec.recordedAtMs / 60_000) * 60_000;
      const windowKey = `${rec.sensorId}:${rec.channel}:${minuteBucket}`;
      const b = buckets.get(windowKey) ?? { count: 0, sum: 0 };
      b.count++;
      b.sum += rec.value;
      buckets.set(windowKey, b);
    }

    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([windowKey, b]) => ({
        windowKey,
        count: b.count,
        sum: b.sum,
        avg: Number((b.sum / b.count).toFixed(6)),
        provisional: hasOpenGaps,
      }));
  }

  public getDeviceState(
    sensorId: string,
    gatewayId: string = "default-gw",
    sessionId: string = "default",
  ): ReconciledDeviceState | undefined {
    const s = this.deviceStates.get(`${gatewayId}::${sensorId}::${sessionId}`);
    return s ? { ...s, missingSequences: [...s.missingSequences] } : undefined;
  }
}
