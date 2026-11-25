/**
 * bookingSyncRouteCausal.test.ts
 * Tests for POST /api/bookings/sync with causal dependency buffering and
 * vector clock monotonicity (#9636).
 */

import {
  POST,
  resetBookingMutationQueues,
} from "@/app/api/bookings/sync/route";
import { NextRequest } from "next/server";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/bookings/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/bookings/sync - Causal Dependency Buffering", () => {
  beforeEach(() => {
    resetBookingMutationQueues();
  });

  it("returns 400 if draftId or draftPayload is missing", async () => {
    const res1 = await POST(
      makeRequest({ draftPayload: { status: "PENDING" } }),
    );
    expect(res1.status).toBe(400);

    const res2 = await POST(makeRequest({ draftId: "draft-1" }));
    expect(res2.status).toBe(400);
  });

  it("applies sequential in-order mutations and advances state", async () => {
    const res = await POST(
      makeRequest({
        draftId: "booking-1",
        clientId: "nomad-1",
        vectorClock: { "nomad-1": 1 },
        draftPayload: { seatId: "desk-1", status: "DRAFT" },
      }),
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.action).toBe("MERGED");
    expect(data.resolvedPayload).toMatchObject({
      seatId: "desk-1",
      status: "DRAFT",
    });
    expect(data.vectorClock["nomad-1"]).toBe(1);
    expect(data.bufferedCount).toBe(0);
  });

  it("buffers out-of-order mutation B and cascades both when predecessor A arrives (#9636)", async () => {
    const draftId = "booking-out-of-order";

    // 1. Mutation B arrives first (network reordering)
    const resB = await POST(
      makeRequest({
        mutationId: "mut-B",
        draftId,
        clientId: "nomad-1",
        vectorClock: { "nomad-1": 2 },
        draftPayload: { seatId: "seat-selected", time: "10:00" },
      }),
    );

    expect(resB.status).toBe(200);
    const dataB = await resB.json();
    expect(dataB.success).toBe(true);
    expect(dataB.action).toBe("BUFFERED");
    expect(dataB.buffered).toBe(true);
    expect(dataB.bufferedCount).toBe(1);

    // 2. Predecessor Mutation A arrives
    const resA = await POST(
      makeRequest({
        mutationId: "mut-A",
        draftId,
        clientId: "nomad-1",
        vectorClock: { "nomad-1": 1 },
        draftPayload: { venueId: "venue-berlin", status: "DRAFT" },
      }),
    );

    expect(resA.status).toBe(200);
    const dataA = await resA.json();
    expect(dataA.success).toBe(true);
    expect(dataA.action).toBe("MERGED");
    expect(dataA.appliedMutations).toHaveLength(2);
    expect(dataA.appliedMutations[0].id).toBe("mut-A");
    expect(dataA.appliedMutations[1].id).toBe("mut-B");

    // Both payloads merged causally
    expect(dataA.resolvedPayload).toMatchObject({
      venueId: "venue-berlin",
      seatId: "seat-selected",
      time: "10:00",
    });
    expect(dataA.vectorClock["nomad-1"]).toBe(2);
    expect(dataA.bufferedCount).toBe(0);
  });

  it("detects duplicate or stale mutations and avoids duplicate state transitions", async () => {
    const draftId = "booking-dup-check";

    const reqBody = {
      mutationId: "mut-once",
      draftId,
      clientId: "nomad-1",
      vectorClock: { "nomad-1": 1 },
      draftPayload: { status: "CONFIRMED" },
    };

    // First delivery
    const res1 = await POST(makeRequest(reqBody));
    expect((await res1.json()).action).toBe("MERGED");

    // Retransmission of exact same mutation
    const res2 = await POST(makeRequest(reqBody));
    const data2 = await res2.json();
    expect(data2.action).toBe("DUPLICATE");
    expect(data2.bufferedCount).toBe(0);
  });

  it("handles multiple sequential legacy requests without explicit vectorClock or mutationId", async () => {
    const draftId = "legacy-sync-flow";

    const res1 = await POST(
      makeRequest({
        draftId,
        draftPayload: { step: 1 },
      }),
    );
    expect(res1.status).toBe(200);
    const data1 = await res1.json();
    expect(data1.action).toBe("MERGED");
    expect(data1.newVersion).toBe(1);

    const res2 = await POST(
      makeRequest({
        draftId,
        draftPayload: { step: 2 },
      }),
    );
    expect(res2.status).toBe(200);
    const data2 = await res2.json();
    expect(data2.action).toBe("MERGED");
    expect(data2.newVersion).toBe(2);
    expect(data2.resolvedPayload).toMatchObject({ step: 2 });
  });
});
