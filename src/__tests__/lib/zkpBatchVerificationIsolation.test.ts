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
import { POST as batchZkpVerifyPost } from "@/app/api/venues/batch-zkp-verify/route";
import * as zkNullifierVerifier from "@/lib/crypto/zkNullifierVerifier";
import { prisma } from "@/lib/prisma";

// Mock dependencies
jest.mock("@/lib/zkp/verify", () => ({
  verifyMembershipProof: jest.fn(),
}));

jest.mock("@/lib/zkp/poseidon", () => ({
  poseidonHash: jest.fn((inputs: bigint[]) => BigInt(inputs[0] || 1n) * 12345n),
}));

jest.mock("@/lib/zkp/studentMembership", () => ({
  isUniversityMerkleRootActive: jest.fn(),
}));

jest.mock("@/lib/prisma", () => {
  const mockPrisma = {
    studentClaimNullifier: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    venueCheckInNullifier: {
      createMany: jest.fn(),
    },
    user: {
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  mockPrisma.$transaction.mockImplementation(async (operation: any) =>
    typeof operation === "function" ? operation(mockPrisma) : Promise.all(operation),
  );
  return { prisma: mockPrisma };
});

jest.mock("fs", () => ({
  existsSync: jest.fn(() => true),
  readFileSync: jest.fn(() => JSON.stringify({ vk_type: "Groth16" })),
}));

jest.mock("snarkjs", () => ({
  groth16: {
    verify: jest.fn(),
  },
}));

import { verifyMembershipProof as verifyMembershipProofFunction } from "@/lib/zkp/verify";
import {
  isUniversityMerkleRootActive as isUniversityMerkleRootActiveFunction,
} from "@/lib/zkp/studentMembership";
import * as snarkjsModule from "snarkjs";

const verifyMembershipProof = verifyMembershipProofFunction as jest.Mock;
const isUniversityMerkleRootActive =
  isUniversityMerkleRootActiveFunction as jest.Mock;
const snarkjs = {
  groth16: { verify: snarkjsModule.groth16.verify as jest.Mock },
};

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

    describe("POST /api/venues/batch-zkp-verify", () => {
      const createProof = (nullifierHash: string, venueId = "venue-1") => ({
        nullifierHash,
        proof: {
          pi_a: ["1", "2"],
          pi_b: [
            ["1", "2"],
            ["3", "4"],
          ],
          pi_c: ["5", "6"],
        },
        publicSignals: ["root-1", nullifierHash, venueId, "2026"],
      });

      const post = (body: unknown) =>
        batchZkpVerifyPost({ json: async () => body } as any);

      beforeEach(() => {
        jest.restoreAllMocks();
        jest.clearAllMocks();
        snarkjs.groth16.verify.mockReset();
      });

      it("verifies and inserts a batch of 50 proofs in one serializable transaction", async () => {
        const proofs = Array.from({ length: 50 }, (_, index) =>
          createProof(`nullifier-${index}`),
        );
        jest
          .spyOn(zkNullifierVerifier, "verifyZkNullifierProofs")
          .mockResolvedValue(proofs.map(() => ({ valid: true })));
        (prisma.venueCheckInNullifier.createMany as jest.Mock).mockResolvedValue({
          count: proofs.length,
        });

        const response = await post({ venueId: "venue-1", proofs });
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload).toMatchObject({
          valid: true,
          venueId: "venue-1",
          verifiedCount: 50,
          storedCount: 50,
          totalCount: 50,
        });
        expect(payload.results).toHaveLength(50);
        expect(payload.results[49]).toMatchObject({
          index: 49,
          nullifierHash: "nullifier-49",
          proofValid: true,
          nullifierStored: true,
        });
        expect(zkNullifierVerifier.verifyZkNullifierProofs).toHaveBeenCalledTimes(1);
        expect(
          (prisma.venueCheckInNullifier.createMany as jest.Mock).mock.calls[0][0],
        ).toEqual({
          data: proofs.map((proof) => ({
            nullifierHash: proof.nullifierHash,
            epoch: 2026,
            venueId: "venue-1",
          })),
          skipDuplicates: false,
        });
        expect((prisma.$transaction as jest.Mock).mock.calls[0][1]).toEqual({
          isolationLevel: "Serializable",
        });
      });

      it("rejects a batch with an invalid proof without writing any nullifiers", async () => {
        const proofs = [createProof("nullifier-1"), createProof("nullifier-2")];
        jest
          .spyOn(zkNullifierVerifier, "verifyZkNullifierProofs")
          .mockResolvedValue([{ valid: true }, { valid: false }]);

        const response = await post({ venueId: "venue-1", proofs });
        const payload = await response.json();

        expect(response.status).toBe(422);
        expect(payload.verifiedCount).toBe(1);
        expect(payload.storedCount).toBe(0);
        expect(payload.results).toEqual([
          expect.objectContaining({
            index: 0,
            proofValid: true,
            nullifierStored: false,
            error: "Batch was not recorded because another proof failed.",
          }),
          expect.objectContaining({
            index: 1,
            proofValid: false,
            nullifierStored: false,
            error: "Invalid zero-knowledge proof.",
          }),
        ]);
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(prisma.venueCheckInNullifier.createMany).not.toHaveBeenCalled();
      });

      it("rolls back the batch when a nullifier conflicts with an already-spent value", async () => {
        const proofs = [createProof("nullifier-1"), createProof("nullifier-2")];
        jest
          .spyOn(zkNullifierVerifier, "verifyZkNullifierProofs")
          .mockResolvedValue(proofs.map(() => ({ valid: true })));
        (prisma.venueCheckInNullifier.createMany as jest.Mock).mockRejectedValue({
          code: "P2002",
        });

        const response = await post({ venueId: "venue-1", proofs });
        const payload = await response.json();

        expect(response.status).toBe(409);
        expect(payload.storedCount).toBe(0);
        expect(payload.results.every((result: any) => !result.nullifierStored)).toBe(
          true,
        );
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      });

      it("rejects a proof whose signals do not bind the requested venue and nullifier", async () => {
        const proof = createProof("nullifier-1", "other-venue");

        const response = await post({ venueId: "venue-1", proofs: [proof] });

        expect(response.status).toBe(400);
        expect(zkNullifierVerifier.verifyZkNullifierProofs).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      it("runs each Groth16 check concurrently within the proof batch", async () => {
        let started = 0;
        let release!: () => void;
        const allStarted = new Promise<void>((resolve) => {
          release = resolve;
        });

        snarkjs.groth16.verify.mockImplementation(async () => {
          started++;
          if (started === 2) release();
          await allStarted;
          return true;
        });

        const results = await zkNullifierVerifier.verifyZkNullifierProofs([
          { proof: {}, publicSignals: ["1"] },
          { proof: {}, publicSignals: ["2"] },
        ]);

        expect(started).toBe(2);
        expect(results).toEqual([{ valid: true }, { valid: true }]);
      });

      it("rejects batches larger than 50 before cryptographic verification", async () => {
        const proofs = Array.from({ length: 51 }, (_, index) =>
          createProof(`nullifier-${index}`),
        );

        const response = await post({ venueId: "venue-1", proofs });

        expect(response.status).toBe(400);
        expect(zkNullifierVerifier.verifyZkNullifierProofs).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
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
