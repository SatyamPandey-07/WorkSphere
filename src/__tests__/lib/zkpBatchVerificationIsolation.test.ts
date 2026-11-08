/**
 * ZKP Batch Verification Isolation & Fault-Tolerance Test Suite (#5034)
 *
 * Verifies that zero-knowledge proof batch verification engines:
 * 1. Return per-proof verification results containing exact 0-based array indices.
 * 2. Isolate failed or corrupted proofs without halting verification of remaining proofs.
 * 3. Support partial acceptance of valid proofs in mixed batches.
 */

import {
  verifyMultiVenueBatchProofs,
  verifyBatchProofs,
  verifyBatchStudentDiscountProofs,
  computeClusterMerkleHash,
  type MultiVenueBatchVerifyRequest,
  type GenericBatchProofItem,
  type BatchStudentDiscountRequest,
} from "@/lib/zkp/batch";

// Mock dependencies
jest.mock("./verify", () => ({
  verifyMembershipProof: jest.fn(),
}));

jest.mock("./poseidon", () => ({
  poseidonHash: jest.fn((inputs: bigint[]) => BigInt(inputs[0] || 1n) * 12345n),
}));

jest.mock("./studentMembership", () => ({
  isUniversityMerkleRootActive: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    studentClaimNullifier: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    user: {
      update: jest.fn(),
    },
    $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
  },
}));

jest.mock("fs", () => ({
  existsSync: jest.fn(() => true),
  readFileSync: jest.fn(() => JSON.stringify({ vk_type: "Groth16" })),
}));

jest.mock("snarkjs", () => ({
  groth16: {
    verify: jest.fn(),
  },
}));

const { verifyMembershipProof } = require("./verify");
const { isUniversityMerkleRootActive } = require("./studentMembership");
const snarkjs = require("snarkjs");

