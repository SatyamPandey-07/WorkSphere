import {
  computeSha256Digest,
  computeStateVectorHmac,
  computeMerkleRoot,
  StateVectorChecksumVerifier,
} from '../../../lib/crdt/stateVectorChecksum';

describe('StateVectorChecksumVerifier', () => {
  let verifier: StateVectorChecksumVerifier;

  beforeEach(() => {
    verifier = new StateVectorChecksumVerifier(3); // Small cache size for testing
  });

  it('computes accurate SHA-256 digest for known vectors', async () => {
    // "hello world" -> b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9
    const input = new TextEncoder().encode('hello world');
    const digest = await computeSha256Digest(input);
    expect(digest.toLowerCase()).toBe(
      'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
    );
  });

  it('computes authenticated HMAC-SHA256 signature', async () => {
    const input = new TextEncoder().encode('collaborative-state-vector');
    const key = 'secret-mesh-key';
    const hmac1 = await computeStateVectorHmac(input, key);
    const hmac2 = await computeStateVectorHmac(input, key);

    expect(hmac1).toBe(hmac2);
    expect(hmac1.length).toBe(64); // 256 bits in hex

    // Different key produces different signature
    const hmacDifferent = await computeStateVectorHmac(input, 'wrong-key');
    expect(hmacDifferent).not.toBe(hmac1);
  });

  it('computes Merkle root over multiple chunks', async () => {
    const chunkA = new TextEncoder().encode('chunk_001_crdt_delta');
    const chunkB = new TextEncoder().encode('chunk_002_crdt_delta');
    const chunkC = new TextEncoder().encode('chunk_003_crdt_delta');

    const result = await computeMerkleRoot([chunkA, chunkB, chunkC]);
    expect(result.leafHashes.length).toBe(3);
    expect(result.root.length).toBe(64);

    // Verify same chunks produce identical root
    const result2 = await computeMerkleRoot([chunkA, chunkB, chunkC]);
    expect(result2.root).toBe(result.root);
  });

  it('pinpoints corrupted chunk index via leaf hashes', async () => {
    const chunkA = new TextEncoder().encode('chunk_001_clean');
    const chunkB = new TextEncoder().encode('chunk_002_clean');
    const chunkC = new TextEncoder().encode('chunk_003_clean');

    const trusted = await computeMerkleRoot([chunkA, chunkB, chunkC]);

    // Corrupt chunkB
    const corruptedB = new TextEncoder().encode('chunk_002_TAMPERED');
    const actual = await computeMerkleRoot([chunkA, corruptedB, chunkC]);

    expect(actual.root).not.toBe(trusted.root);

    const corruptedIndex = verifier.pinpointCorruptedChunk(
      actual.leafHashes,
      trusted.leafHashes,
    );
    expect(corruptedIndex).toBe(1); // chunkB index
  });

  it('verifies snapshot integrity and rejects tampering', async () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const validDigest = await computeSha256Digest(payload);

    const isMatch = await verifier.verifySnapshot(payload, validDigest);
    expect(isMatch).toBe(true);

    // Tampered payload
    const tamperedPayload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 99]);
    const isTamperedMatch = await verifier.verifySnapshot(
      tamperedPayload,
      validDigest,
    );
    expect(isTamperedMatch).toBe(false);
  });

  it('caches computed digests and evicts oldest entries in LRU fashion', async () => {
    const p1 = new Uint8Array([10, 20]);
    const p2 = new Uint8Array([30, 40]);
    const p3 = new Uint8Array([50, 60]);
    const p4 = new Uint8Array([70, 80]);

    // 1st access -> miss
    await verifier.getOrComputeDigest(p1);
    expect(verifier.getCacheStats().misses).toBe(1);
    expect(verifier.getCacheStats().hits).toBe(0);

    // 2nd access to p1 -> hit
    await verifier.getOrComputeDigest(p1);
    expect(verifier.getCacheStats().hits).toBe(1);

    // Fill cache (maxSize = 3)
    await verifier.getOrComputeDigest(p2);
    await verifier.getOrComputeDigest(p3);
    expect(verifier.getCacheStats().size).toBe(3);

    // Add 4th item -> should evict p1
    await verifier.getOrComputeDigest(p4);
    expect(verifier.getCacheStats().size).toBe(3);

    // Access p1 again -> should be a miss because it was evicted
    await verifier.getOrComputeDigest(p1);
    expect(verifier.getCacheStats().misses).toBe(5);
  });

  it('handles empty chunks array deterministically', async () => {
    const emptyResult = await computeMerkleRoot([]);
    expect(emptyResult.leafHashes).toEqual([]);
    expect(emptyResult.root.length).toBe(64);
  });


  it("does not reuse a sampled cache key for large payloads that differ in unsampled bytes", async () => {
    const first = new Uint8Array(128);
    const second = new Uint8Array(128);
    first[64] = 10;
    second[64] = 11;

    const firstDigest = await verifier.getOrComputeDigest(first);
    const secondDigest = await verifier.getOrComputeDigest(second);

    expect(firstDigest).not.toBe(secondDigest);
    expect(verifier.getCacheStats().size).toBe(0);
  });

  it("recomputes small vector digests after the cache is cleared", async () => {
    const vector = new Uint8Array([1, 2, 3, 4]);
    const first = await verifier.getOrComputeDigest(vector);
    expect(verifier.getCacheStats().misses).toBe(1);

    verifier.clearCache();
    const second = await verifier.getOrComputeDigest(vector);

    expect(second).toBe(first);
    expect(verifier.getCacheStats()).toEqual({
      size: 1,
      maxSize: 3,
      hits: 0,
      misses: 1,
    });
  });
\n});