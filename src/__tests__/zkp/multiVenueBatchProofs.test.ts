import {
  computeClusterMerkleHash,
  verifyMultiVenueBatchProofs,
  MultiVenueBatchVerifyRequest,
} from "@/lib/zkp/batch";

jest.mock("@/lib/zkp/verify", () => ({
  verifyMembershipProof: jest
    .fn()
    .mockImplementation(async (_proof, signals) => {
      if (signals && signals[0] === "invalid_signal") return false;
      return true;
    }),
}));

describe("ZKP Multi-Venue Selective Disclosure Proof Batching Engine", () => {
  const sampleProofPayload = {
    pi_a: ["123", "456", "1"],
    pi_b: [
      ["789", "012"],
      ["345", "678"],
    ],
    pi_c: ["901", "234", "1"],
    protocol: "groth16",
    curve: "bn128",
  };

  describe("computeClusterMerkleHash", () => {
    it("computes deterministic merkle hash for venue cluster", () => {
      const venues = ["venue_01", "venue_02", "venue_03"];
      const hash1 = computeClusterMerkleHash(venues);
      const hash2 = computeClusterMerkleHash([...venues].reverse());

      expect(hash1).toBeDefined();
      expect(typeof hash1).toBe("string");
      expect(hash1).toEqual(hash2);
    });

    it("handles single venue clusters", () => {
      const hash = computeClusterMerkleHash(["venue_single"]);
      expect(hash).toBeDefined();
    });

    it("handles empty venue cluster list gracefully", () => {
      const hash = computeClusterMerkleHash([]);
      expect(hash).toBe("0");
    });

    it("produces unique hashes for distinct venue clusters", () => {
      const hashA = computeClusterMerkleHash(["venue_10", "venue_20"]);
      const hashB = computeClusterMerkleHash(["venue_30", "venue_40"]);
      expect(hashA).not.toEqual(hashB);
    });
  });

  describe("verifyMultiVenueBatchProofs", () => {
    it("successfully verifies valid batch of multi-venue proofs", async () => {
      const request: MultiVenueBatchVerifyRequest = {
        clusterId: "cluster_sf_coworking",
        clusterMerkleRoot: "0xroot123456789",
        venueProofs: [
          {
            venueId: "venue_sf_01",
            proof: sampleProofPayload,
            publicSignals: ["0xcommit1"],
          },
          {
            venueId: "venue_sf_02",
            proof: sampleProofPayload,
            publicSignals: ["0xcommit2"],
          },
        ],
      };

      const result = await verifyMultiVenueBatchProofs(request);

      expect(result.valid).toBe(true);
      expect(result.verifiedCount).toBe(2);
      expect(result.totalCount).toBe(2);
      expect(result.results.length).toBe(2);
      expect(result.results[0].valid).toBe(true);
      expect(result.results[1].valid).toBe(true);
      expect(result.clusterHash).toBeDefined();
    });

    it("handles mixed valid and invalid proofs in batch", async () => {
      const request: MultiVenueBatchVerifyRequest = {
        clusterId: "cluster_mix",
        clusterMerkleRoot: "0xroot999",
        venueProofs: [
          {
            venueId: "venue_valid",
            proof: sampleProofPayload,
            publicSignals: ["0xvalid"],
          },
          {
            venueId: "venue_invalid",
            proof: sampleProofPayload,
            publicSignals: ["invalid_signal"],
          },
        ],
      };

      const result = await verifyMultiVenueBatchProofs(request);

      expect(result.valid).toBe(false);
      expect(result.verifiedCount).toBe(1);
      expect(result.totalCount).toBe(2);
      expect(result.results[0].valid).toBe(true);
      expect(result.results[1].valid).toBe(false);
      expect(result.results[1].error).toBe("Invalid ZK proof");
    });

    it("returns invalid status when proof array is empty", async () => {
      const request: MultiVenueBatchVerifyRequest = {
        clusterId: "cluster_empty",
        clusterMerkleRoot: "0x0",
        venueProofs: [],
      };

      const result = await verifyMultiVenueBatchProofs(request);

      expect(result.valid).toBe(false);
      expect(result.verifiedCount).toBe(0);
      expect(result.totalCount).toBe(0);
    });

    it("captures thrown errors during proof verification", async () => {
      const { verifyMembershipProof } = require("@/lib/zkp/verify");
      verifyMembershipProof.mockRejectedValueOnce(
        new Error("BN128 curve error"),
      );

      const request: MultiVenueBatchVerifyRequest = {
        clusterId: "cluster_error",
        clusterMerkleRoot: "0xerr",
        venueProofs: [
          {
            venueId: "venue_err",
            proof: sampleProofPayload,
            publicSignals: ["0xerr"],
          },
        ],
      };

      const result = await verifyMultiVenueBatchProofs(request);

      expect(result.valid).toBe(false);
      expect(result.results[0].valid).toBe(false);
      expect(result.results[0].error).toBe("BN128 curve error");
    });

    it("handles multi-venue cluster access verification for 5 concurrent venues", async () => {
      const venueProofs = [1, 2, 3, 4, 5].map((i) => ({
        venueId: `venue_cluster_${i}`,
        proof: sampleProofPayload,
        publicSignals: [`0xsignal_${i}`],
      }));

      const request: MultiVenueBatchVerifyRequest = {
        clusterId: "cluster_5_locations",
        clusterMerkleRoot: "0xroot555",
        venueProofs,
      };

      const result = await verifyMultiVenueBatchProofs(request);

      expect(result.valid).toBe(true);
      expect(result.verifiedCount).toBe(5);
      expect(result.totalCount).toBe(5);
    });
  });
});
