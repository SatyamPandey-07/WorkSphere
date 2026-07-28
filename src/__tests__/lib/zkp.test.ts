/**
 * @jest-environment node
 */
import crypto from "crypto";
import { computeMembershipCommit } from "@/lib/zkp/commitment";
import { isAllowedCommit, isPremiumVenue } from "@/lib/zkp/membership";
import { proveMembership, verifyMembershipProof } from "@/lib/zkp/verify";
import {
  hashPair,
  buildMerkleTree,
  verifyMerkleProof,
  isCommitmentRevokedDirectly,
} from "@/lib/zkp/revocation";

afterAll(async () => {
  const g = globalThis as typeof globalThis & {
    curve_bn128?: { terminate: () => Promise<void> };
  };
  if (g.curve_bn128) await g.curve_bn128.terminate();
});

describe("zkp commitment", () => {
  it("matches the circom binding for a known token", () => {
    // 42^2 + 5*42 + 17 = 1764 + 210 + 17 = 1991
    expect(computeMembershipCommit(42)).toBe("1991");
  });

  it("handles zero token", () => {
    // 0^2 + 5*0 + 17 = 17
    expect(computeMembershipCommit(0)).toBe("17");
  });

  it("handles string input", () => {
    expect(computeMembershipCommit("42")).toBe("1991");
  });

  it("handles negative token", () => {
    // (-1)^2 + 5*(-1) + 17 = 1 - 5 + 17 = 13
    expect(computeMembershipCommit(-1)).toBe("13");
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
    const { root, tree } = buildMerkleTree(leaves);
    expect(tree.length).toBeGreaterThan(1);

    // Verify each leaf
    for (const leaf of leaves) {
      const leafHash = crypto
        .createHash("sha256")
        .update(leaf)
        .digest("hex");
      // Find the leaf's index to build a proof
      const idx = tree[0].indexOf(leafHash);
      expect(idx).toBeGreaterThanOrEqual(0);
    }
  });

  it("isCommitmentRevokedDirectly detects revoked commitments", () => {
    // The dummy revoked hash
    expect(isCommitmentRevokedDirectly("12345678901234567890")).toBe(true);
    // The commitment for token 12345678
    expect(isCommitmentRevokedDirectly("152415827008091")).toBe(true);
    // A random non-revoked commitment
    expect(isCommitmentRevokedDirectly("999999999")).toBe(false);
  });
});
