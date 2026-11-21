export type VectorClockMap = Record<string, number>;

class AsyncMutex {
  private chain: Promise<void> = Promise.resolve();

  async runExclusive<T>(fn: () => T | Promise<T>): Promise<T> {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const prev = this.chain;
    this.chain = prev.then(() => gate);

    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export class VectorClock {
  private readonly clock: Map<string, number>;
  private readonly mutex = new AsyncMutex();

  constructor(
    private readonly nodeId: string,
    initialClock: VectorClockMap = {}
  ) {
    if (!nodeId.trim()) {
      throw new Error('VectorClock requires a non-empty nodeId');
    }
    this.clock = new Map<string, number>(Object.entries(initialClock));
    if (!this.clock.has(this.nodeId)) {
      this.clock.set(this.nodeId, 0);
    }
  }

  private snapshot(): VectorClockMap {
    return Object.fromEntries(this.clock.entries());
  }

  getClock(): VectorClockMap {
    return this.snapshot();
  }

  async tick(): Promise<VectorClockMap> {
    return this.mutex.runExclusive(() => {
      const current = this.clock.get(this.nodeId) ?? 0;
      const next = current + 1;
      this.clock.set(this.nodeId, next);
      return this.snapshot();
    });
  }

  async merge(remoteClock: VectorClockMap): Promise<VectorClockMap> {
    return this.mutex.runExclusive(() => {
      for (const [peerId, peerCount] of Object.entries(remoteClock)) {
        const localCount = this.clock.get(peerId) ?? 0;
        if (peerCount > localCount) {
          this.clock.set(peerId, peerCount);
        }
      }
      const nextSelf = (this.clock.get(this.nodeId) ?? 0) + 1;
      this.clock.set(this.nodeId, nextSelf);
      return this.snapshot();
    });
  }
}