import { NextRequest } from "next/server";
import { GET } from "@/app/api/reservations/events/route";
import * as eventBusModule from "@/lib/reservations/event-bus";
import { publishVenueAvailability } from "@/lib/reservations/event-bus";

function parseSseChunk(chunkValue?: Uint8Array): {
  event: string;
  data: Record<string, unknown>;
} {
  if (!chunkValue) {
    throw new Error("Expected chunkValue but received undefined");
  }
  const text = new TextDecoder().decode(chunkValue);
  const eventMatch = text.match(/^event: (.*)$/m);
  const dataMatch = text.match(/^data: (.*)$/m);
  return {
    event: eventMatch ? eventMatch[1].trim() : "",
    data: dataMatch ? JSON.parse(dataMatch[1].trim()) : {},
  };
}

describe("GET /api/reservations/events", () => {
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("returns 400 Bad Request when venueId query parameter is missing", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/reservations/events",
    );
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({
      error: "Missing required query parameter: venueId",
    });
  });

  test("a new stream receives event: connected", async () => {
    const venueId = "venue_connected_test";
    const req = new NextRequest(
      `http://localhost:3000/api/reservations/events?venueId=${venueId}`,
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(res.body).not.toBeNull();

    const reader = res.body!.getReader();
    try {
      const chunk = await reader.read();
      expect(chunk.done).toBe(false);
      const frame = parseSseChunk(chunk.value);
      expect(frame.event).toBe("connected");
      expect(frame.data.type).toBe("connected");
      expect(frame.data.venueId).toBe(venueId);
      expect(frame.data.timestamp).toBeDefined();
    } finally {
      await reader.cancel();
    }
  });

  test("an ordinary shared-bus event reaches the stream as event: availability", async () => {
    const venueId = "venue_ordinary_test";
    const req = new NextRequest(
      `http://localhost:3000/api/reservations/events?venueId=${venueId}`,
    );
    const res = await GET(req);
    const reader = res.body!.getReader();

    try {
      // Consume connected handshake frame
      const connectedChunk = await reader.read();
      expect(parseSseChunk(connectedChunk.value).event).toBe("connected");

      // Publish ordinary event via shared bus
      publishVenueAvailability(venueId, {
        type: "desk_reservation_held",
        availableSeats: 5,
        crowdLevel: "QUIET",
      });

      const eventChunk = await reader.read();
      expect(eventChunk.done).toBe(false);
      const frame = parseSseChunk(eventChunk.value);
      expect(frame.event).toBe("availability");
      expect(frame.data.type).toBe("desk_reservation_held");
      expect(frame.data.venueId).toBe(venueId);
      expect(frame.data.availableSeats).toBe(5);
      expect(frame.data.crowdLevel).toBe("QUIET");
    } finally {
      await reader.cancel();
    }
  });

  test("DESK_HOLD_EXPIRED reaches the stream as event: desk_expired", async () => {
    const venueId = "venue_desk_hold_expired";
    const req = new NextRequest(
      `http://localhost:3000/api/reservations/events?venueId=${venueId}`,
    );
    const res = await GET(req);
    const reader = res.body!.getReader();

    try {
      await reader.read(); // connected frame

      publishVenueAvailability(venueId, {
        type: "DESK_HOLD_EXPIRED",
        deskId: "desk_hold_123",
        seatId: "seat_hold_123",
      });

      const chunk = await reader.read();
      expect(chunk.done).toBe(false);
      const frame = parseSseChunk(chunk.value);
      expect(frame.event).toBe("desk_expired");
      expect(frame.data.type).toBe("DESK_HOLD_EXPIRED");
      expect(frame.data.deskId).toBe("desk_hold_123");
      expect(frame.data.seatId).toBe("seat_hold_123");
      expect(frame.data.venueId).toBe(venueId);
    } finally {
      await reader.cancel();
    }
  });

  test("SEAT_HOLD_EXPIRED reaches the stream as event: desk_expired", async () => {
    const venueId = "venue_seat_hold_expired";
    const req = new NextRequest(
      `http://localhost:3000/api/reservations/events?venueId=${venueId}`,
    );
    const res = await GET(req);
    const reader = res.body!.getReader();

    try {
      await reader.read(); // connected frame

      publishVenueAvailability(venueId, {
        type: "SEAT_HOLD_EXPIRED",
        deskId: "desk_seat_456",
        seatId: "seat_hold_456",
      });

      const chunk = await reader.read();
      expect(chunk.done).toBe(false);
      const frame = parseSseChunk(chunk.value);
      expect(frame.event).toBe("desk_expired");
      expect(frame.data.type).toBe("SEAT_HOLD_EXPIRED");
      expect(frame.data.deskId).toBe("desk_seat_456");
      expect(frame.data.seatId).toBe("seat_hold_456");
      expect(frame.data.venueId).toBe(venueId);
    } finally {
      await reader.cancel();
    }
  });

  test("desk_reservation_expired reaches the stream as event: desk_expired with normalized payload type DESK_HOLD_EXPIRED", async () => {
    const venueId = "venue_norm_expired";
    const req = new NextRequest(
      `http://localhost:3000/api/reservations/events?venueId=${venueId}`,
    );
    const res = await GET(req);
    const reader = res.body!.getReader();

    try {
      await reader.read(); // connected frame

      publishVenueAvailability(venueId, {
        type: "desk_reservation_expired",
        deskId: "desk_norm_789",
        seatId: "seat_norm_789",
        reason: "EXPIRED",
      });

      const chunk = await reader.read();
      expect(chunk.done).toBe(false);
      const frame = parseSseChunk(chunk.value);
      expect(frame.event).toBe("desk_expired");
      expect(frame.data.type).toBe("DESK_HOLD_EXPIRED");
      expect(frame.data.deskId).toBe("desk_norm_789");
      expect(frame.data.seatId).toBe("seat_norm_789");
      expect(frame.data.venueId).toBe(venueId);
      expect(frame.data.reason).toBe("EXPIRED");
    } finally {
      await reader.cancel();
    }
  });

  test("preserves remaining event payload properties including venueId, deskId, and seatId", async () => {
    const venueId = "venue_preserve_fields";
    const req = new NextRequest(
      `http://localhost:3000/api/reservations/events?venueId=${venueId}`,
    );
    const res = await GET(req);
    const reader = res.body!.getReader();

    try {
      await reader.read(); // connected frame

      publishVenueAvailability(venueId, {
        type: "desk_reservation_released",
        deskId: "desk_pres_1",
        seatId: "seat_pres_2",
        userId: "user_pres_3",
        userName: "Alex Doe",
      });

      const chunk = await reader.read();
      expect(chunk.done).toBe(false);
      const frame = parseSseChunk(chunk.value);
      expect(frame.event).toBe("availability");
      expect(frame.data.type).toBe("desk_reservation_released");
      expect(frame.data.venueId).toBe(venueId);
      expect(frame.data.deskId).toBe("desk_pres_1");
      expect(frame.data.seatId).toBe("seat_pres_2");
      expect(frame.data.userId).toBe("user_pres_3");
      expect(frame.data.userName).toBe("Alex Doe");
      expect(frame.data.timestamp).toBeDefined();
    } finally {
      await reader.cancel();
    }
  });

  test("safely ignores malformed or unusable payloads without crashing the stream", async () => {
    let capturedListener: ((payload: string) => void) | null = null;
    const originalSubscribe = eventBusModule.subscribeVenueAvailability;
    jest
      .spyOn(eventBusModule, "subscribeVenueAvailability")
      .mockImplementation((vId, listener) => {
        capturedListener = listener;
        return originalSubscribe(vId, listener);
      });

    const venueId = "venue_malformed_test";
    const req = new NextRequest(
      `http://localhost:3000/api/reservations/events?venueId=${venueId}`,
    );
    const res = await GET(req);
    const reader = res.body!.getReader();

    try {
      await reader.read(); // connected frame

      expect(() => {
        capturedListener?.("invalid-json{{{");
        capturedListener?.(JSON.stringify(null));
        capturedListener?.(JSON.stringify("simple-string"));
        capturedListener?.(JSON.stringify([1, 2, 3]));
        capturedListener?.(JSON.stringify({}));
        capturedListener?.(JSON.stringify({ type: 123 }));
        capturedListener?.(JSON.stringify({ type: "" }));
      }).not.toThrow();

      // Ensure valid subsequent event is still handled
      publishVenueAvailability(venueId, {
        type: "desk_reservation_held",
        deskId: "desk_recovered",
      });

      const chunk = await reader.read();
      expect(chunk.done).toBe(false);
      const frame = parseSseChunk(chunk.value);
      expect(frame.event).toBe("availability");
      expect(frame.data.deskId).toBe("desk_recovered");
    } finally {
      await reader.cancel();
    }
  });

  test("cancelling the reader removes the subscription and clears the heartbeat timer", async () => {
    jest.useFakeTimers();
    const clearIntervalSpy = jest.spyOn(global, "clearInterval");

    let unsubscribed = false;
    const originalSubscribe = eventBusModule.subscribeVenueAvailability;
    jest
      .spyOn(eventBusModule, "subscribeVenueAvailability")
      .mockImplementation((vId, listener) => {
        const actualUnsubscribe = originalSubscribe(vId, listener);
        return () => {
          unsubscribed = true;
          actualUnsubscribe();
        };
      });

    const venueId = "venue_cancel_test";
    const req = new NextRequest(
      `http://localhost:3000/api/reservations/events?venueId=${venueId}`,
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(res.body).not.toBeNull();

    const reader = res.body!.getReader();

    // Read initial 'connected' SSE frame
    const firstChunk = await reader.read();
    expect(firstChunk.done).toBe(false);
    const frame = parseSseChunk(firstChunk.value);
    expect(frame.event).toBe("connected");
    expect(frame.data.venueId).toBe(venueId);

    // Cancel stream directly via reader.cancel() without firing req.signal abort
    await reader.cancel("Client navigated away");

    expect(unsubscribed).toBe(true);
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);

    // Advance clock past multiple 15s heartbeat cycles (45s total) -> must not throw on closed controller
    expect(() => {
      jest.advanceTimersByTime(45_000);
    }).not.toThrow();

    // Publishing events after cancel must be a safe no-op
    expect(() => {
      publishVenueAvailability(venueId, {
        type: "desk_reservation_held",
        venueId,
        availableSeats: 4,
        crowdLevel: "QUIET",
      });
    }).not.toThrow();
  });

  test("clears heartbeat interval when request.signal aborts", async () => {
    jest.useFakeTimers();
    const clearIntervalSpy = jest.spyOn(global, "clearInterval");
    const abortController = new AbortController();

    let unsubscribed = false;
    const originalSubscribe = eventBusModule.subscribeVenueAvailability;
    jest
      .spyOn(eventBusModule, "subscribeVenueAvailability")
      .mockImplementation((vId, listener) => {
        const actualUnsubscribe = originalSubscribe(vId, listener);
        return () => {
          unsubscribed = true;
          actualUnsubscribe();
        };
      });

    const venueId = "venue_abort_test";
    const req = new NextRequest(
      `http://localhost:3000/api/reservations/events?venueId=${venueId}`,
      { signal: abortController.signal },
    );
    const res = await GET(req);
    expect(res.status).toBe(200);

    abortController.abort();

    expect(unsubscribed).toBe(true);
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    expect(() => {
      jest.advanceTimersByTime(30_000);
    }).not.toThrow();
  });
});
