/**
 * Redis-backed seat hold lock: atomicity regression tests.
 *
 * The Redis path used to be a check-then-act sequence (SET NX, GET, SET / GET,
 * DEL). Because the key can expire between those round trips, an expired holder
 * could overwrite (renew) or delete the lock of whoever acquired the seat next,
 * and two users could both be told they hold the same seat.
 *
 * Acquire/renew and release are now single Lua scripts. The fake Redis below
 * executes them with the same semantics inside one synchronous step (as Redis
 * does), and records which commands the library used.
 */

jest.mock("@/lib/redis", () => {
  const state: { redis: any } = { redis: null };
  return { getRedis: () => state.redis, __state: state };
});

import {
  acquireSeatWebLock,
  releaseSeatWebLock,
  getSeatWebLock,
  resetMemorySeatLocks,
  SEAT_LOCK_ACQUIRE_LUA,
  SEAT_LOCK_RELEASE_LUA,
} from "@/lib/locks/seatHoldLock";

const { __state: redisState } = jest.requireMock("@/lib/redis") as {
  __state: { redis: any };
};

const VENUE = "venue-alpha";
const SEAT = "seat-10";
const KEY = `seat:hold:${VENUE}:${SEAT}`;

let clock = 1_800_000_000_000;

function makeFakeRedis() {
  const store = new Map<string, { value: string; expiresAt: number }>();
  const calls: string[] = [];

  const live = (key: string) => {
    const entry = store.get(key);
    if (!entry) return null;
    if (clock >= entry.expiresAt) {
      store.delete(key);
      return null;
    }
    return entry;
  };

  const redis = {
    store,
    calls,
    async get(key: string) {
      calls.push("get");
      return live(key)?.value ?? null;
    },
    async set(key: string, value: string, opts: { nx?: boolean; ex?: number } = {}) {
      calls.push("set");
      if (opts.nx && live(key)) return null;
      store.set(key, { value, expiresAt: clock + (opts.ex ?? 1e9) * 1000 });
      return "OK";
    },
    async del(key: string) {
      calls.push("del");
      return store.delete(key) ? 1 : 0;
    },
    // Emulates the two Lua scripts; each runs atomically (no awaits inside).
    async eval(script: string, keys: string[], args: string[]) {
      calls.push("eval");
      const key = keys[0];
      const current = live(key);

      if (script === SEAT_LOCK_ACQUIRE_LUA) {
        const [userId, payload, ttl] = args;
        if (!current) {
          store.set(key, { value: payload, expiresAt: clock + Number(ttl) * 1000 });
          return [1, payload];
        }
        const held = JSON.parse(current.value);
        if (held.userId === userId) {
          const renewed = JSON.parse(payload);
          renewed.version = (held.version || 1) + 1;
          if (held.heldAt) renewed.heldAt = held.heldAt;
          const encoded = JSON.stringify(renewed);
          store.set(key, { value: encoded, expiresAt: clock + Number(ttl) * 1000 });
          return [1, encoded];
        }
        return [0, current.value];
      }

      if (script === SEAT_LOCK_RELEASE_LUA) {
        if (current && JSON.parse(current.value).userId === args[0]) {
          store.delete(key);
          return 1;
        }
        return 0;
      }

      throw new Error("unexpected script");
    },
  };
  return redis;
}

const ownerOf = (redis: ReturnType<typeof makeFakeRedis>) => {
  const entry = redis.store.get(KEY);
  return entry ? JSON.parse(entry.value).userId : null;
};

describe("seat hold lock (Redis path) is atomic", () => {
  let nowSpy: jest.SpyInstance;
  let redis: ReturnType<typeof makeFakeRedis>;

  beforeEach(() => {
    clock = 1_800_000_000_000;
    nowSpy = jest.spyOn(Date, "now").mockImplementation(() => clock);
    resetMemorySeatLocks();
    redis = makeFakeRedis();
    redisState.redis = redis;
  });

  afterEach(() => {
    redisState.redis = null;
    nowSpy.mockRestore();
  });

  it("decides acquire, renew, reject and release with one atomic command each", async () => {
    await acquireSeatWebLock(VENUE, SEAT, "user-1", "Alice", 300);
    await acquireSeatWebLock(VENUE, SEAT, "user-1", "Alice", 300); // renew
    await acquireSeatWebLock(VENUE, SEAT, "user-2", "Bob", 300); // rejected
    await releaseSeatWebLock(VENUE, SEAT, "user-1");

    // No separate GET / SET / DEL round trips => no window to race in.
    expect(redis.calls).toEqual(["eval", "eval", "eval", "eval"]);
  });

  it("lets exactly one of several concurrent users acquire the seat", async () => {
    const results = await Promise.all(
      ["a", "b", "c", "d"].map((user) =>
        acquireSeatWebLock(VENUE, SEAT, user, user, 300),
      ),
    );

    expect(results.filter((r) => r.success)).toHaveLength(1);
  });

  it("renews for the same user, keeping heldAt and bumping version", async () => {
    const first = await acquireSeatWebLock(VENUE, SEAT, "user-1", "Alice", 300);
    clock += 60_000;
    const renewed = await acquireSeatWebLock(VENUE, SEAT, "user-1", "Alice", 300);

    expect(renewed.success).toBe(true);
    expect(renewed.lock?.version).toBe(2);
    expect(renewed.lock?.heldAt).toBe(first.lock?.heldAt);
    expect(renewed.lock?.expiresAt).toBe(clock + 300_000);
  });

  it("rejects a second user and reports who holds the seat", async () => {
    await acquireSeatWebLock(VENUE, SEAT, "user-1", "Alice", 300);
    const result = await acquireSeatWebLock(VENUE, SEAT, "user-2", "Bob", 300);

    expect(result.success).toBe(false);
    expect(result.reason).toBe("ALREADY_HELD");
    expect(result.heldBy).toBe("user-1");
    expect(result.heldByName).toBe("Alice");
    expect(result.remainingSeconds).toBeGreaterThan(0);
  });

  it("never lets an expired holder release the next owner's lock", async () => {
    await acquireSeatWebLock(VENUE, SEAT, "user-1", "Alice", 10);
    clock += 11_000; // Alice's lock expires
    const bob = await acquireSeatWebLock(VENUE, SEAT, "user-2", "Bob", 300);
    expect(bob.success).toBe(true);

    expect(await releaseSeatWebLock(VENUE, SEAT, "user-1")).toBe(false);
    expect(ownerOf(redis)).toBe("user-2");
    expect((await getSeatWebLock(VENUE, SEAT))?.userId).toBe("user-2");
  });

  it("never lets an expired holder renew over the next owner's lock", async () => {
    await acquireSeatWebLock(VENUE, SEAT, "user-1", "Alice", 10);
    clock += 11_000;
    await acquireSeatWebLock(VENUE, SEAT, "user-2", "Bob", 300);

    const late = await acquireSeatWebLock(VENUE, SEAT, "user-1", "Alice", 10);

    expect(late.success).toBe(false);
    expect(late.heldBy).toBe("user-2");
    expect(ownerOf(redis)).toBe("user-2");
  });

  it("only the owner can release", async () => {
    await acquireSeatWebLock(VENUE, SEAT, "user-1", "Alice", 300);

    expect(await releaseSeatWebLock(VENUE, SEAT, "user-2")).toBe(false);
    expect(await releaseSeatWebLock(VENUE, SEAT, "user-1")).toBe(true);
    expect(ownerOf(redis)).toBeNull();
  });
});
