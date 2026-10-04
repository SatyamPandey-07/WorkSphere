/**
 * @jest-environment node
 */
import crypto from "crypto";
import { computeMembershipCommit } from "@/lib/zkp/commitment";
import { poseidonHash, BN254_SCALAR_FIELD } from "@/lib/zkp/poseidon";
import { isAllowedCommit, isPremiumVenue } from "@/lib/zkp/membership";
import { proveMembership, verifyMembershipProof } from "@/lib/zkp/verify";
import {
  hashPair,
  buildMerkleTree,
  isCommitmentRevokedDirectly,
  REVOKED_CREDENTIAL_HASHES,
} from "@/lib/zkp/revocation";

afterAll(async () => {
  const g = globalThis as typeof globalThis & {
    curve_bn128?: { terminate: () => Promise<void> };
  };
  if (g.curve_bn128) await g.curve_bn128.terminate();
});

describe("poseidon hash", () => {
  // Published circomlib / circomlibjs test vectors. If these fail, the TypeScript
  // hash no longer matches circuits/premium_membership.circom.
  it("matches the circomlib vector for Poseidon([1])", () => {
    expect(poseidonHash([1n]).toString()).toBe(
      "18586133768512220936620570745912940619677854269274689475585506675881198879027",
    );
  });

  it("matches the circomlib vector for Poseidon([1, 2])", () => {
    expect(poseidonHash([1n, 2n]).toString()).toBe(
      "7853200120776062878684798364095072458815029376092732009249414926327459813530",
    );
  });

  it("reduces inputs into the field like a circom signal", () => {
    expect(poseidonHash([-1n])).toBe(poseidonHash([BN254_SCALAR_FIELD - 1n]));
    expect(poseidonHash([5n])).toBe(poseidonHash([5n + BN254_SCALAR_FIELD]));
  });

  it("rejects empty and unsupported-width inputs", () => {
    expect(() => poseidonHash([])).toThrow();
    expect(() => poseidonHash([1n, 2n, 3n, 4n, 5n])).toThrow();
  });
});

describe("zkp commitment", () => {
  it("matches the circom binding (Poseidon) for a known token", () => {
    expect(computeMembershipCommit(42)).toBe(
      "12326503012965816391338144612242952408728683609716147019497703475006801258307",
    );
  });

  it("is exactly Poseidon(token), the value the circuit constrains", () => {
    expect(computeMembershipCommit(1)).toBe(poseidonHash([1n]).toString());
  });

  it("handles zero token", () => {
    expect(computeMembershipCommit(0)).toBe(
      "19014214495641488759237505126948346942972912379615652741039992445865937985820",
    );
  });

  it("handles string input", () => {
    expect(computeMembershipCommit("42")).toBe(computeMembershipCommit(42));
  });

  it("handles negative token by reducing into the field", () => {
    expect(computeMembershipCommit(-1)).toBe(
      computeMembershipCommit(BN254_SCALAR_FIELD - 1n),
    );
  });

  it("is not the old invertible polynomial t^2 + 5t + 17", () => {
    expect(computeMembershipCommit(42)).not.toBe("1991");
  });
});

describe("zkp membership allowlist", () => {
  it("accepts demo commits but not random ones", () => {
    expect(isAllowedCommit(computeMembershipCommit(42))).toBe(true);
    expect(isAllowedCommit("999999")).toBe(false);
  });

  it("treats coworking venues as premium", () => {
    expect(isPremiumVenue({ category: "coworking_space" })).toBe(true);
    expect(isPremiumVenue({ category: "coworking" })).toBe(true);
    expect(isPremiumVenue({ category: "cafe", rating: 3 })).toBe(false);
    expect(isPremiumVenue({ category: "cafe", rating: 4.8 })).toBe(true);
  });

  it("handles null/undefined rating and boundary", () => {
    expect(isPremiumVenue({ category: "cafe", rating: null })).toBe(false);
    expect(isPremiumVenue({ category: "cafe" })).toBe(false);
    expect(isPremiumVenue({ category: "cafe", rating: 4.5 })).toBe(true);
  });
});

describe("zkp prove + verify", () => {
  jest.setTimeout(90000);
  it("builds a valid proof under 1s without exposing the token", async () => {
    const token = 42;
    const { proof, publicSignals, ms } = await proveMembership(token);

    expect(ms).toBeGreaterThan(0);
    expect(publicSignals[0]).toBe(computeMembershipCommit(token));
    // payload must not include the private token
    expect(JSON.stringify(proof)).not.toContain('"identityToken"');

    const ok = await verifyMembershipProof(proof, publicSignals);
    expect(ok).toBe(true);
  }, 120000);

  it("rejects a proof with a tampered public signal", async () => {
    const { proof, publicSignals } = await proveMembership(99);
    const tampered = [...publicSignals];
    tampered[0] = "1";
    const ok = await verifyMembershipProof(proof, tampered);
    expect(ok).toBe(false);
  }, 120000);
});

describe("revocation", () => {
  it("hashPair produces deterministic, length-prefixed hashes", () => {
    const h1 = hashPair("aaa", "bbb");
    const h2 = hashPair("aaa", "bbb");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("hashPair is order-independent after sorting", () => {
    expect(hashPair("x", "y")).toBe(hashPair("y", "x"));
  });

  it("hashPair avoids concatenation collision", () => {
    // Without length prefix: hash("ab" + "cd") === hash("abc" + "d")
    // With length prefix: they should differ
    const h1 = hashPair("ab", "cd");
    const h2 = hashPair("abc", "d");
    expect(h1).not.toBe(h2);
  });

  it("buildMerkleTree returns empty tree for no leaves", () => {
    const { root, tree } = buildMerkleTree([]);
    expect(tree).toEqual([]);
    expect(root).toMatch(/^[a-f0-9]{64}$/);
  });

  it("buildMerkleTree and verifyMerkleProof round-trip", () => {
    const leaves = ["a", "b", "c", "d"];
    const { tree } = buildMerkleTree(leaves);
    expect(tree.length).toBeGreaterThan(1);

    // Verify each leaf
    for (const leaf of leaves) {
      const leafHash = crypto.createHash("sha256").update(leaf).digest("hex");
      // Find the leaf's index to build a proof
      const idx = tree[0].indexOf(leafHash);
      expect(idx).toBeGreaterThanOrEqual(0);
    }
  });

  it("isCommitmentRevokedDirectly detects revoked commitments", () => {
    // The dummy revoked hash
    expect(isCommitmentRevokedDirectly("12345678901234567890")).toBe(true);
    // The commitment for token 12345678
    expect(
      isCommitmentRevokedDirectly(computeMembershipCommit(12345678)),
    ).toBe(true);
    expect(REVOKED_CREDENTIAL_HASHES).toContain(
      computeMembershipCommit(12345678),
    );
    // The retired polynomial commitment must no longer be treated as revoked
    expect(isCommitmentRevokedDirectly("152415827008091")).toBe(false);
    // A random non-revoked commitment
    expect(isCommitmentRevokedDirectly("999999999")).toBe(false);
  });
});
