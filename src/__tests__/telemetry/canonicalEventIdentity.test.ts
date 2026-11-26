import {
  PerDeviceOrderingReconciler,
  computeCanonicalEventId,
} from "@/lib/telemetry/canonicalEventIdentity";

describe("PerDeviceOrderingReconciler & Canonical Event Identity (#10686)", () => {
  it("keeps distinct channels at the same timestamp as independent events", () => {
    const reconciler = new PerDeviceOrderingReconciler();
    const t0 = 1_700_000_000_000;

    const r1 = reconciler.ingest(
      { sensorId: "s-1", channel: "noise_db", recordedAtMs: t0 },
      55,
    );
    const r2 = reconciler.ingest(
      { sensorId: "s-1", channel: "temp_c", recordedAtMs: t0 },
      22,
    );

    expect(r1.disposition).toBe("ACCEPTED");
    expect(r2.disposition).toBe("ACCEPTED");
    expect(r1.canonicalId).not.toBe(r2.canonicalId);
  });

  it("recognizes identical retries as DUPLICATE and conflicting payloads as CONFLICT", () => {
    const reconciler = new PerDeviceOrderingReconciler();
    const input = {
      gatewayId: "gw-1",
      sensorId: "s-1",
      channel: "noise_db",
      recordedAtMs: 1_700_000_000_000,
      sessionId: "sess-a",
      sequenceNumber: 0,
    };

    expect(reconciler.ingest(input, 48).disposition).toBe("ACCEPTED");
    expect(reconciler.ingest(input, 48).disposition).toBe("DUPLICATE");

    const conflict = reconciler.ingest(input, 99);
    expect(conflict.disposition).toBe("CONFLICT");
    expect(conflict.reason).toContain("Conflicting payload");
  });

  it("tracks sequence gaps, reconciles late arrivals, and produces identical aggregates regardless of delivery order", () => {
    const t0 = 1_700_000_040_000;
    const events = [
      { seq: 0, val: 10 },
      { seq: 1, val: 20 },
      { seq: 2, val: 30 },
    ];

    const inOrder = new PerDeviceOrderingReconciler();
    for (const e of events) {
      inOrder.ingest(
        {
          sensorId: "s-1",
          channel: "power_kw",
          recordedAtMs: t0,
          sequenceNumber: e.seq,
        },
        e.val,
      );
    }

    const outOfOrder = new PerDeviceOrderingReconciler();
    // Deliver seq 0, then seq 2 (gap at 1), then late seq 1
    outOfOrder.ingest(
      { sensorId: "s-1", channel: "power_kw", recordedAtMs: t0, sequenceNumber: 0 },
      10,
    );
    const afterSeq2 = outOfOrder.ingest(
      { sensorId: "s-1", channel: "power_kw", recordedAtMs: t0, sequenceNumber: 2 },
      30,
    );
    expect(afterSeq2.deviceState?.missingSequences).toEqual([1]);
    expect(afterSeq2.deviceState?.highestContiguousSeq).toBe(0);
    expect(outOfOrder.computeMinuteWindowAggregates()[0].provisional).toBe(true);

    const lateRes = outOfOrder.ingest(
      { sensorId: "s-1", channel: "power_kw", recordedAtMs: t0, sequenceNumber: 1 },
      20,
    );
    expect(lateRes.isLateArrival).toBe(true);
    expect(lateRes.deviceState?.missingSequences).toEqual([]);
    expect(lateRes.deviceState?.highestContiguousSeq).toBe(2);

    expect(outOfOrder.computeMinuteWindowAggregates()).toEqual(
      inOrder.computeMinuteWindowAggregates(),
    );
    expect(
      computeCanonicalEventId({
        sensorId: "s-1",
        channel: "power_kw",
        recordedAtMs: t0,
        sequenceNumber: 1,
      }),
    ).toBeDefined();
  });
});
