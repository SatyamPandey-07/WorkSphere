/**
 * @jest-environment node
 */
import {
  acquireDistributedLock,
  releaseDistributedLock,
  resetRedlock,
  setRedlockNodes,
  RedlockNode,
  REDLOCK_RELEASE_LUA,
} from "@/lib/locks/distributedRedlock";

class FakeRedlockNode implements RedlockNode {
  readonly store = new Map<string, string>();

  down = false;
  delayMs = 0;
  setCalls = 0;
  releaseCalls = 0;

  async set(
    key: string,
    value: string,
    _options: { nx: true; px: number },
  ): Promise<unknown> {
    this.setCalls += 1;
    if (this.down) {
      throw new Error("node unavailable");
    }
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    if (this.store.has(key)) {
      return null;
    }
    this.store.set(key, value);
    return "OK";
  }

  async eval(
    _script: string,
    keys: string[],
    args: string[],
  ): Promise<unknown> {
    this.releaseCalls += 1;
    if (this.down) {
      throw new Error("node unavailable");
    }
    const key = keys[0];
    const lockValue = args[0];
    if (this.store.get(key) === lockValue) {
      this.store.delete(key);
      return 1;
    }
    return 0;
  }
}

function buildNodes(count: number): FakeRedlockNode[] {
  return Array.from({ length: count }, () => new FakeRedlockNode());
}

