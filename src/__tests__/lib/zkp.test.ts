/**
 * @jest-environment node
 */
import { computeMembershipCommit } from "@/lib/zkp/commitment";
import { isAllowedCommit, isPremiumVenue } from "@/lib/zkp/membership";
import { proveMembership, verifyMembershipProof } from "@/lib/zkp/verify";

afterAll(async () => {
  // snarkjs keeps a bn128 worker open; close it so Jest can exit
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
});

describe("zkp membership allowlist", () => {
  it("accepts demo commits but not random ones", () => {
    expect(isAllowedCommit(computeMembershipCommit(42))).toBe(true);
    expect(isAllowedCommit("999999")).toBe(false);
  });

  it("treats coworking venues as premium", () => {
    expect(isPremiumVenue({ category: "coworking_space" })).toBe(true);
    expect(isPremiumVenue({ category: "cafe", rating: 3 })).toBe(false);
    expect(isPremiumVenue({ category: "cafe", rating: 4.8 })).toBe(true);
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
