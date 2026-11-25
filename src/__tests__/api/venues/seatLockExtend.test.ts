/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { POST } from "@/app/api/venues/[venueId]/seats/[seatId]/lock/extend/route";
import {
  acquireSeatWebLock,
  resetMemorySeatLocks,
} from "@/lib/locks/seatHoldLock";
import { auth } from "@clerk/nextjs/server";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/redis", () => ({
  getRedis: jest.fn().mockReturnValue(null),
}));

const mockAuth = auth as unknown as jest.Mock;

describe("POST /api/venues/[venueId]/seats/[seatId]/lock/extend (#10017)", () => {
  const VENUE_ID = "venue-alpha";
  const SEAT_ID = "seat-10";

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-11-24T12:00:00.000Z"));
    resetMemorySeatLocks();
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: "user-a" });
  });

  afterEach(() => {
    resetMemorySeatLocks();
    jest.useRealTimers();
  });

  function createRequest(body: Record<string, unknown>) {
    return new NextRequest(
      `http://localhost/api/venues/${VENUE_ID}/seats/${SEAT_ID}/lock/extend`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
  }

  function callRoute(req: NextRequest) {
    return POST(req, {
      params: Promise.resolve({ venueId: VENUE_ID, seatId: SEAT_ID }),
    });
  }

  it("handles concurrent simultaneous extension requests: one 200 OK and one 409 Conflict", async () => {
    // 1. Acquire seat lock
    const acquireRes = await acquireSeatWebLock(
      VENUE_ID,
      SEAT_ID,
      "user-a",
      "Alice",
      300,
    );
    expect(acquireRes.success).toBe(true);
    const token = acquireRes.lock!.fencingToken;

    // 2. Dispatch two simultaneous extension requests with the same token
    const req1 = createRequest({ token });
    const req2 = createRequest({ token });

    const [res1, res2] = await Promise.all([callRoute(req1), callRoute(req2)]);

    const statuses = [res1.status, res2.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);

    const winnerRes = res1.status === 200 ? res1 : res2;
    const loserRes = res1.status === 409 ? res1 : res2;

    const winnerBody = await winnerRes.json();
    expect(winnerBody.success).toBe(true);
    expect(winnerBody.lock.version).toBe(acquireRes.lock!.version + 1);
    expect(winnerBody.lock.extensionUsed).toBe(true);

    const loserBody = await loserRes.json();
    expect(loserBody.code).toBe("CONFLICT");
    expect(loserBody.reason).toBe("ALREADY_EXTENDED");
  });

  it("returns 400 Bad Request when fencing token is missing", async () => {
    const req = createRequest({});
    const res = await callRoute(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_INPUT");
  });

  it("returns 401 Unauthorized when session is unauthenticated", async () => {
    mockAuth.mockResolvedValueOnce({ userId: null });
    const req = createRequest({ token: "some-token" });
    const res = await callRoute(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("UNAUTHORIZED");
  });

  it("returns 403 Forbidden when caller is not the lock owner", async () => {
    const acquireRes = await acquireSeatWebLock(
      VENUE_ID,
      SEAT_ID,
      "user-a",
      "Alice",
      300,
    );
    const token = acquireRes.lock!.fencingToken;

    mockAuth.mockResolvedValueOnce({ userId: "user-b" });
    const req = createRequest({ token });
    const res = await callRoute(req);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("FORBIDDEN");
  });

  it("returns 404 Not Found when lock does not exist or has expired", async () => {
    const req = createRequest({ token: "expired-or-missing-token" });
    const res = await callRoute(req);

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.reason).toBe("NOT_FOUND");
  });

  it("returns 409 Conflict when remaining TTL is <= 60 seconds", async () => {
    const acquireRes = await acquireSeatWebLock(
      VENUE_ID,
      SEAT_ID,
      "user-a",
      "Alice",
      61,
    );
    const token = acquireRes.lock!.fencingToken;

    // Advance 2 seconds so remaining is 59s (<= 60s)
    jest.advanceTimersByTime(2_000);

    const req = createRequest({ token });
    const res = await callRoute(req);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.reason).toBe("TOO_CLOSE_TO_EXPIRY");
  });
});