describe("distributedRedlock", () => {
  afterEach(() => {
    resetRedlock();
  });

  it("acquires the lock when a majority of nodes agree", async () => {
    const nodes = buildNodes(5);
    nodes[3].down = true;
    nodes[4].down = true;
    setRedlockNodes(nodes);

    const result = await acquireDistributedLock("desk:101:seat:5", 5_000);

    expect(result).toMatchObject({
      success: true,
      acquiredNodes: 3,
      quorum: 3,
      nodeCount: 5,
      usedFallback: false,
    });
    expect(result.lockValue).toEqual(expect.any(String));
    expect(result.validUntil).toBeGreaterThan(Date.now());
    expect(nodes[0].store.size).toBe(1);
    expect(nodes[1].store.size).toBe(1);
    expect(nodes[2].store.size).toBe(1);
    expect(nodes[3].store.size).toBe(0);
    expect(nodes[4].store.size).toBe(0);
  });

  it("fails and unwinds partial acquisitions when quorum is not reached", async () => {
    const nodes = buildNodes(5);
    nodes[2].down = true;
    nodes[3].down = true;
    nodes[4].down = true;
    setRedlockNodes(nodes);

    const result = await acquireDistributedLock("desk:101:seat:6", 5_000);

    expect(result.success).toBe(false);
    expect(result.acquiredNodes).toBe(2);
    expect(result.quorum).toBe(3);
    expect(result.reason).toBe("QUORUM_NOT_REACHED");
    expect(nodes[0].store.size).toBe(0);
    expect(nodes[1].store.size).toBe(0);
    expect(nodes[0].releaseCalls).toBeGreaterThan(0);
    expect(nodes[1].releaseCalls).toBeGreaterThan(0);
  });

  it("rejects the second of two concurrent acquisitions of the same key", async () => {
    const nodes = buildNodes(3);
    setRedlockNodes(nodes);

    const [first, second] = await Promise.all([
      acquireDistributedLock("desk:202:seat:1", 5_000),
      acquireDistributedLock("desk:202:seat:1", 5_000),
    ]);

    const wins = [first, second].filter((entry) => entry.success);
    expect(wins).toHaveLength(1);
    expect(wins[0].acquiredNodes).toBe(3);
    expect(new Set([first.lockValue, second.lockValue]).size).toBe(2);
  });

  it("releases only when the lock value matches (compare-and-delete)", async () => {
    const nodes = buildNodes(3);
    setRedlockNodes(nodes);

    const acquired = await acquireDistributedLock("desk:303:seat:2", 5_000);
    expect(acquired.success).toBe(true);
    expect(acquired.lockValue).toEqual(expect.any(String));

    const wrongRelease = await releaseDistributedLock(
      "desk:303:seat:2",
      "not-the-owner",
    );
    expect(wrongRelease).toBe(false);
    expect(nodes[0].store.size).toBe(1);

    const released = await releaseDistributedLock(
      "desk:303:seat:2",
      acquired.lockValue as string,
    );
    expect(released).toBe(true);
    for (const node of nodes) {
      expect(node.store.size).toBe(0);
    }
  });

  it("subtracts the configured clock-drift budget from the TTL", async () => {
    const nodes = buildNodes(3);
    setRedlockNodes(nodes);

    const result = await acquireDistributedLock("desk:404:seat:3", 5_000);

    expect(result.success).toBe(true);
    expect(result.driftMs).toBeCloseTo(52, 5);
    const remaining = (result.validUntil as number) - Date.now();
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(5_000 - 52);
  });

  it("fails when node latency consumes the lock validity window", async () => {
    const nodes = buildNodes(3);
    for (const node of nodes) {
      node.delayMs = 30;
    }
    setRedlockNodes(nodes);

    const result = await acquireDistributedLock("desk:505:seat:4", 10, {
      nodeTimeoutMs: 100,
    });

    expect(result.success).toBe(false);
    expect(result.acquiredNodes).toBe(3);
    expect(result.reason).toBe("QUORUM_NOT_REACHED");
    expect(result.elapsedMs).toBeGreaterThanOrEqual(25);
    for (const node of nodes) {
      expect(node.store.size).toBe(0);
    }
  });

  it("falls back to an in-memory mutex when fewer than three nodes exist", async () => {
    setRedlockNodes([]);

    const first = await acquireDistributedLock("desk:606:seat:5", 2_000);
    expect(first).toMatchObject({
      success: true,
      usedFallback: true,
      quorum: 1,
      acquiredNodes: 1,
    });
    expect(first.lockValue).toEqual(expect.any(String));

    const second = await acquireDistributedLock("desk:606:seat:5", 2_000);
    expect(second.success).toBe(false);
    expect(second.reason).toBe("ALREADY_HELD");
    expect(second.usedFallback).toBe(true);

    expect(
      await releaseDistributedLock("desk:606:seat:5", "wrong-owner"),
    ).toBe(false);
    expect(
      await releaseDistributedLock(
        "desk:606:seat:5",
        first.lockValue as string,
      ),
    ).toBe(true);
    expect(
      await releaseDistributedLock(
        "desk:606:seat:5",
        first.lockValue as string,
      ),
    ).toBe(false);
  });

  it("allows a fresh acquisition after the in-memory TTL expires", async () => {
    setRedlockNodes([]);

    const first = await acquireDistributedLock("desk:707:seat:6", 20);
    expect(first.success).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 30));

    const second = await acquireDistributedLock("desk:707:seat:6", 20);
    expect(second.success).toBe(true);
    expect(second.lockValue).not.toBe(first.lockValue);
  });

  it("validates the resource key and ttl", async () => {
    const nodes = buildNodes(3);
    setRedlockNodes(nodes);

    await expect(acquireDistributedLock("", 1_000)).resolves.toMatchObject({
      success: false,
      reason: "INVALID_ARGUMENT",
    });
    await expect(
      acquireDistributedLock("desk:808:seat:7", 0),
    ).resolves.toMatchObject({
      success: false,
      reason: "INVALID_ARGUMENT",
    });
    await expect(
      acquireDistributedLock("desk:808:seat:7", Number.NaN),
    ).resolves.toMatchObject({
      success: false,
      reason: "INVALID_ARGUMENT",
    });
  });

  it("exposes a compare-and-delete release script", () => {
    expect(REDLOCK_RELEASE_LUA).toContain("redis.call('GET', KEYS[1])");
    expect(REDLOCK_RELEASE_LUA).toContain("redis.call('DEL', KEYS[1])");
  });
});
