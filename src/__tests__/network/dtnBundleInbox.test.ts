import { DtnBundleInbox } from '@/network/dtnBundleInbox';
import { createHash } from 'crypto';
import { DTNBundlesInbox, type IncomingFragment } from '@/core/network/DTNBundlesInbox';
describe('DtnBundleInbox TTL eviction of orphaned fragments', () => { it('evicts expired partial bundles deterministically when final fragment never arrives', () => { let nowMs = 10_000; const inbox = new DtnBundleInbox({ defaultTtlMs: 5_000, nowFn: () => nowMs }); expect(inbox.ingestFragment({ bundleId: 'bundle-orphan-a', fragmentIndex: 0, totalFragments: 3, payload: new Uint8Array([1, 2]) }, nowMs)).toBeNull(); nowMs = 11_000; expect(inbox.ingestFragment({ bundleId: 'bundle-orphan-b', fragmentIndex: 1, totalFragments: 2, payload: new Uint8Array([3, 4]), ttlMs: 6_000 }, nowMs)).toBeNull(); expect(inbox.getPendingCount(12_000)).toBe(2); const evictedAt15s = inbox.evictExpired(15_000); expect(evictedAt15s).toEqual(['bundle-orphan-a']); expect(inbox.hasPendingBundle('bundle-orphan-a', 15_000)).toBe(false); expect(inbox.hasPendingBundle('bundle-orphan-b', 15_000)).toBe(true); const lateFragment = inbox.ingestFragment({ bundleId: 'bundle-orphan-a', fragmentIndex: 2, totalFragments: 3, payload: new Uint8Array([9, 9]) }, 15_100); expect(lateFragment).toBeNull(); expect(inbox.hasPendingBundle('bundle-orphan-a', 15_100)).toBe(true); expect(inbox.evictExpired(17_000)).toEqual(['bundle-orphan-b']); }); it('assembles complete multi-fragment bundles before TTL expiration', () => { const inbox = new DtnBundleInbox({ defaultTtlMs: 10_000 }); const baseMs = 50_000; expect(inbox.ingestFragment({ bundleId: 'bundle-ok', fragmentIndex: 1, totalFragments: 2, payload: new Uint8Array([0x20, 0x30]) }, baseMs)).toBeNull(); const assembled = inbox.ingestFragment({ bundleId: 'bundle-ok', fragmentIndex: 0, totalFragments: 2, payload: new Uint8Array([0x00, 0x10]) }, baseMs + 2_000); expect(assembled?.bundleId).toBe('bundle-ok'); expect(Array.from(assembled?.payload ?? [])).toEqual([0x00, 0x10, 0x20, 0x30]); expect(inbox.getPendingCount(baseMs + 2_000)).toBe(0); }); });

describe('DTNBundlesInbox payload integrity digest', () => {
  const creationTimestamp = 1_000;

  function makeFragment(
    logicalBundleId: string,
    payload: Buffer,
    expectedPayloadDigest?: string,
  ): IncomingFragment {
    return {
      logicalBundleId,
      source: 'source-node',
      destination: 'destination-node',
      fragmentOffset: 0,
      totalPayloadLength: payload.byteLength,
      payloadBase64: payload.toString('base64'),
      creationTimestamp,
      lifetimeMs: 60_000,
      ...(expectedPayloadDigest !== undefined ? { expectedPayloadDigest } : {}),
    };
  }

  it('accepts a reassembled payload with a matching SHA-256 digest', () => {
    const inbox = new DTNBundlesInbox();
    const payload = Buffer.from('intact payload');
    const expectedPayloadDigest = createHash('sha256')
      .update(payload)
      .digest('hex');

    const result = inbox.ingestFragment(
      makeFragment('bundle-valid-digest', payload, expectedPayloadDigest),
      creationTimestamp + 1,
    );

    expect(result.accepted).toBe(true);
    expect(result.status).toBe('ready');
    expect(result.receipt?.kind).toBe('complete_bundle');
    expect(result.integrityError).toBeUndefined();
  });

  it('rejects a corrupted payload with a structured integrity error and no completion receipt', () => {
    const inbox = new DTNBundlesInbox();
    const expectedPayload = Buffer.from('original payload');
    const corruptedPayload = Buffer.from('corrupted payload');
    const expectedPayloadDigest = createHash('sha256')
      .update(expectedPayload)
      .digest('hex');

    const result = inbox.ingestFragment(
      makeFragment(
        'bundle-corrupt-digest',
        corruptedPayload,
        expectedPayloadDigest,
      ),
      creationTimestamp + 1,
    );

    expect(result).toMatchObject({
      accepted: false,
      status: 'failed',
      integrityError: {
        code: 'PAYLOAD_DIGEST_MISMATCH',
        expectedDigest: expectedPayloadDigest,
      },
    });
    expect(result.integrityError?.actualDigest).toBe(
      createHash('sha256').update(corruptedPayload).digest('hex'),
    );
    expect(result.receipt).toBeUndefined();
    expect(
      inbox
        .getBundle('bundle-corrupt-digest')
        ?.receipts.some((receipt) => receipt.kind === 'complete_bundle'),
    ).toBe(false);
  });

  it('preserves normal assembly and completion receipts when the optional digest is omitted', () => {
    const inbox = new DTNBundlesInbox();
    const payload = Buffer.from('legacy payload without digest');

    const result = inbox.ingestFragment(
      makeFragment('bundle-no-digest', payload),
      creationTimestamp + 1,
    );

    expect(result.accepted).toBe(true);
    expect(result.status).toBe('ready');
    expect(result.receipt?.kind).toBe('complete_bundle');
    expect(result.integrityError).toBeUndefined();
  });
});
