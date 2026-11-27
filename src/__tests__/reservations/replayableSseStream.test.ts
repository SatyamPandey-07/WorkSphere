import {
  DEFAULT_SSE_HEARTBEAT_INTERVAL_MS,
  SharedReservationReplayLog,
  normalizeCdcToReservationEvent,
  withSseHeartbeatComments,
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

  describe("SSE heartbeat comment frames", () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    function createSource() {
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>({
        start(streamController) {
          controller = streamController;
        },
      });
      return { stream, controller: () => controller };
    }

    it("uses the default idle interval when configuration is invalid", async () => {
      jest.useFakeTimers();
      const source = createSource();
      const reader = withSseHeartbeatComments(source.stream, 0).getReader();
      let received = false;
      const read = reader.read().then((result) => {
        received = true;
        return result;
      });

      await Promise.resolve();
      jest.advanceTimersByTime(DEFAULT_SSE_HEARTBEAT_INTERVAL_MS - 1);
      await Promise.resolve();
      expect(received).toBe(false);

      jest.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();
      await expect(read).resolves.toEqual({
        done: false,
        value: new TextEncoder().encode(": heartbeat\n\n"),
      });
      await reader.cancel();
    });

    it("does not emit before a custom interval, then emits the exact comment frame", async () => {
      jest.useFakeTimers();
      const source = createSource();
      const reader = withSseHeartbeatComments(source.stream, 250).getReader();
      let received = false;
      const read = reader.read().then((result) => {
        received = true;
        return result;
      });

      await Promise.resolve();
      jest.advanceTimersByTime(249);
      await Promise.resolve();
      expect(received).toBe(false);

      jest.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();
      const result = await read;
      expect(result.done).toBe(false);
      expect(new TextDecoder().decode(result.value)).toBe(": heartbeat\n\n");
      await reader.cancel();
    });

    it("forwards event frames unchanged and leaves replay IDs and payloads untouched", async () => {
      jest.useFakeTimers();
      const log = new SharedReservationReplayLog();
      const source = createSource();
      const reader = withSseHeartbeatComments(source.stream, 100).getReader();
      const encodeEvent = (event: NonNullable<ReturnType<typeof log.publish>>) =>
        new TextEncoder().encode(
          `id: ${event.cursor}\nevent: availability\ndata: ${JSON.stringify(event.payload)}\n\n`,
        );
      const first = log.publish({
        eventId: "event-1",
        venueId: "venue-1",
        type: "RESERVATION_UPDATED",
        occurredAt: 1000,
        payload: { seatId: "seat-1", available: false },
      })!;
      const firstRead = reader.read();
      source.controller().enqueue(encodeEvent(first));
      const firstFrame = await firstRead;
      expect(new TextDecoder().decode(firstFrame.value)).toBe(
        `id: 1\nevent: availability\ndata: {"seatId":"seat-1","available":false}\n\n`,
      );

      const heartbeatRead = reader.read();
      await Promise.resolve();
      jest.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
      expect(new TextDecoder().decode((await heartbeatRead).value)).toBe(
        ": heartbeat\n\n",
      );

      const second = log.publish({
        eventId: "event-2",
        venueId: "venue-1",
        type: "RESERVATION_UPDATED",
        occurredAt: 1001,
        payload: { seatId: "seat-2", available: true },
      })!;
      const secondRead = reader.read();
      source.controller().enqueue(encodeEvent(second));
      expect(new TextDecoder().decode((await secondRead).value)).toBe(
        `id: 2\nevent: availability\ndata: {"seatId":"seat-2","available":true}\n\n`,
      );
      expect(log.getLatestCursor()).toBe(2);
      await reader.cancel();
    });

    it("cleans up heartbeat timers on cancellation, source close, and source error", async () => {
      jest.useFakeTimers();

      const cancelledSource = createSource();
      const cancelledReader = withSseHeartbeatComments(
        cancelledSource.stream,
        100,
      ).getReader();
      const pendingRead = cancelledReader.read();
      await Promise.resolve();
      await cancelledReader.cancel();
      await pendingRead;
      expect(jest.getTimerCount()).toBe(0);

      const closedSource = createSource();
      const closedReader = withSseHeartbeatComments(
        closedSource.stream,
        100,
      ).getReader();
      const closedRead = closedReader.read();
      await Promise.resolve();
      closedSource.controller().close();
      await expect(closedRead).resolves.toEqual({ done: true, value: undefined });
      expect(jest.getTimerCount()).toBe(0);

      const erroredSource = createSource();
      const erroredReader = withSseHeartbeatComments(
        erroredSource.stream,
        100,
      ).getReader();
      const erroredRead = erroredReader.read();
      await Promise.resolve();
      erroredSource.controller().error(new Error("source failed"));
      await expect(erroredRead).rejects.toThrow("source failed");
      expect(jest.getTimerCount()).toBe(0);
    });

    it("cancels the replay source and stops reading when the client disconnects", async () => {
      jest.useFakeTimers();
      let pullCount = 0;
      let sourceCancelled = false;
      const source = new ReadableStream<Uint8Array>({
        pull(controller) {
          pullCount++;
          controller.enqueue(
            new TextEncoder().encode(
              `id: ${pullCount}\nevent: availability\ndata: {"seq":${pullCount}}\n\n`,
            ),
          );
        },
        cancel() {
          sourceCancelled = true;
        },
      });
      const reader = withSseHeartbeatComments(source, 100).getReader();

      const firstFrame = await reader.read();
      expect(new TextDecoder().decode(firstFrame.value)).toContain('"seq":1');

      const pendingRead = reader.read();
      await Promise.resolve();
      const pullsAtCancellation = pullCount;
      await reader.cancel();
      await pendingRead;
      jest.advanceTimersByTime(500);
      await Promise.resolve();

      expect(sourceCancelled).toBe(true);
      expect(pullCount).toBe(pullsAtCancellation);
      expect(jest.getTimerCount()).toBe(0);
    });

    it("forwards the final replay frame and closes without enqueueing after source closure", async () => {
      const frame =
        'id: 7\nevent: availability\ndata: {"seatId":"seat-7"}\n\n';
      const source = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(frame));
          controller.close();
        },
      });
      const reader = withSseHeartbeatComments(source, 100).getReader();

      const first = await reader.read();
      expect(first.done).toBe(false);
      expect(new TextDecoder().decode(first.value)).toBe(frame);
      await expect(reader.read()).resolves.toEqual({
        done: true,
        value: undefined,
      });
    });
  });
});
