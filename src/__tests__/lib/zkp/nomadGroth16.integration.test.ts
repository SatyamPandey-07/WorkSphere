/** @jest-environment node */

import path from "path";
import * as snarkjs from "snarkjs";
import {
  createNomadProofChallenge,
  resetNomadVerificationKeyCache,
  verifyAndMintNomadPassportStamp,
} from "@/lib/zkp/nomadProofVerification";

jest.setTimeout(120_000);

describe("Nomad Groth16 integration", () => {
  const activity = {
    currentStreak: 14,
    totalDeepWorkMinutes: 6000,
  };

  const userId = "nomad-groth16-integration-user";

  let proof: unknown;
  let publicSignals: string[];

  beforeAll(async () => {
    process.env.NOMAD_ZKP_IDENTITY_KEY =
      "nomad-integration-test-key-at-least-32-bytes";
    process.env.ZKP_PASSPORT_KEY =
      "nomad-integration-test-signing-key-at-least-32-bytes";

    resetNomadVerificationKeyCache();

    const prepared = createNomadProofChallenge(
      userId,
      "NOMAD_100_HOURS",
      activity,
    );

    if (!prepared.ok) {
      throw new Error(prepared.error);
    }

    const wasmPath = path.join(
      process.cwd(),
      "public",
      "zkp",
      "nomad_productivity_proof.wasm",
    );

    const zkeyPath = path.join(
      process.cwd(),
      "public",
      "zkp",
      "nomad_productivity_proof.zkey",
    );

    const generated = await snarkjs.groth16.fullProve(
      prepared.challenge.input,
      wasmPath,
      zkeyPath,
    );

    proof = generated.proof;
    publicSignals = generated.publicSignals;
  }, 120_000);

  it("accepts a genuine Groth16 proof generated from the circuit", async () => {
    const result = await verifyAndMintNomadPassportStamp(
      userId,
      "NOMAD_100_HOURS",
      { proof, publicSignals },
      activity,
    );

    expect(result.isValid).toBe(true);

    if (result.isValid) {
      expect(result.stamp.badgeType).toBe("NOMAD_100_HOURS");
      expect(result.stamp.verificationSignature).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("rejects altered public signals", async () => {
    const alteredSignals = [...publicSignals];
    alteredSignals[4] = "1";

    const result = await verifyAndMintNomadPassportStamp(
      userId,
      "NOMAD_100_HOURS",
      { proof, publicSignals: alteredSignals },
      activity,
    );

    expect(result.isValid).toBe(false);
  });

  it("rejects tampered Groth16 proof coordinates", async () => {
    const tampered = JSON.parse(JSON.stringify(proof)) as {
      pi_a: string[];
    };

    tampered.pi_a[0] = (BigInt(tampered.pi_a[0]) + 1n).toString();

    const result = await verifyAndMintNomadPassportStamp(
      userId,
      "NOMAD_100_HOURS",
      { proof: tampered, publicSignals },
      activity,
    );

    expect(result.isValid).toBe(false);
  });

  it("rejects a proof when server-owned activity changes after the challenge", async () => {
    const changedActivity = {
      currentStreak: 15,
      totalDeepWorkMinutes: 6000,
    };

    const result = await verifyAndMintNomadPassportStamp(
      userId,
      "NOMAD_100_HOURS",
      { proof, publicSignals },
      changedActivity,
    );

    expect(result.isValid).toBe(false);
  });

  it("refuses unsupported multi-city badge claims", () => {
    const result = createNomadProofChallenge(
      userId,
      "MULTI_CITY_EXPLORER",
      activity,
    );

    expect(result.ok).toBe(false);
  });

  it("refuses activity below the server-defined threshold", () => {
    const result = createNomadProofChallenge(userId, "NOMAD_100_HOURS", {
      currentStreak: 14,
      totalDeepWorkMinutes: 5999,
    });

    expect(result.ok).toBe(false);
  });
  it.each([
    ["missing", undefined] as const,
    ["short", "short-secret"] as const,
  ])(
    "fails closed with a %s passport signing key in production",
    async (_case, signingKey) => {
      const originalKey = process.env.ZKP_PASSPORT_KEY;
      const originalNodeEnv = process.env.NODE_ENV;

      try {
        process.env.NODE_ENV = "production";

        if (signingKey === undefined) {
          delete process.env.ZKP_PASSPORT_KEY;
        } else {
          process.env.ZKP_PASSPORT_KEY = signingKey;
        }

        const result = await verifyAndMintNomadPassportStamp(
          userId,
          "NOMAD_100_HOURS",
          { proof, publicSignals },
          activity
        );

        expect(result).toMatchObject({
          isValid: false,
          code: "VERIFIER_UNAVAILABLE",
          status: 503,
        });
      } finally {
        if (originalKey === undefined) {
          delete process.env.ZKP_PASSPORT_KEY;
        } else {
          process.env.ZKP_PASSPORT_KEY = originalKey;
        }

        if (originalNodeEnv === undefined) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = originalNodeEnv;
        }
      }
    }
  );
});
