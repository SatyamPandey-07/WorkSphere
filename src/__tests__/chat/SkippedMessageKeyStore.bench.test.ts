import { SkippedMessageKeyStore } from '../../core/chat/SkippedMessageKeyStore';
import { randomBytes } from 'crypto';

describe('Performance Benchmarks for SkippedMessageKeyStore', () => {
  it('measures insertion, lookup, consumption, and eviction performance', () => {
    const store = new SkippedMessageKeyStore({
      sessionId: 'bench-session',
      rootKey: randomBytes(32),
      maxGlobalKeys: 2000,
      maxKeysPerChain: 100,
    });

    const chainHex = '04' + 'aa'.repeat(32);
    const mk = randomBytes(32);

    // 1. Insertion of 100 keys (AES-256-GCM encryption)
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) {
      store.storeSkippedKey(chainHex, i, Buffer.from(mk));
    }
    const t1 = performance.now();
    const insertTotal = t1 - t0;
    const insertAvg = insertTotal / 100;

    // 2. Lookup of 100 keys
    const t2 = performance.now();
    for (let i = 0; i < 100; i++) {
      store.hasSkippedKey(chainHex, i);
    }
    const t3 = performance.now();
    const lookupTotal = t3 - t2;
    const lookupAvg = lookupTotal / 100;

    // 3. Consumption of 100 keys (AES-256-GCM decryption + verification)
    const t4 = performance.now();
    for (let i = 0; i < 100; i++) {
      const k = store.consumeSkippedKey(chainHex, i);
      if (k) k.fill(0);
    }
    const t5 = performance.now();
    const consumeTotal = t5 - t4;
    const consumeAvg = consumeTotal / 100;

    // 4. Eviction check (insert 101 keys with maxKeysPerChain = 100)
    for (let i = 0; i < 100; i++) {
      store.storeSkippedKey(chainHex, i, Buffer.from(mk));
    }
    const t6 = performance.now();
    store.storeSkippedKey(chainHex, 100, Buffer.from(mk));
    const t7 = performance.now();
    const evictTime = t7 - t6;

    console.log(`[BENCHMARK] 100 key insertions: ${insertTotal.toFixed(3)} ms (avg: ${insertAvg.toFixed(3)} ms/op)`);
    console.log(`[BENCHMARK] 100 key lookups: ${lookupTotal.toFixed(3)} ms (avg: ${lookupAvg.toFixed(3)} ms/op)`);
    console.log(`[BENCHMARK] 100 key consumptions: ${consumeTotal.toFixed(3)} ms (avg: ${consumeAvg.toFixed(3)} ms/op)`);
    console.log(`[BENCHMARK] Eviction upon capacity limit: ${evictTime.toFixed(3)} ms`);

    expect(insertTotal).toBeLessThan(100);
    expect(lookupTotal).toBeLessThan(50);
    expect(consumeTotal).toBeLessThan(100);
    expect(evictTime).toBeLessThan(10);
  });
});
