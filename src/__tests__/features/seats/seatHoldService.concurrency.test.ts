import {
  SEAT_CHECKOUT_GRACE_MS,
  SEAT_HOLD_CHECKOUT_ABORT_LUA,
  SEAT_HOLD_CHECKOUT_CLAIM_LUA,
  SEAT_HOLD_FINALIZE_LUA,
  confirmSeatPayment,
  getSeatCheckoutMarkerKey,
  type SeatHoldRedis,
  type SeatHoldTransactionRunner,
} from "@/features/seats/seatHoldService";
import {
  acquireSeatWebLock,
  getLockKey,
  getSeatWebLock,
} from "@/lib/locks/seatHoldLock";

jest.mock("@/lib/redis/keyspaceNotifications", () => ({
  getRedisKeyspaceManager: () => ({
    registerDeskTimer: jest.fn(),
    unregisterDeskTimer: jest.fn(),
  }),
}));

const VENUE = "venue-1";
const SEAT = "seat-1";
const HOLD_KEY = getLockKey(VENUE, SEAT);
const MARKER_KEY = getSeatCheckoutMarkerKey(VENUE, SEAT);

/**
 * In memory stand in for Redis. `eval` runs a JavaScript port of each Lua
 * script. Every call is synchronous inside, so it is atomic like a real EVAL.
 * `sweep()` removes keys whose TTL has elapsed, like Redis key expiry.
 */
class FakeRedis implements SeatHoldRedis {
  now = 1_000_000;
  private store = new Map<string, { value: string; expiresAt: number }>();
  failOn: string | null = null;

  seedHold(userId: string, ttlMs: number) {
    this.store.set(HOLD_KEY, {
      value: JSON.stringify({ userId, venueId: VENUE, seatId: SEAT }),
      expiresAt: this.now + ttlMs,
    });
  }

  has(key: string) {
    return this.store.has(key);
  }

  ttl(key: string) {
    const entry = this.store.get(key);
    return entry ? entry.expiresAt - this.now : null;
  }

  advance(ms: number) {
    this.now += ms;
  }

  sweep() {
    for (const [key, entry] of this.store) {
      if (entry.expiresAt <= this.now) this.store.delete(key);
    }
  }

  private owner(raw: string | undefined) {
    if (!raw) return null;
    try {
      return (JSON.parse(raw) as { userId?: string }).userId ?? null;
    } catch {
      return null;
    }
  }

  async eval(script: string, keys: string[], args: (string | number)[]) {
    if (this.failOn === script) throw new Error("redis unavailable");
    const [lockKey, markerKey] = keys;
    const userId = String(args[0]);

    if (script === SEAT_HOLD_CHECKOUT_CLAIM_LUA) {
      const hold = this.store.get(lockKey);
      if (!hold) return 0;
      if (this.owner(hold.value) !== userId) return -1;
      if (this.store.has(markerKey)) return -2;
      const grace = Number(args[1]);
      this.store.set(markerKey, { value: userId, expiresAt: this.now + grace });
      if (hold.expiresAt - this.now < grace) hold.expiresAt = this.now + grace;
      return 1;
    }

    if (script === SEAT_HOLD_FINALIZE_LUA) {
      const hold = this.store.get(lockKey);
      if (!hold) {
        this.store.delete(markerKey);
        return 0;
      }
      if (this.owner(hold.value) === userId) {
        this.store.delete(lockKey);
        this.store.delete(markerKey);
        return 1;
      }
      return 0;
    }

    if (script === SEAT_HOLD_CHECKOUT_ABORT_LUA) {
      if (this.store.get(markerKey)?.value === userId) {
        this.store.delete(markerKey);
        return 1;
      }
      return 0;
    }

    throw new Error("unexpected script");
  }
}

type FakeTx = { id: string };

