import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { ProofReceiptGuard } from '@/features/zkp/proofReceiptGuard';

describe('ProofReceiptGuard', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it('caches valid proof receipts, blocks replayed nullifiers in single-use mode, and handles TTL expiry', () => {
    let now = 1_700_000_000_000;
    const guard = new ProofReceiptGuard({
      defaultTtlMs: 60_000,
      singleUseNullifiers: true,
      nowFn: () => now,
      persist: false,
    });

    const inputMeta = { tier: 'student_discount' };
    const receipt = guard.registerReceipt({
      proofHash: 'hash-101',
      nullifier: 'null-abc',
      metadata: inputMeta,
    });
    inputMeta.tier = 'mutated';
    expect(receipt.metadata?.tier).toBe('student_discount');

    const firstCheck = guard.lookup('hash-101');
    expect(firstCheck.status).toBe('valid');
    expect(firstCheck.allowed).toBe(true);

    const consumed = guard.consumeProof('hash-101');
    expect(consumed.status).toBe('valid');
    expect(consumed.allowed).toBe(true);
    expect(guard.hasConsumedNullifier('null-abc')).toBe(true);

    guard.registerReceipt({
      proofHash: 'hash-102',
      nullifier: 'null-abc',
    });
    const replayCheck = guard.lookup('hash-102');
    expect(replayCheck.status).toBe('replayed_nullifier');
    expect(replayCheck.allowed).toBe(false);

    now += 60_000;
    guard.registerReceipt({
      proofHash: 'hash-103',
      nullifier: 'null-fresh',
      ttlMs: 10_000,
    });
    now += 10_000;

    const expiredCheck = guard.lookup('hash-103');
    expect(expiredCheck.status).toBe('expired');
    expect(expiredCheck.allowed).toBe(false);
    expect(guard.lookup('hash-103').status).toBe('not_found');
  });

  it('evicts oldest entries when maxEntries capacity is exceeded', () => {
    const now = 1_700_000_000_000;
    const guard = new ProofReceiptGuard({
      maxEntries: 2,
      singleUseNullifiers: false,
      nowFn: () => now,
      persist: false,
    });

    guard.registerReceipt({ proofHash: 'h1', nullifier: 'n1' });
    guard.registerReceipt({ proofHash: 'h2', nullifier: 'n2' });
    guard.registerReceipt({ proofHash: 'h3', nullifier: 'n3' });

    expect(guard.size()).toBe(2);
    expect(guard.lookup('h1').status).toBe('not_found');
    expect(guard.lookup('h2').status).toBe('valid');
    expect(guard.lookup('h3').status).toBe('valid');
  });

  it('persists verified receipts and consumed nullifiers across simulated page reloads', async () => {
    let now = 1_700_000_000_000;
    const dbName = 'WorkSphereZkpReloadTestDB';

    const guard1 = new ProofReceiptGuard({
      dbName,
      defaultTtlMs: 120_000,
      singleUseNullifiers: true,
      nowFn: () => now,
    });
    await guard1.ready();

    guard1.registerReceipt({
      proofHash: 'hash-consumed',
      nullifier: 'null-consumed',
      metadata: { tier: 'student' },
    });
    guard1.registerReceipt({
      proofHash: 'hash-unconsumed',
      nullifier: 'null-unconsumed',
      metadata: { tier: 'gigabit' },
    });
    expect(guard1.consumeProof('hash-consumed').allowed).toBe(true);
    await guard1.flush();
    guard1.close();

    // Simulate a page reload by constructing a fresh instance against the same IndexedDB
    now += 5_000;
    const guard2 = new ProofReceiptGuard({
      dbName,
      defaultTtlMs: 120_000,
      singleUseNullifiers: true,
      nowFn: () => now,
    });
    const hydration = await guard2.ready();

    expect(hydration.persistenceActive).toBe(true);
    expect(hydration.hydratedReceipts).toBe(2);
    expect(hydration.hydratedNullifiers).toBe(1);
    expect(guard2.hasConsumedNullifier('null-consumed')).toBe(true);
    expect(guard2.lookup('hash-consumed').status).toBe('replayed_nullifier');
    expect(guard2.lookup('hash-unconsumed').status).toBe('valid');

    // Re-registering a different proofHash with the already-consumed nullifier is still blocked after reload
    guard2.registerReceipt({
      proofHash: 'hash-replay-attempt',
      nullifier: 'null-consumed',
    });
    expect(guard2.lookup('hash-replay-attempt').status).toBe('replayed_nullifier');

    await guard2.flush();
    guard2.close();
  });

  it('prunes expired receipts and nullifiers on startup hydration and during TTL eviction', async () => {
    let now = 1_700_000_000_000;
    const dbName = 'WorkSphereZkpTtlPruneDB';

    const guard1 = new ProofReceiptGuard({
      dbName,
      defaultTtlMs: 60_000,
      singleUseNullifiers: true,
      nowFn: () => now,
    });
    await guard1.ready();

    guard1.registerReceipt({
      proofHash: 'hash-short',
      nullifier: 'null-short',
      ttlMs: 10_000,
    });
    guard1.registerReceipt({
      proofHash: 'hash-long',
      nullifier: 'null-long',
      ttlMs: 120_000,
    });
    expect(guard1.consumeProof('hash-short').allowed).toBe(true);
    expect(guard1.consumeProof('hash-long').allowed).toBe(true);
    await guard1.flush();
    guard1.close();

    // Advance past short TTL (10s) but before long TTL (120s)
    now += 20_000;
    const guard2 = new ProofReceiptGuard({
      dbName,
      defaultTtlMs: 60_000,
      singleUseNullifiers: true,
      nowFn: () => now,
    });
    const hydration = await guard2.ready();

    expect(hydration.prunedExpired).toBe(2); // short receipt + short nullifier
    expect(hydration.hydratedReceipts).toBe(1);
    expect(hydration.hydratedNullifiers).toBe(1);
    expect(guard2.lookup('hash-short').status).toBe('not_found');
    expect(guard2.hasConsumedNullifier('null-short')).toBe(false);
    expect(guard2.hasConsumedNullifier('null-long')).toBe(true);
    expect(guard2.lookup('hash-long').status).toBe('replayed_nullifier');

    // Advance past long TTL and verify runtime TTL eviction also removes persisted entries
    now += 110_000;
    expect(guard2.purgeExpired(now)).toBe(2);
    expect(guard2.hasConsumedNullifier('null-long')).toBe(false);
    await guard2.flush();
    guard2.close();

    const guard3 = new ProofReceiptGuard({
      dbName,
      defaultTtlMs: 60_000,
      singleUseNullifiers: true,
      nowFn: () => now,
    });
    const thirdHydration = await guard3.ready();
    expect(thirdHydration.hydratedReceipts).toBe(0);
    expect(thirdHydration.hydratedNullifiers).toBe(0);
    expect(guard3.size()).toBe(0);
    guard3.close();
  });

  it('falls back safely to in-memory Map when IndexedDB is unavailable (SSR/Node)', async () => {
    const originalIndexedDb = globalThis.indexedDB;
    // Simulate SSR/Node environment without indexedDB
    Object.defineProperty(globalThis, 'indexedDB', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    try {
      let now = 1_700_000_000_000;
      const guard = new ProofReceiptGuard({
        defaultTtlMs: 30_000,
        nowFn: () => now,
      });

      const hydration = await guard.ready();
      expect(hydration.persistenceActive).toBe(false);
      expect(guard.isPersistenceEnabled()).toBe(false);

      guard.registerReceipt({ proofHash: 'ssr-1', nullifier: 'ssr-null-1' });
      expect(guard.lookup('ssr-1').status).toBe('valid');
      expect(guard.consumeProof('ssr-1').allowed).toBe(true);
      expect(guard.hasConsumedNullifier('ssr-null-1')).toBe(true);

      await guard.flush();

      now += 35_000;
      expect(guard.purgeExpired(now)).toBe(2);
      expect(guard.size()).toBe(0);
    } finally {
      Object.defineProperty(globalThis, 'indexedDB', {
        value: originalIndexedDb,
        configurable: true,
        writable: true,
      });
    }
  });
});
