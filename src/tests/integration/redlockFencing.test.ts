interface RedisNode {
  id: string;
  healthy: boolean;
  locks: Map<string, { owner: string; expiresAt: number }>;
}

interface SeatRecord {
  seatId: string;
  holder: string | null;
  fencingToken: number;
}

class RedlockQuorum {
  private epochCounter = 0;

  constructor(
    private readonly nodes: RedisNode[],
    private readonly ttlMs = 5000
  ) {}

  private get quorum(): number {
    return Math.floor(this.nodes.length / 2) + 1;
  }

  acquire(resource: string, owner: string, now = Date.now()): {
    acquired: boolean;
    fencingToken?: number;
  } {
    let votes = 0;

    for (const node of this.nodes) {
      if (!node.healthy) continue;

      const existing = node.locks.get(resource);
      if (!existing || existing.expiresAt <= now) {
        node.locks.set(resource, { owner, expiresAt: now + this.ttlMs });
        votes += 1;
      } else if (existing.owner === owner) {
        node.locks.set(resource, { owner, expiresAt: now + this.ttlMs });
        votes += 1;
      }
    }

    if (votes < this.quorum) {
      for (const node of this.nodes) {
        const current = node.locks.get(resource);
        if (current?.owner === owner) {
          node.locks.delete(resource);
        }
      }
      return { acquired: false };
    }

    this.epochCounter += 1;
    return { acquired: true, fencingToken: this.epochCounter };
  }
}

class FencedSeatStore {
  private seats = new Map<string, SeatRecord>();

  constructor(seatId: string) {
    this.seats.set(seatId, { seatId, holder: null, fencingToken: 0 });
  }

  reserveSeat(seatId: string, holder: string, fencingToken: number): boolean {
    const record = this.seats.get(seatId);
    if (!record) return false;

    if (fencingToken <= record.fencingToken) {
      return false;
    }

    this.seats.set(seatId, {
      seatId,
      holder,
      fencingToken,
    });
    return true;
  }

  getSeat(seatId: string): SeatRecord | undefined {
    return this.seats.get(seatId);
  }
}

describe('Redlock quorum & monotonic fencing token integration', () => {
  const createNodes = (count = 5): RedisNode[] =>
    Array.from({ length: count }, (_, idx) => ({
      id: `redis-${idx + 1}`,
      healthy: true,
      locks: new Map(),
    }));

  it('rejects lock acquisition when fewer than quorum nodes are healthy', () => {
    const nodes = createNodes(5); // quorum = 3
    nodes[2].healthy = false;
    nodes[3].healthy = false;
    nodes[4].healthy = false; // only 2 healthy

    const redlock = new RedlockQuorum(nodes);
    const result = redlock.acquire('seat-hold:A1', 'worker-1', 1000);

    expect(result.acquired).toBe(false);
    expect(result.fencingToken).toBeUndefined();
  });

  it('rejects stale writes with an older fencing token after lock TTL expiry and takeover', () => {
    const nodes = createNodes(3); // quorum = 2
    const redlock = new RedlockQuorum(nodes, 1000);
    const store = new FencedSeatStore('seat-A1');

    const firstLease = redlock.acquire('seat-hold:seat-A1', 'slow-worker', 1000);
    expect(firstLease.acquired).toBe(true);
    expect(firstLease.fencingToken).toBe(1);

    const firstWriteOk = store.reserveSeat('seat-A1', 'slow-worker', firstLease.fencingToken!);
    expect(firstWriteOk).toBe(true);

    // TTL passes; new worker acquires lock with a higher fencing token
    const secondLease = redlock.acquire('seat-hold:seat-A1', 'active-worker', 2500);
    expect(secondLease.acquired).toBe(true);
    expect(secondLease.fencingToken).toBe(2);

    const secondWriteOk = store.reserveSeat('seat-A1', 'active-worker', secondLease.fencingToken!);
    expect(secondWriteOk).toBe(true);

    // Stale worker attempts a delayed write using old token 1
    const staleWriteOk = store.reserveSeat('seat-A1', 'slow-worker', firstLease.fencingToken!);
    expect(staleWriteOk).toBe(false);
    expect(store.getSeat('seat-A1')).toEqual({
      seatId: 'seat-A1',
      holder: 'active-worker',
      fencingToken: 2,
    });
  });
});