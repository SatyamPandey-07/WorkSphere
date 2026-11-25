import { ProofReceiptGuard } from '@/features/zkp/proofReceiptGuard';

describe('ProofReceiptGuard', () => {
  it('caches valid proof receipts, blocks replayed nullifiers in single-use mode, and handles TTL expiry', () => {
    let now = 1_700_000_000_000;
    const guard = new ProofReceiptGuard({
      defaultTtlMs: 60_000,
      singleUseNullifiers: true,
      nowFn: () => now,
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
    });

    guard.registerReceipt({ proofHash: 'h1', nullifier: 'n1' });
    guard.registerReceipt({ proofHash: 'h2', nullifier: 'n2' });
    guard.registerReceipt({ proofHash: 'h3', nullifier: 'n3' });

    expect(guard.size()).toBe(2);
    expect(guard.lookup('h1').status).toBe('not_found');
    expect(guard.lookup('h2').status).toBe('valid');
    expect(guard.lookup('h3').status).toBe('valid');
  });
});
