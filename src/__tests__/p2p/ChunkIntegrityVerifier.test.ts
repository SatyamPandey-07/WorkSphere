import {
  ChunkIntegrityVerifier,
  computeChunkHash,
  type ChunkRetryEvent,
} from "@/lib/p2p/ChunkIntegrityVerifier";

describe("ChunkIntegrityVerifier (Cryptographic P2P Chunk Hashing)", () => {
  describe("computeChunkHash", () => {
    it("computes standard SHA-256 hex digest for Uint8Array", async () => {
      const data = new TextEncoder().encode("Hello WorkSphere P2P");
      const hash = await computeChunkHash(data);

      expect(typeof hash).toBe("string");
      expect(hash).toHaveLength(64); // 256 bits = 64 hex chars
      expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
    });

    it("produces identical hashes for identical data", async () => {
      const sliceA = new Uint8Array([1, 2, 3, 4, 5]);
      const sliceB = new Uint8Array([1, 2, 3, 4, 5]);

      const hashA = await computeChunkHash(sliceA);
      const hashB = await computeChunkHash(sliceB);

      expect(hashA).toBe(hashB);
    });

    it("produces different hashes for different data", async () => {
      const sliceA = new Uint8Array([1, 2, 3, 4, 5]);
      const sliceB = new Uint8Array([1, 2, 3, 4, 6]);

      const hashA = await computeChunkHash(sliceA);
      const hashB = await computeChunkHash(sliceB);

      expect(hashA).not.toBe(hashB);
    });
  });

  describe("ChunkIntegrityVerifier Verification & Retry Handling", () => {
    const chunk0 = new Uint8Array([10, 20, 30, 40]);
    const chunk1 = new Uint8Array([50, 60, 70, 80]);
    let hash0: string;
    let hash1: string;

    beforeAll(async () => {
      hash0 = await computeChunkHash(chunk0);
      hash1 = await computeChunkHash(chunk1);
    });

    it("verifies and commits valid chunks", async () => {
      const verifier = new ChunkIntegrityVerifier({
        transferId: "tx-123",
        expectedDigests: [hash0, hash1],
      });

      const res0 = await verifier.verifyAndCommitChunk(0, chunk0);
      expect(res0.verified).toBe(true);
      expect(res0.actualDigest).toBe(hash0);
      expect(verifier.getVerifiedChunkCount()).toBe(1);
      expect(verifier.isComplete()).toBe(false);

      const res1 = await verifier.verifyAndCommitChunk(1, chunk1);
      expect(res1.verified).toBe(true);
      expect(res1.actualDigest).toBe(hash1);
      expect(verifier.getVerifiedChunkCount()).toBe(2);
      expect(verifier.isComplete()).toBe(true);
    });

    it("discards tampered/corrupted chunks and emits retry event", async () => {
      const retryEvents: ChunkRetryEvent[] = [];
      const verifier = new ChunkIntegrityVerifier({
        transferId: "tx-tampered",
        expectedDigests: [hash0, hash1],
        onRetry: (e) => retryEvents.push(e),
      });

      // Corrupted chunk 0
      const corruptedChunk = new Uint8Array([10, 20, 30, 99]);
      const result = await verifier.verifyAndCommitChunk(0, corruptedChunk);

      expect(result.verified).toBe(false);
      expect(verifier.getVerifiedChunkCount()).toBe(0);
      expect(verifier.getRetryCount(0)).toBe(1);

      expect(retryEvents).toHaveLength(1);
      expect(retryEvents[0]).toMatchObject({
        transferId: "tx-tampered",
        chunkIndex: 0,
        expectedDigest: hash0,
        retryCount: 1,
        maxRetriesExceeded: false,
      });
      expect(retryEvents[0].actualDigest).not.toBe(hash0);
    });

    it("tracks retry counts and signals when max retries exceeded", async () => {
      const retryEvents: ChunkRetryEvent[] = [];
      const verifier = new ChunkIntegrityVerifier({
        transferId: "tx-retries",
        expectedDigests: [hash0],
        maxRetries: 2,
        onRetry: (e) => retryEvents.push(e),
      });

      const badData = new Uint8Array([0, 0, 0]);

      // Attempt 1
      await verifier.verifyAndCommitChunk(0, badData);
      expect(verifier.getRetryCount(0)).toBe(1);
      expect(retryEvents[0].maxRetriesExceeded).toBe(false);

      // Attempt 2
      await verifier.verifyAndCommitChunk(0, badData);
      expect(verifier.getRetryCount(0)).toBe(2);
      expect(retryEvents[1].maxRetriesExceeded).toBe(true);
    });

    it("reconstructs complete blob only when all chunks verified", async () => {
      let completedBlob: Blob | null = null;
      const verifier = new ChunkIntegrityVerifier({
        transferId: "tx-blob",
        expectedDigests: [hash0, hash1],
        onComplete: (blob) => {
          completedBlob = blob;
        },
      });

      expect(verifier.getReconstructedBlob()).toBeNull();

      await verifier.verifyAndCommitChunk(0, chunk0);
      expect(verifier.getReconstructedBlob()).toBeNull();
      expect(completedBlob).toBeNull();

      await verifier.verifyAndCommitChunk(1, chunk1);
      const blob = verifier.getReconstructedBlob("text/plain");
      expect(blob).not.toBeNull();
      expect(blob?.size).toBe(chunk0.length + chunk1.length);
      expect(completedBlob).toBe(blob);
    });

    it("identifies missing chunk indices accurately", async () => {
      const verifier = new ChunkIntegrityVerifier({
        transferId: "tx-missing",
        expectedDigests: [hash0, hash1, "hash2"],
      });

      expect(verifier.getMissingChunkIndices()).toEqual([0, 1, 2]);

      await verifier.verifyAndCommitChunk(1, chunk1);
      expect(verifier.getMissingChunkIndices()).toEqual([0, 2]);
    });
  });
});
