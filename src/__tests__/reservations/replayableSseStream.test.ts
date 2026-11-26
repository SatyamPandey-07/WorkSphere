import {
  SharedReservationReplayLog,
  normalizeCdcToReservationEvent,
} from "@/lib/reservations/replayableStream";

describe("SharedReservationReplayLog & CDC normalization (#10685)", () => {
  it("delivers CDC reservation events across two simulated instances and deduplicates duplicate deliveries", () => {
    const sharedBackend = new SharedReservationReplayLog(100);
    const instanceBReceived: number[] = [];

    // Instance B subscribes to venue-1
    sharedBackend.subscribe("venue-1", (ev) => {
      instanceBReceived.push(ev.cursor);
    });

    // Instance A ingests a CDC record
    const first = sharedBackend.ingestCdcRecord({
      id: "cdc-100",
      table: "Booking",
      operation: "INSERT",
      committedAt: 1000,
      after: { id: "bk-1", venueId: "venue-1", deskId: "d-1", status: "CONFIRMED" },
    });
    expect(first?.cursor).toBe(1);
    expect(instanceBReceived).toEqual([1]);

    // Duplicate CDC delivery is deduplicated
    const dup = sharedBackend.ingestCdcRecord({
      id: "cdc-100",
      table: "Booking",
      operation: "INSERT",
      committedAt: 1000,
      after: { id: "bk-1", venueId: "venue-1", deskId: "d-1", status: "CONFIRMED" },
    });
    expect(dup).toBeNull();
    expect(instanceBReceived).toEqual([1]);
  });

  it("ignores non-reservation CDC tables and malformed records", () => {
    expect(
      normalizeCdcToReservationEvent({
        id: "cdc-x",
        table: "AuditLog",
        operation: "INSERT",
        after: { id: "a1", venueId: "venue-1" },
      }),
    ).toBeNull();
    expect(normalizeCdcToReservationEvent(null)).toBeNull();
    expect(normalizeCdcToReservationEvent("poison")).toBeNull();
  });

  it("replays retained events strictly after Last-Event-ID and signals RESYNC_REQUIRED when expired or malformed", () => {
    const log = new SharedReservationReplayLog(3);

    for (let i = 1; i <= 5; i++) {
      log.publish({
        eventId: `e-${i}`,
        venueId: "venue-1",
        type: "RESERVATION_UPDATED",
        occurredAt: 1000 + i,
        payload: { seq: i },
      });
    }

    // Retained cursors are 3, 4, 5 (oldestRetainedCursor = 3)
    const validReplay = log.replayAfter("venue-1", "3");
    expect(validReplay.status).toBe("OK");
    if (validReplay.status === "OK") {
      expect(validReplay.events.map((e) => e.cursor)).toEqual([4, 5]);
    }

    // Cursor 1 has expired from the 3-event window
    const expiredReplay = log.replayAfter("venue-1", "1");
    expect(expiredReplay).toEqual({
      status: "RESYNC_REQUIRED",
      reason: "cursor_expired",
      latestCursor: 5,
    });

    // Malformed cursor triggers RESYNC_REQUIRED
    const malformedReplay = log.replayAfter("venue-1", "not-a-cursor");
    expect(malformedReplay).toEqual({
      status: "RESYNC_REQUIRED",
      reason: "malformed_cursor",
      latestCursor: 5,
    });
  });
});