describe("ZKP Batch Verification Isolation & Error Handling (#5034)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // 1. verifyMultiVenueBatchProofs Isolation & Index Reporting
  // =========================================================================
  describe("verifyMultiVenueBatchProofs", () => {
    it("returns per-proof verification results with exact array indices", async () => {
      verifyMembershipProof.mockResolvedValue(true);

      const request: MultiVenueBatchVerifyRequest = {
        clusterId: "cluster-alpha",
        clusterMerkleRoot: "100200300400",
        venueProofs: [
          { venueId: "venue-101", proof: { pi_a: ["1", "2"] } as any, publicSignals: ["100"] },
          { venueId: "venue-102", proof: { pi_a: ["3", "4"] } as any, publicSignals: ["200"] },
          { venueId: "venue-103", proof: { pi_a: ["5", "6"] } as any, publicSignals: ["300"] },
        ],
      };

      const response = await verifyMultiVenueBatchProofs(request);

      expect(response.totalCount).toBe(3);
      expect(response.verifiedCount).toBe(3);
      expect(response.valid).toBe(true);

      expect(response.results).toHaveLength(3);
      expect(response.results[0]).toEqual({ index: 0, venueId: "venue-101", valid: true });
      expect(response.results[1]).toEqual({ index: 1, venueId: "venue-102", valid: true });
      expect(response.results[2]).toEqual({ index: 2, venueId: "venue-103", valid: true });
    });

    it("isolates failed proofs and continues processing subsequent items in mixed batch", async () => {
      // Index 0: valid, Index 1: invalid, Index 2: throws error, Index 3: valid
      verifyMembershipProof
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockRejectedValueOnce(new Error("Proof curve point validation error"))
        .mockResolvedValueOnce(true);

      const request: MultiVenueBatchVerifyRequest = {
        clusterId: "cluster-mixed",
        clusterMerkleRoot: "999888777",
        venueProofs: [
          { venueId: "venue-valid-1", proof: {} as any, publicSignals: ["1"] },
          { venueId: "venue-invalid", proof: {} as any, publicSignals: ["2"] },
          { venueId: "venue-errored", proof: {} as any, publicSignals: ["3"] },
          { venueId: "venue-valid-2", proof: {} as any, publicSignals: ["4"] },
        ],
      };

      const response = await verifyMultiVenueBatchProofs(request);

      expect(response.totalCount).toBe(4);
      expect(response.verifiedCount).toBe(2);
      expect(response.valid).toBe(false);

      expect(response.results).toHaveLength(4);

      // Verify Index 0 (Valid)
      expect(response.results[0]).toEqual({
        index: 0,
        venueId: "venue-valid-1",
        valid: true,
      });

      // Verify Index 1 (Invalid proof)
      expect(response.results[1]).toEqual({
        index: 1,
        venueId: "venue-invalid",
        valid: false,
        error: "Invalid ZK proof",
      });

      // Verify Index 2 (Errored proof)
      expect(response.results[2]).toEqual({
        index: 2,
        venueId: "venue-errored",
        valid: false,
        error: "Proof curve point validation error",
      });

      // Verify Index 3 (Valid proof - processing continued past errors)
      expect(response.results[3]).toEqual({
        index: 3,
        venueId: "venue-valid-2",
        valid: true,
      });
    });

    it("handles missing or malformed proof payloads gracefully at specific index", async () => {
      verifyMembershipProof.mockResolvedValue(true);

      const request: MultiVenueBatchVerifyRequest = {
        clusterId: "cluster-malformed",
        clusterMerkleRoot: "555666777",
        venueProofs: [
          { venueId: "venue-ok", proof: {} as any, publicSignals: ["1"] },
          null as any,
          { venueId: "venue-no-signals", proof: {} as any, publicSignals: null as any },
        ],
      };

      const response = await verifyMultiVenueBatchProofs(request);

      expect(response.totalCount).toBe(3);
      expect(response.verifiedCount).toBe(1);
      expect(response.valid).toBe(false);

      expect(response.results[0]).toEqual({ index: 0, venueId: "venue-ok", valid: true });
      expect(response.results[1].index).toBe(1);
      expect(response.results[1].valid).toBe(false);
      expect(response.results[1].error).toBe("Missing or malformed proof payload");

      expect(response.results[2].index).toBe(2);
      expect(response.results[2].valid).toBe(false);
      expect(response.results[2].error).toBe("Missing or malformed proof payload");
    });
  });

  // =========================================================================
  // 2. Generic verifyBatchProofs Fault Isolation
  // =========================================================================
  describe("verifyBatchProofs", () => {
    it("returns per-proof verification results for arbitrary proof items", async () => {
      verifyMembershipProof.mockResolvedValue(true);

      const items: GenericBatchProofItem[] = [
        { id: "item-a", proof: { a: "1" }, publicSignals: ["sig1"] },
        { id: "item-b", proof: { a: "2" }, publicSignals: ["sig2"] },
      ];

      const response = await verifyBatchProofs(items);

      expect(response.totalCount).toBe(2);
      expect(response.verifiedCount).toBe(2);
      expect(response.failedCount).toBe(0);
      expect(response.valid).toBe(true);
      expect(response.results[0]).toEqual({ index: 0, id: "item-a", valid: true });
      expect(response.results[1]).toEqual({ index: 1, id: "item-b", valid: true });
    });

    it("isolates errors across a batch of 5 mixed proof payloads", async () => {
      verifyMembershipProof
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockRejectedValueOnce(new Error("Groth16 pairing verification failed"))
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      const items: GenericBatchProofItem[] = [
        { id: "proof-0", proof: {}, publicSignals: ["s0"] },
        { id: "proof-1", proof: {}, publicSignals: ["s1"] },
        { id: "proof-2", proof: {}, publicSignals: ["s2"] },
        { id: "proof-3", proof: {}, publicSignals: ["s3"] },
        { id: "proof-4", proof: {}, publicSignals: ["s4"] },
      ];

      const response = await verifyBatchProofs(items);

      expect(response.totalCount).toBe(5);
      expect(response.verifiedCount).toBe(2);
      expect(response.failedCount).toBe(3);
      expect(response.valid).toBe(false);

      expect(response.results[0]).toEqual({ index: 0, id: "proof-0", valid: true });
      expect(response.results[1]).toEqual({
        index: 1,
        id: "proof-1",
        valid: false,
        error: "Groth16 verification failed for proof",
      });
      expect(response.results[2]).toEqual({
        index: 2,
        id: "proof-2",
        valid: false,
        error: "Groth16 pairing verification failed",
      });
      expect(response.results[3]).toEqual({ index: 3, id: "proof-3", valid: true });
      expect(response.results[4]).toEqual({
        index: 4,
        id: "proof-4",
        valid: false,
        error: "Groth16 verification failed for proof",
      });
    });

    it("handles empty array or undefined input gracefully", async () => {
      const responseNull = await verifyBatchProofs(null as any);
      expect(responseNull.totalCount).toBe(0);
      expect(responseNull.verifiedCount).toBe(0);
      expect(responseNull.valid).toBe(false);

      const responseEmpty = await verifyBatchProofs([]);
      expect(responseEmpty.totalCount).toBe(0);
      expect(responseEmpty.results).toEqual([]);
    });
  });

  // =========================================================================
  // 3. verifyBatchStudentDiscountProofs Isolation & Index Integrity
  // =========================================================================
  describe("verifyBatchStudentDiscountProofs", () => {
    it("assigns 0-based indices and handles mixed student discount verifications", async () => {
      isUniversityMerkleRootActive.mockResolvedValue(true);
      snarkjs.groth16.verify
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const request: BatchStudentDiscountRequest = {
        epoch: 2026,
        items: [
          {
            id: "student-pass-1",
            userId: "usr-100",
            proof: { a: "1" },
            publicSignals: ["100200", "2026", "nullifier-hash-1"],
          },
          {
            id: "student-pass-2",
            userId: "usr-200",
            proof: { a: "2" },
            publicSignals: ["100200", "2026", "nullifier-hash-2"],
          },
          {
            id: "student-pass-3",
            userId: "usr-300",
            proof: { a: "3" },
            publicSignals: ["100200", "2026", "nullifier-hash-3"],
          },
        ],
      };

      const response = await verifyBatchStudentDiscountProofs(request);

      expect(response.totalCount).toBe(3);
      expect(response.verifiedCount).toBe(2);
      expect(response.failedCount).toBe(1);
      expect(response.valid).toBe(false);

      // Verify Index 0 (Valid)
      expect(response.results[0]).toEqual({
        index: 0,
        id: "student-pass-1",
        userId: "usr-100",
        studentId: undefined,
        valid: true,
        nullifierHash: "nullifier-hash-1",
        discountEligible: true,
        discountCode: "STUDENT20",
        discountPercentage: 20,
      });

      // Verify Index 1 (Invalid Groth16 proof)
      expect(response.results[1]).toEqual({
        index: 1,
        id: "student-pass-2",
        userId: "usr-200",
        studentId: undefined,
        valid: false,
        discountEligible: false,
        error: "Invalid zero-knowledge proof",
      });

      // Verify Index 2 (Valid - processing continued)
      expect(response.results[2]).toEqual({
        index: 2,
        id: "student-pass-3",
        userId: "usr-300",
        studentId: undefined,
        valid: true,
        nullifierHash: "nullifier-hash-3",
        discountEligible: true,
        discountCode: "STUDENT20",
        discountPercentage: 20,
      });
    });

    it("catches duplicate nullifiers within the same batch without halting subsequent proofs", async () => {
      isUniversityMerkleRootActive.mockResolvedValue(true);
      snarkjs.groth16.verify.mockResolvedValue(true);

      const request: BatchStudentDiscountRequest = {
        items: [
          {
            id: "claim-1",
            proof: {},
            publicSignals: ["root-1", "2026", "duplicate-nullifier-99"],
          },
          {
            id: "claim-2-dup",
            proof: {},
            publicSignals: ["root-1", "2026", "duplicate-nullifier-99"],
          },
          {
            id: "claim-3-valid",
            proof: {},
            publicSignals: ["root-1", "2026", "unique-nullifier-100"],
          },
        ],
      };

      const response = await verifyBatchStudentDiscountProofs(request);

      expect(response.totalCount).toBe(3);
      expect(response.verifiedCount).toBe(2);

      expect(response.results[0].index).toBe(0);
      expect(response.results[0].valid).toBe(true);

      expect(response.results[1].index).toBe(1);
      expect(response.results[1].valid).toBe(false);
      expect(response.results[1].error).toBe(
        "Duplicate nullifier detected within the same verification batch",
      );

      expect(response.results[2].index).toBe(2);
      expect(response.results[2].valid).toBe(true);
    });

    it("isolates inactive Merkle roots and reports correct indices", async () => {
      isUniversityMerkleRootActive
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      snarkjs.groth16.verify.mockResolvedValue(true);

      const request: BatchStudentDiscountRequest = {
        items: [
          { id: "root-ok", proof: {}, publicSignals: ["active-root", "2026", "null-1"] },
          { id: "root-bad", proof: {}, publicSignals: ["expired-root", "2026", "null-2"] },
          { id: "root-ok-2", proof: {}, publicSignals: ["active-root", "2026", "null-3"] },
        ],
      };

      const response = await verifyBatchStudentDiscountProofs(request);

      expect(response.totalCount).toBe(3);
      expect(response.verifiedCount).toBe(2);
      expect(response.results[1].index).toBe(1);
      expect(response.results[1].valid).toBe(false);
      expect(response.results[1].error).toBe("Invalid or inactive university Merkle root");
    });
  });

  // =========================================================================
  // 4. Cluster Merkle Hash Consistency
  // =========================================================================
  describe("computeClusterMerkleHash", () => {
    it("returns '0' for empty venue lists", () => {
      expect(computeClusterMerkleHash([])).toBe("0");
    });

    it("returns deterministic Merkle hash for ordered venue IDs", () => {
      const hash1 = computeClusterMerkleHash(["venue-10", "venue-20"]);
      const hash2 = computeClusterMerkleHash(["venue-20", "venue-10"]);
      expect(hash1).toBe(hash2);
    });
  });
});
