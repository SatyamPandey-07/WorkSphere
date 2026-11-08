/**
 * MerkleBadgeLedger.test.ts
 * Tests for zero-knowledge badge membership verification, SnarkJS Groth16 proof validation,
 * and nullifier tracking to prevent double-spending of single-use cafe discount passes (#5420).
 */

import {
  MerkleBadgeLedger,
  Groth16Proof,
} from "@/core/ledger/MerkleBadgeLedger";

// Mock snarkjs
jest.mock("snarkjs", () => ({
  groth16: {
    verify: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const snarkjs = require("snarkjs");

describe("MerkleBadgeLedger ZK Groth16 & Nullifier Double-Spending Verification (#5420)", () => {
  const mockVKey = {
    protocol: "groth16",
    curve: "bn128",
    nPublic: 2,
    vk_alpha_1: ["1", "2", "3"],
    vk_beta_2: [
      ["1", "2"],
      ["3", "4"],
      ["5", "6"],
    ],
    vk_gamma_2: [
      ["1", "2"],
      ["3", "4"],
      ["5", "6"],
    ],
    vk_delta_2: [
      ["1", "2"],
      ["3", "4"],
      ["5", "6"],
    ],
    IC: [
      ["1", "2", "3"],
      ["4", "5", "6"],
    ],
  };

  const sampleProof: Groth16Proof = {
    pi_a: ["1000", "2000", "1"],
    pi_b: [
      ["3000", "4000"],
      ["5000", "6000"],
      ["1", "0"],
    ],
    pi_c: ["7000", "8000", "1"],
    protocol: "groth16",
    curve: "bn128",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    MerkleBadgeLedger.setDefaultVerificationKey(mockVKey);
  });

  describe("Standard & Anonymous Credential Issuance", () => {
    it("issues standard badges and verifies basic Merkle proofs for backward compatibility", () => {
      const ledger = new MerkleBadgeLedger();
      ledger.issueBadge({
        badgeId: "badge-001",
        userId: "user-alice",
        issuedAt: 1700000000000,
        questId: "quest-wifi-champion",
      });

      const root = ledger.getRootHash();
      expect(root).not.toBeNull();

      const proof = ledger.generateProof("badge-001", "user-alice");
      expect(proof).not.toBeNull();
      expect(MerkleBadgeLedger.verifyProof(proof!)).toBe(true);
    });

    it("issues anonymous credentials using commitments without exposing wallet addresses", () => {
      const ledger = new MerkleBadgeLedger();

      const secret = "nomad_super_secret_seed_123";
      const badgeId = "tier1_discount_pass";
      const commitment = MerkleBadgeLedger.computeCredentialCommitment(
        secret,
        badgeId,
        "cafe-perk",
      );

      ledger.issueAnonymousCredential(commitment, "cafe-perk");

      const root = ledger.getRootHash();
      expect(root).toBe(commitment); // Single leaf root matches leaf hash
    });

    it("computes deterministic nullifier hashes without revealing secret or badge serial number", () => {
      const secret = "user_private_secret_key";
      const passId = "cafe_pass_2026_q1";
      const nullifier1 = MerkleBadgeLedger.computeNullifierHash(
        secret,
        passId,
        "venue_salt",
      );
      const nullifier2 = MerkleBadgeLedger.computeNullifierHash(
        secret,
        passId,
        "venue_salt",
      );
      const nullifierDifferentPass = MerkleBadgeLedger.computeNullifierHash(
        secret,
        "different_pass",
        "venue_salt",
      );

      expect(nullifier1).toBe(nullifier2);
      expect(nullifier1).not.toBe(nullifierDifferentPass);
      expect(typeof nullifier1).toBe("string");
      expect(nullifier1).toHaveLength(64); // SHA-256 hex string
    });
  });

  describe("SnarkJS Groth16 Proof Verification", () => {
    it("successfully accepts a valid Groth16 ZK proof verified by SnarkJS", async () => {
      snarkjs.groth16.verify.mockResolvedValue(true);

      const publicSignals = ["root_hash_123", "nullifier_hash_abc"];
      const isValid = await MerkleBadgeLedger.verifyZkProof(
        sampleProof,
        publicSignals,
        mockVKey,
      );

      expect(isValid).toBe(true);
      expect(snarkjs.groth16.verify).toHaveBeenCalledWith(
        mockVKey,
        publicSignals,
        sampleProof,
      );
    });

    it("rejects counterfeit Groth16 ZK proofs when SnarkJS verification fails", async () => {
      snarkjs.groth16.verify.mockResolvedValue(false);

      const counterfeitProof: Groth16Proof = {
        pi_a: ["9999", "0000", "1"],
        pi_b: [
          ["0000", "0000"],
          ["0000", "0000"],
          ["1", "0"],
        ],
        pi_c: ["0000", "0000", "1"],
        protocol: "groth16",
        curve: "bn128",
      };

      const publicSignals = ["root_hash_123", "fake_nullifier"];
      const isValid = await MerkleBadgeLedger.verifyZkProof(
        counterfeitProof,
        publicSignals,
        mockVKey,
      );

      expect(isValid).toBe(false);
      expect(snarkjs.groth16.verify).toHaveBeenCalledWith(
        mockVKey,
        publicSignals,
        counterfeitProof,
      );
    });

    it("handles thrown errors from SnarkJS gracefully and returns false", async () => {
      snarkjs.groth16.verify.mockRejectedValue(
        new Error("Invalid point on elliptic curve"),
      );

      const publicSignals = ["root_hash_123", "nullifier_hash_abc"];
      const isValid = await MerkleBadgeLedger.verifyZkProof(
        sampleProof,
        publicSignals,
        mockVKey,
      );

      expect(isValid).toBe(false);
    });

    it("returns false immediately when proof or publicSignals are missing", async () => {
      expect(await MerkleBadgeLedger.verifyZkProof(null as any, ["root"])).toBe(
        false,
      );
      expect(
        await MerkleBadgeLedger.verifyZkProof(sampleProof, null as any),
      ).toBe(false);
    });
  });

  describe("Nullifier Verification & Double-Spending Prevention", () => {
    it("accepts valid unspent single-use cafe discount pass and marks nullifier as spent", async () => {
      snarkjs.groth16.verify.mockResolvedValue(true);

      const ledger = new MerkleBadgeLedger();
      const commitment = MerkleBadgeLedger.computeCredentialCommitment(
        "secret_1",
        "badge_1",
        "perk",
      );
      ledger.addCredentialLeaf(commitment);
      const root = ledger.getRootHash()!;

      const nullifier = MerkleBadgeLedger.computeNullifierHash(
        "secret_1",
        "pass_cafe_1",
      );
      const publicSignals = [root, nullifier];

      expect(ledger.isNullifierSpent(nullifier)).toBe(false);

      const result = await ledger.redeemDiscountPass(
        sampleProof,
        publicSignals,
        {
          nullifierHash: nullifier,
          expectedRoot: root,
          vKey: mockVKey,
        },
      );

      expect(result.success).toBe(true);
      expect(result.nullifierHash).toBe(nullifier);
      expect(ledger.isNullifierSpent(nullifier)).toBe(true);
      expect(ledger.getSpentNullifiers()).toContain(nullifier);
    });

    it("rejects double-spending when a nomad attempts to reuse the same nullifier pass", async () => {
      snarkjs.groth16.verify.mockResolvedValue(true);

      const ledger = new MerkleBadgeLedger();
      const root = "authorized_root_hash";
      ledger.addCredentialLeaf(root);

      const nullifier = "single_use_nullifier_xyz";
      const publicSignals = [root, nullifier];

      // First redemption: success
      const firstAttempt = await ledger.redeemDiscountPass(
        sampleProof,
        publicSignals,
        {
          nullifierHash: nullifier,
          expectedRoot: root,
          vKey: mockVKey,
        },
      );
      expect(firstAttempt.success).toBe(true);
      expect(ledger.isNullifierSpent(nullifier)).toBe(true);

      // Second redemption with identical nullifier: MUST be rejected
      const secondAttempt = await ledger.redeemDiscountPass(
        sampleProof,
        publicSignals,
        {
          nullifierHash: nullifier,
          expectedRoot: root,
          vKey: mockVKey,
        },
      );

      expect(secondAttempt.success).toBe(false);
      expect(secondAttempt.error).toContain("Double-spending detected");
      // SnarkJS should not even be invoked on the second attempt because double-spend is caught upfront
      expect(snarkjs.groth16.verify).toHaveBeenCalledTimes(1);
    });

    it("rejects counterfeit ZK proof and DOES NOT mark nullifier as spent", async () => {
      snarkjs.groth16.verify.mockResolvedValue(false);

      const ledger = new MerkleBadgeLedger();
      const root = "authorized_root_hash";
      ledger.addCredentialLeaf(root);

      const nullifier = "counterfeit_nullifier_attempt";
      const publicSignals = [root, nullifier];

      const result = await ledger.redeemDiscountPass(
        sampleProof,
        publicSignals,
        {
          nullifierHash: nullifier,
          expectedRoot: root,
          vKey: mockVKey,
        },
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("counterfeit proof rejected");
      expect(ledger.isNullifierSpent(nullifier)).toBe(false);
      expect(ledger.getSpentNullifiers()).not.toContain(nullifier);
    });

    it("rejects proof when public signals do not match authorized Merkle root", async () => {
      snarkjs.groth16.verify.mockResolvedValue(true);

      const ledger = new MerkleBadgeLedger();
      ledger.addCredentialLeaf("valid_credential_root_123");

      const nullifier = "some_nullifier_hash";
      const unauthorizedRoot = "attacker_merkle_root_666";
      const publicSignals = [unauthorizedRoot, nullifier];

      const result = await ledger.redeemDiscountPass(
        sampleProof,
        publicSignals,
        {
          nullifierHash: nullifier,
          expectedRoot: "valid_credential_root_123",
          vKey: mockVKey,
        },
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Merkle root mismatch");
      expect(ledger.isNullifierSpent(nullifier)).toBe(false);
      expect(snarkjs.groth16.verify).not.toHaveBeenCalled();
    });

    it("permits multiple distinct nomads to redeem passes with different nullifiers", async () => {
      snarkjs.groth16.verify.mockResolvedValue(true);

      const ledger = new MerkleBadgeLedger();
      const root = "common_merkle_root";
      ledger.addCredentialLeaf(root);

      const nullifier1 = "nullifier_user_alice";
      const nullifier2 = "nullifier_user_bob";

      const res1 = await ledger.redeemDiscountPass(
        sampleProof,
        [root, nullifier1],
        { nullifierHash: nullifier1 },
      );
      const res2 = await ledger.redeemDiscountPass(
        sampleProof,
        [root, nullifier2],
        { nullifierHash: nullifier2 },
      );

      expect(res1.success).toBe(true);
      expect(res2.success).toBe(true);
      expect(ledger.isNullifierSpent(nullifier1)).toBe(true);
      expect(ledger.isNullifierSpent(nullifier2)).toBe(true);
      expect(ledger.getSpentNullifiers()).toHaveLength(2);
    });

    it("resets spent nullifiers when requested", () => {
      const ledger = new MerkleBadgeLedger();
      ledger.markNullifierSpent("n1");
      ledger.markNullifierSpent("n2");
      expect(ledger.getSpentNullifiers()).toHaveLength(2);

      ledger.resetSpentNullifiers();
      expect(ledger.getSpentNullifiers()).toHaveLength(0);
      expect(ledger.isNullifierSpent("n1")).toBe(false);
    });
  });
});
