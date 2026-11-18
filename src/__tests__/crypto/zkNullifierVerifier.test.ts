import { ZkNullifierVerifier } from "../../../src/lib/crypto/zkNullifierVerifier";

jest.mock("snarkjs", () => ({
  groth16: {
    verify: jest.fn().mockResolvedValue(true),
  },
}));

describe("ZkNullifierVerifier - Batch Partitioning & Field Modulus", () => {
  let verifier: ZkNullifierVerifier;

  beforeEach(() => {
    verifier = new ZkNullifierVerifier();
    jest.clearAllMocks();
  });

  test("should successfully partition and verify batches from 1 to 64 nullifiers", async () => {
    for (let count = 1; count <= 64; count++) {
      const mockNullifiers = Array.from({ length: count }, (_, i) =>
        BigInt(1000 + i).toString(),
      );
      const mockProof = { pi_a: [], pi_b: [], pi_c: [] };
      const mockSignals = ["1"];

      const result = await verifier.verifyBatch(
        mockNullifiers,
        mockProof,
        mockSignals,
      );

      expect(result.verified).toBe(true);
      expect(result.processedNullifiers).toBe(count);
      expect(result.batchCount).toBe(Math.ceil(count / 32));
    }
  });

  test("should throw error when nullifier exceeds BN254 scalar field modulus", async () => {
    const invalidNullifier =
      "2188824287183927522246405745257275088548364400416034343698204186575808495618";
    const mockProof = { pi_a: [], pi_b: [], pi_c: [] };

    await expect(
      verifier.verifyBatch([invalidNullifier], mockProof, ["1"]),
    ).rejects.toThrow(/exceeds BN254 scalar field modulus/);
  });
});

import {
  verifyZkNullifierProofs,
  InMemoryNullifierStore,
  resetVerificationKey,
  type ZkNullifierProof,
} from "../../lib/crypto/zkNullifierVerifier";

describe("zkNullifierVerifier ZKP Replay Protection (#7962)", () => {
  const mockVk = { protocol: "groth16", curve: "bn128" };
  const mockProof: ZkNullifierProof = {
    proof: { pi_a: ["1", "2"], pi_b: [["3", "4"]], pi_c: ["5", "6"] },
    publicSignals: ["0xdeadbeef1234", "100"],
  };

  beforeEach(() => {
    resetVerificationKey();
  });

  it("returns MISSING_VERIFICATION_KEY when no verification key is provided or found", async () => {
    const results = await verifyZkNullifierProofs([mockProof], {
      verificationKey: null,
      verifier: async () => true,
    });

    expect(results).toHaveLength(1);
    expect(results[0].valid).toBe(false);
    expect(results[0].error).toBe("MISSING_VERIFICATION_KEY");
  });

  it("verifies valid proof with injected verification key and verifier", async () => {
    const store = new InMemoryNullifierStore();
    const results = await verifyZkNullifierProofs([mockProof], {
      verificationKey: mockVk,
      store,
      verifier: async () => true,
    });

    expect(results).toHaveLength(1);
    expect(results[0].valid).toBe(true);
    expect(results[0].nullifier).toBe("0xdeadbeef1234");
    expect(store.has("0xdeadbeef1234")).toBe(true);
  });

  it("blocks duplicate proof submissions with REPLAYED_NULLIFIER error", async () => {
    const store = new InMemoryNullifierStore();
    const options = {
      verificationKey: mockVk,
      store,
      verifier: async () => true,
    };

    const firstRun = await verifyZkNullifierProofs([mockProof], options);
    expect(firstRun[0].valid).toBe(true);

    const secondRun = await verifyZkNullifierProofs([mockProof], options);
    expect(secondRun[0].valid).toBe(false);
    expect(secondRun[0].error).toBe("REPLAYED_NULLIFIER");
    expect(secondRun[0].nullifier).toBe("0xdeadbeef1234");
  });

  it("permits re-verification without mutation when preventReplay is disabled", async () => {
    const store = new InMemoryNullifierStore();
    const options = {
      verificationKey: mockVk,
      store,
      preventReplay: false,
      verifier: async () => true,
    };

    const firstRun = await verifyZkNullifierProofs([mockProof], options);
    expect(firstRun[0].valid).toBe(true);
    expect(store.has("0xdeadbeef1234")).toBe(false);

    const secondRun = await verifyZkNullifierProofs([mockProof], options);
    expect(secondRun[0].valid).toBe(true);
  });

  it("returns INVALID_PROOF when cryptographic verification fails", async () => {
    const store = new InMemoryNullifierStore();
    const results = await verifyZkNullifierProofs([mockProof], {
      verificationKey: mockVk,
      store,
      verifier: async () => false,
    });

    expect(results[0].valid).toBe(false);
    expect(results[0].error).toBe("INVALID_PROOF");
    expect(store.has("0xdeadbeef1234")).toBe(false);
  });
});
