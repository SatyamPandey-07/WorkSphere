import {
  AwarenessCompactor,
  PeerAwarenessEntry,
} from '../../../lib/crdt/awarenessCompactor';

describe('AwarenessCompactor', () => {
  let compactor: AwarenessCompactor<{ user: string; cursor?: { x: number; y: number } }>;

  beforeEach(() => {
    jest.useFakeTimers();
    compactor = new AwarenessCompactor(101, {
      heartbeatTimeoutMs: 10_000,
      tombstoneRetentionMs: 5_000,
      autoSweepIntervalMs: 0, // Manual sweeping in tests
      maxClientsLimit: 5,
    });
  });

  afterEach(() => {
    compactor.dispose();
    jest.useRealTimers();
  });

  it('monotonically increments local clock on setLocalState', () => {
    const e1 = compactor.setLocalState({ user: 'Alice', cursor: { x: 10, y: 20 } });
    expect(e1.clientId).toBe(101);
    expect(e1.clock).toBe(1);

    const e2 = compactor.setLocalState({ user: 'Alice', cursor: { x: 15, y: 25 } });
    expect(e2.clock).toBe(2);

    const stats = compactor.getStats();
    expect(stats.activeClients).toBe(1);
    expect(stats.tombstoneCount).toBe(0);
  });

  it('applies valid remote awareness updates', () => {
    const remoteEntries: PeerAwarenessEntry<{ user: string }>[] = [
      { clientId: 202, clock: 5, updatedAt: Date.now(), state: { user: 'Bob' } },
      { clientId: 303, clock: 1, updatedAt: Date.now(), state: { user: 'Charlie' } },
    ];

    const result = compactor.applyRemoteUpdate(remoteEntries);
    expect(result.applied).toBe(2);
    expect(result.rejected).toBe(0);

    expect(compactor.getPeerState(202)?.state?.user).toBe('Bob');
    expect(compactor.getPeerState(303)?.state?.user).toBe('Charlie');
    expect(compactor.getStats().activeClients).toBe(2);
  });

  it('rejects stale or duplicate remote updates with smaller or equal clock', () => {
    compactor.applyRemoteUpdate([
      { clientId: 202, clock: 10, updatedAt: 1000, state: { user: 'Bob v1' } },
    ]);

    // Attempt to apply stale clock = 10 (equal)
    const res1 = compactor.applyRemoteUpdate([
      { clientId: 202, clock: 10, updatedAt: 2000, state: { user: 'Bob stale' } },
    ]);
    expect(res1.rejected).toBe(1);
    expect(res1.applied).toBe(0);
    expect(compactor.getPeerState(202)?.state?.user).toBe('Bob v1');

    // Attempt to apply stale clock = 9 (smaller)
    const res2 = compactor.applyRemoteUpdate([
      { clientId: 202, clock: 9, updatedAt: 2000, state: { user: 'Bob oldest' } },
    ]);
    expect(res2.rejected).toBe(1);

    // Apply strictly greater clock = 11
    const res3 = compactor.applyRemoteUpdate([
      { clientId: 202, clock: 11, updatedAt: 3000, state: { user: 'Bob v2' } },
    ]);
    expect(res3.applied).toBe(1);
    expect(compactor.getPeerState(202)?.state?.user).toBe('Bob v2');
  });

  it('ignores remote updates echoing the local clientId', () => {
    compactor.setLocalState({ user: 'Local Alice' });

    compactor.applyRemoteUpdate([
      { clientId: 101, clock: 99, updatedAt: Date.now(), state: { user: 'Fake Alice' } },
    ]);

    expect(compactor.getPeerState(101)?.state?.user).toBe('Local Alice');
  });

  it('prunes peers exceeding heartbeat timeout on compactSweep', () => {
    const baseTime = 100_000;
    compactor.applyRemoteUpdate(
      [
        { clientId: 202, clock: 1, updatedAt: baseTime, state: { user: 'Bob' } },
        { clientId: 303, clock: 1, updatedAt: baseTime, state: { user: 'Charlie' } },
      ],
      baseTime,
    );

    // Check after 5,000ms (less than 10,000ms timeout)
    const sweep1 = compactor.compactSweep(baseTime + 5_000);
    expect(sweep1.prunedCount).toBe(0);
    expect(compactor.getPeerState(202)).toBeDefined();

    // Check after 15,000ms (exceeds 10,000ms timeout)
    const sweep2 = compactor.compactSweep(baseTime + 15_000);
    expect(sweep2.prunedCount).toBe(2);
    expect(compactor.getPeerState(202)).toBeUndefined();
    expect(compactor.getPeerState(303)).toBeUndefined();
  });

  it('purges expired tombstones on compactSweep', () => {
    const baseTime = 50_000;
    // Client 202 disconnected (tombstone null state)
    compactor.applyRemoteUpdate(
      [{ clientId: 202, clock: 2, updatedAt: baseTime, state: null }],
      baseTime,
    );

    expect(compactor.getStats().tombstoneCount).toBe(1);

    // After 3,000ms (less than 5,000ms retention)
    compactor.compactSweep(baseTime + 3_000);
    expect(compactor.getPeerState(202)).toBeDefined();

    // After 6,000ms (exceeds 5,000ms retention)
    const sweep = compactor.compactSweep(baseTime + 6_000);
    expect(sweep.prunedCount).toBe(1);
    expect(compactor.getPeerState(202)).toBeUndefined();
    expect(compactor.getStats().tombstoneCount).toBe(0);
  });

  it('computes differential awareness delta against known remote vector clocks', () => {
    compactor.setLocalState({ user: 'Alice' }); // local clock = 1
    compactor.applyRemoteUpdate([
      { clientId: 202, clock: 5, updatedAt: Date.now(), state: { user: 'Bob' } },
      { clientId: 303, clock: 8, updatedAt: Date.now(), state: { user: 'Charlie' } },
    ]);

    // Target peer already knows: { 101: 1, 202: 5, 303: 4 }
    // Only clientId 303 has clock 8 > 4
    const knownClocks = new Map<number, number>([
      [101, 1],
      [202, 5],
      [303, 4],
    ]);

    const delta = compactor.computeDifferentialUpdate(knownClocks);
    expect(delta.length).toBe(1);
    expect(delta[0].clientId).toBe(303);
    expect(delta[0].clock).toBe(8);
  });

  it('encodes and decodes binary awareness frames with high fidelity', () => {
    compactor.setLocalState({ user: 'Alice', cursor: { x: 120, y: 340 } });
    compactor.applyRemoteUpdate([
      { clientId: 202, clock: 4, updatedAt: 1000, state: { user: 'Bob' } },
      { clientId: 303, clock: 9, updatedAt: 1000, state: null }, // tombstone
    ]);

    const binary = compactor.encodeToBinary();
    expect(binary.byteLength).toBeGreaterThan(8);

    const decoded = compactor.decodeBinary(binary, 2000);
    expect(decoded.length).toBe(3);

    const alice = decoded.find((d) => d.clientId === 101);
    expect(alice?.state?.user).toBe('Alice');
    expect(alice?.state?.cursor?.x).toBe(120);

    const bob = decoded.find((d) => d.clientId === 202);
    expect(bob?.state?.user).toBe('Bob');

    const charlie = decoded.find((d) => d.clientId === 303);
    expect(charlie?.state).toBeNull();
  });

  it('throws descriptive error on malformed binary header', () => {
    const corrupted = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00]);
    expect(() => compactor.decodeBinary(corrupted)).toThrow('Invalid awareness binary magic header');
  });

  it('prunes oldest entries when exceeding maxClientsLimit', () => {
    // limit is 5
    for (let i = 1; i <= 7; i++) {
      compactor.applyRemoteUpdate([
        { clientId: 1000 + i, clock: 1, updatedAt: i * 1000, state: { user: `Peer ${i}` } },
      ]);
    }

    expect(compactor.getAllEntries().length).toBeLessThanOrEqual(5);
    // Oldest peers (1001, 1002) should have been pruned
    expect(compactor.getPeerState(1001)).toBeUndefined();
  });
});
