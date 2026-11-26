import { describe, it, expect, beforeEach } from "@jest/globals";
import {
  extendSeatHoldWithFenceToken,
  SEAT_HOLD_EXTEND_FENCE_LUA,
  type SeatHoldRedis,
} from "@/features/seats/seatHoldService";

/**
 * In-memory atomic mock simulating Redis Lua execution for SEAT_HOLD_EXTEND_FENCE_LUA.
 */
function createMockFenceRedis(initialStore: Record<string, string> = {}) {
  const store = new Map<string, { value: string; ttl: number }>();
  for (const [k, v] of Object.entries(initialStore)) {
    store.set(k, { value: v, ttl: 300 });
  }

  const redis: SeatHoldRedis & { getRaw: (k: string) => string | undefined } = {
    getRaw(k: string) {
      return store.get(k)?.value;
    },
    async eval(script: string, keys: string[], args: (string | number)[]) {
      expect(script).toBe(SEAT_HOLD_EXTEND_FENCE_LUA);
      const key = keys[0];
      const [userId, incomingTokenStr, newExpiresAtStr, ttlStr] = args.map(String);

      const entry = store.get(key);
      if (!entry) return [0, "MISSING"];

      const decoded = JSON.parse(entry.value) as Record<string, unknown>;
      if (decoded.userId !== userId) return [-1, "NOT_OWNER"];

      const incomingToken = Number(incomingTokenStr);
      if (!Number.isFinite(incomingToken) || incomingToken <= 0) {
        return [-3, "INVALID_TOKEN"];
      }

      const currentToken = Number(decoded.fencingToken) || 0;
      if (incomingToken <= currentToken) {
        return [-2, "STALE_TOKEN", String(currentToken)];
      }

      decoded.fencingToken = String(incomingToken);
      decoded.expiresAt = Number(newExpiresAtStr);
      decoded.version = (Number(decoded.version) || 1) + 1;

      const updated = JSON.stringify(decoded);
      store.set(key, { value: updated, ttl: Number(ttlStr) });
      return [1, updated];
    },
  };

  return redis;
}

describe("extendSeatHoldWithFenceToken (Monotonic Fencing Enforcement)", () => {
  const venueId = "venue-101";
  const seatId = "seat-A1";
  const userId = "user-alice";
  const lockKey = `seat:hold:${venueId}:${seatId}`;

  let initialLockJson: string;

  beforeEach(() => {
    initialLockJson = JSON.stringify({
      venueId,
      seatId,
      userId,
      heldAt: 1700000000000,
      expiresAt: 1700000300000,
      version: 1,
      fencingToken: "10",
    });
  });

  it("extends the lease when incoming fence token is strictly greater than current token", async () => {
    const redis = createMockFenceRedis({ [lockKey]: initialLockJson });

    const res = await extendSeatHoldWithFenceToken(
      { venueId, seatId, userId, fenceToken: 11, ttlSeconds: 300 },
      { redis },
    );

    expect(res.status).toBe("EXTENDED");
    if (res.status === "EXTENDED") {
      expect(res.fencingToken).toBe("11");
      expect(res.lock.version).toBe(2);
    }
  });

  it("rejects extension when incoming fence token is equal to current token", async () => {
    const redis = createMockFenceRedis({ [lockKey]: initialLockJson });

    const res = await extendSeatHoldWithFenceToken(
      { venueId, seatId, userId, fenceToken: 10, ttlSeconds: 300 },
      { redis },
    );

    expect(res).toEqual({
      status: "REJECTED",
      reason: "STALE_TOKEN",
      currentFencingToken: "10",
    });
  });

  it("rejects out-of-order stale fence token after a newer extension already succeeded", async () => {
    const redis = createMockFenceRedis({ [lockKey]: initialLockJson });

    // Newer request (token 15) arrives first and succeeds
    const newerPromise = extendSeatHoldWithFenceToken(
      { venueId, seatId, userId, fenceToken: 15, ttlSeconds: 400 },
      { redis },
    );

    // Delayed/interleaved older request (token 12) arrives after token 15
    const stalePromise = extendSeatHoldWithFenceToken(
      { venueId, seatId, userId, fenceToken: 12, ttlSeconds: 120 },
      { redis },
    );

    const [newerRes, staleRes] = await Promise.all([newerPromise, stalePromise]);

    expect(newerRes.status).toBe("EXTENDED");
    expect(staleRes).toEqual({
      status: "REJECTED",
      reason: "STALE_TOKEN",
      currentFencingToken: "15",
    });

    // Verify stored lock still holds token 15 and was not overwritten by stale token 12
    const stored = JSON.parse(redis.getRaw(lockKey)!);
    expect(stored.fencingToken).toBe("15");
    expect(stored.version).toBe(2);
  });

  it("rejects extension if lock is held by a different user", async () => {
    const redis = createMockFenceRedis({ [lockKey]: initialLockJson });

    const res = await extendSeatHoldWithFenceToken(
      { venueId, seatId, userId: "user-mallory", fenceToken: 20 },
      { redis },
    );

    expect(res).toEqual({
      status: "REJECTED",
      reason: "NOT_OWNER",
    });
  });

  it("rejects extension if lock does not exist or has expired", async () => {
    const redis = createMockFenceRedis({});

    const res = await extendSeatHoldWithFenceToken(
      { venueId, seatId, userId, fenceToken: 11 },
      { redis },
    );

    expect(res).toEqual({
      status: "REJECTED",
      reason: "MISSING",
    });
  });
});