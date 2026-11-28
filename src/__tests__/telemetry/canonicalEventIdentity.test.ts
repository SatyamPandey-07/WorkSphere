import {
  buildCanonicalEventDescriptor,
  compareCanonicalEvents,
  reconcileDuplicateDeviceEvents,
  reconcileDuplicateDeviceEventsWithStats,
  type TelemetryDeviceEvent,
} from "@/lib/telemetry/canonicalEventIdentity";

describe("canonicalEventIdentity deterministic reconciliation", () => {
  it("reconciles duplicate events and breaks ties deterministically on equal (deviceId, timestamp)", () => {
    const ts = "2026-11-27T06:15:00.000Z";
    const eventAlpha: TelemetryDeviceEvent = {
      deviceId: "dev-sensor-01",
      timestamp: ts,
      eventType: "reading",
      sequence: 101,
      payload: { temp: 28.4, humidity: 62 },
    };
    const eventAlphaDuplicate: TelemetryDeviceEvent = {
      deviceId: "dev-sensor-01",
      timestamp: Date.parse(ts),
      eventType: "reading",
      sequence: 101,
      payload: { humidity: 62, temp: 28.4 },
    };
    const eventBeta: TelemetryDeviceEvent = {
      deviceId: "dev-sensor-01",
      timestamp: ts,
      eventType: "reading",
      sequence: 102,
      payload: { temp: 28.5, humidity: 61 },
    };

    expect(buildCanonicalEventDescriptor(eventAlpha).canonicalKey).toBe(
      buildCanonicalEventDescriptor(eventAlphaDuplicate).canonicalKey,
    );

    const forwardOrder = reconcileDuplicateDeviceEvents([
      eventAlpha,
      eventBeta,
      eventAlphaDuplicate,
    ]);
    const reverseOrder = reconcileDuplicateDeviceEvents([
      eventBeta,
      eventAlphaDuplicate,
      eventAlpha,
    ]);

    expect(forwardOrder).toHaveLength(2);
    expect(reverseOrder).toHaveLength(2);
    expect(forwardOrder.map((d) => d.canonicalKey)).toEqual(
      reverseOrder.map((d) => d.canonicalKey),
    );
    expect(forwardOrder[0].event.sequence).toBe(101);
    expect(forwardOrder[1].event.sequence).toBe(102);
  });

  it("orders adjacent 64-bit sequence values above Number.MAX_SAFE_INTEGER in either direction", () => {
    const lower: TelemetryDeviceEvent = {
      deviceId: "dev-sensor-01",
      timestamp: 1,
      sequence: "9223372036854775806",
    };
    const higher: TelemetryDeviceEvent = {
      ...lower,
      sequence: "9223372036854775807",
    };

    expect(compareCanonicalEvents(lower, higher)).toBeLessThan(0);
    expect(compareCanonicalEvents(higher, lower)).toBeGreaterThan(0);
    expect(
      reconcileDuplicateDeviceEvents([higher, lower]).map(
        ({ event }) => event.sequence,
      ),
    ).toEqual([lower.sequence, higher.sequence]);
    expect(
      reconcileDuplicateDeviceEvents([lower, higher]).map(
        ({ event }) => event.sequence,
      ),
    ).toEqual([lower.sequence, higher.sequence]);
  });

  it("treats numerically equal sequence strings as equal before comparing remaining tie-breakers", () => {
    const first: TelemetryDeviceEvent = {
      deviceId: "dev-sensor-01",
      timestamp: 1,
      sequence: "00042",
      eventId: "a",
    };
    const second: TelemetryDeviceEvent = {
      ...first,
      sequence: "42",
      eventId: "b",
    };

    expect(compareCanonicalEvents(first, second)).toBeLessThan(0);
    expect(
      compareCanonicalEvents(
        { ...first, eventId: "same" },
        { ...second, eventId: "same" },
      ),
    ).toBe(0);
  });

  it("preserves ordinary numeric sequence ordering", () => {
    const lower: TelemetryDeviceEvent = {
      deviceId: "dev-sensor-01",
      timestamp: 1,
      sequence: 101,
    };
    const higher: TelemetryDeviceEvent = { ...lower, sequence: 102 };

    expect(compareCanonicalEvents(lower, higher)).toBeLessThan(0);
    expect(compareCanonicalEvents(higher, lower)).toBeGreaterThan(0);
    expect(
      buildCanonicalEventDescriptor(lower).tieBreaker.startsWith(
        "0000000000000101|",
      ),
    ).toBe(true);
  });
});

describe("canonicalEventIdentity batch statistics", () => {
  it("counts accepted, duplicate, and out-of-order events", () => {
    const first: TelemetryDeviceEvent = {
      deviceId: "device-1",
      timestamp: 100,
      sequence: 1,
    };
    const third: TelemetryDeviceEvent = {
      deviceId: "device-1",
      timestamp: 300,
      sequence: 3,
    };
    const second: TelemetryDeviceEvent = {
      deviceId: "device-1",
      timestamp: 200,
      sequence: 2,
    };

    expect(
      reconcileDuplicateDeviceEventsWithStats([first, third, second, third]),
    ).toEqual({
      accepted: 3,
      deduplicated: 1,
      outOfOrder: 1,
    });
  });

  it("returns zero counts for an empty batch", () => {
    expect(reconcileDuplicateDeviceEventsWithStats([])).toEqual({
      accepted: 0,
      deduplicated: 0,
      outOfOrder: 0,
    });
  });
});