function makeDb(options: {
  beforeCommit?: () => Promise<void> | void;
  afterCommit?: () => Promise<void> | void;
} = {}) {
  const calls: unknown[] = [];
  const db: SeatHoldTransactionRunner<FakeTx> = {
    async $transaction(fn, opts) {
      calls.push(opts);
      const result = await fn({ id: "tx-1" });
      await options.beforeCommit?.();
      await options.afterCommit?.();
      return result;
    },
  };
  return { db, calls };
}

const input = (persistReservation: (tx: FakeTx) => Promise<unknown>) => ({
  venueId: VENUE,
  seatId: SEAT,
  userId: "user-a",
  persistReservation,
});

describe("confirmSeatPayment concurrency (#9507)", () => {
  let redis: FakeRedis;

  beforeEach(() => {
    redis = new FakeRedis();
  });

  it("persists the reservation in a serializable transaction and releases the hold", async () => {
    redis.seedHold("user-a", 60_000);
    const { db, calls } = makeDb();
    const persist = jest.fn().mockResolvedValue({ bookingId: "b1" });

    const result = await confirmSeatPayment(input(persist), { redis, db });

    expect(result).toEqual({
      status: "CONFIRMED",
      reservation: { bookingId: "b1" },
      holdReleased: true,
    });
    expect(persist).toHaveBeenCalledWith({ id: "tx-1" });
    expect(calls[0]).toMatchObject({ isolationLevel: "Serializable" });
    expect(redis.has(HOLD_KEY)).toBe(false);
    expect(redis.has(MARKER_KEY)).toBe(false);
  });

  it("raises the hold TTL to the grace period when the claim starts", async () => {
    redis.seedHold("user-a", 2_000);
    let ttlDuringTx: number | null = null;
    const { db } = makeDb();

    await confirmSeatPayment(
      input(async () => {
        ttlDuringTx = redis.ttl(HOLD_KEY);
        return "ok";
      }),
      { redis, db },
    );

    expect(ttlDuringTx).toBe(SEAT_CHECKOUT_GRACE_MS);
  });

  it("survives a cleanup sweep that runs while the transaction is open", async () => {
    redis.seedHold("user-a", 5_000);
    const { db } = makeDb();
    const persist = jest.fn(async () => {
      // The original TTL has now elapsed and the sweeper runs.
      redis.advance(10_000);
      redis.sweep();
      expect(redis.has(HOLD_KEY)).toBe(true);
      return { bookingId: "b2" };
    });

    const result = await confirmSeatPayment(input(persist), { redis, db });

    expect(result.status).toBe("CONFIRMED");
    if (result.status === "CONFIRMED") expect(result.holdReleased).toBe(true);
    expect(redis.has(HOLD_KEY)).toBe(false);
  });

  it("reports HOLD_LOST without writing when the sweep already removed the hold", async () => {
    redis.seedHold("user-a", 5_000);
    redis.advance(10_000);
    redis.sweep();
    const { db } = makeDb();
    const persist = jest.fn();

    const result = await confirmSeatPayment(input(persist), { redis, db });

    expect(result).toEqual({ status: "HOLD_LOST", reason: "MISSING" });
    expect(persist).not.toHaveBeenCalled();
  });

  it("does not throw when the hold disappears between commit and release", async () => {
    redis.seedHold("user-a", 5_000);
    const { db } = makeDb({
      afterCommit: () => {
        // Something else removes the key after the booking committed.
        redis.advance(SEAT_CHECKOUT_GRACE_MS + 1);
        redis.sweep();
      },
    });

    const result = await confirmSeatPayment(
      input(async () => ({ bookingId: "b3" })),
      { redis, db },
    );

    expect(result).toEqual({
      status: "CONFIRMED",
      reservation: { bookingId: "b3" },
      holdReleased: false,
    });
  });

  it("only lets the active holder finalize, and leaves another holder's lock intact", async () => {
    redis.seedHold("user-b", 60_000);
    const { db } = makeDb();
    const persist = jest.fn();

    const result = await confirmSeatPayment(input(persist), { redis, db });

    expect(result).toEqual({ status: "HOLD_LOST", reason: "NOT_OWNER" });
    expect(persist).not.toHaveBeenCalled();
    expect(redis.has(HOLD_KEY)).toBe(true);
    expect(redis.has(MARKER_KEY)).toBe(false);
  });

  it("rejects a simultaneous second checkout by the same holder", async () => {
    redis.seedHold("user-a", 60_000);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { db } = makeDb();
    const persist = jest.fn(async () => {
      await gate;
      return { bookingId: "b4" };
    });

    const first = confirmSeatPayment(input(persist), { redis, db });
    await Promise.resolve();
    const second = await confirmSeatPayment(input(persist), { redis, db });

    expect(second).toEqual({ status: "IN_PROGRESS" });

    release();
    const firstResult = await first;
    expect(firstResult.status).toBe("CONFIRMED");
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("keeps the hold and clears the marker when persisting fails, so the holder can retry", async () => {
    redis.seedHold("user-a", 60_000);
    const { db } = makeDb();
    const failing = jest.fn().mockRejectedValue(new Error("db down"));

    await expect(
      confirmSeatPayment(input(failing), { redis, db }),
    ).rejects.toThrow("db down");

    expect(redis.has(HOLD_KEY)).toBe(true);
    expect(redis.has(MARKER_KEY)).toBe(false);

    const retry = await confirmSeatPayment(
      input(async () => ({ bookingId: "b5" })),
      { redis, db },
    );
    expect(retry.status).toBe("CONFIRMED");
  });

  it("still returns CONFIRMED when Redis fails during the final release", async () => {
    redis.seedHold("user-a", 60_000);
    redis.failOn = SEAT_HOLD_FINALIZE_LUA;
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const { db } = makeDb();

    const result = await confirmSeatPayment(
      input(async () => ({ bookingId: "b6" })),
      { redis, db },
    );

    expect(result).toEqual({
      status: "CONFIRMED",
      reservation: { bookingId: "b6" },
      holdReleased: false,
    });
    warn.mockRestore();
  });

  it("requires venue, seat and user ids", async () => {
    const { db } = makeDb();
    await expect(
      confirmSeatPayment(
        { venueId: "", seatId: SEAT, userId: "u", persistReservation: jest.fn() },
        { redis, db },
      ),
    ).rejects.toThrow(TypeError);
  });

  describe("in memory fallback (no Redis)", () => {
    it("confirms and releases the active holder's lock", async () => {
      await acquireSeatWebLock("venue-mem", "seat-mem", "user-a", "Ann", 60);
      const { db } = makeDb();

      const result = await confirmSeatPayment(
        { ...input(async () => "ok"), venueId: "venue-mem", seatId: "seat-mem" },
        { redis: null, db },
      );

      expect(result).toEqual({
        status: "CONFIRMED",
        reservation: "ok",
        holdReleased: true,
      });
      expect(await getSeatWebLock("venue-mem", "seat-mem")).toBeNull();
    });

    it("rejects a non owner and a missing hold", async () => {
      await acquireSeatWebLock("venue-mem2", "seat-mem2", "user-b", "Bob", 60);
      const { db } = makeDb();
      const persist = jest.fn();

      const notOwner = await confirmSeatPayment(
        { ...input(persist), venueId: "venue-mem2", seatId: "seat-mem2" },
        { redis: null, db },
      );
      const missing = await confirmSeatPayment(
        { ...input(persist), venueId: "venue-none", seatId: "seat-none" },
        { redis: null, db },
      );

      expect(notOwner).toEqual({ status: "HOLD_LOST", reason: "NOT_OWNER" });
      expect(missing).toEqual({ status: "HOLD_LOST", reason: "MISSING" });
      expect(persist).not.toHaveBeenCalled();
    });
  });
});
