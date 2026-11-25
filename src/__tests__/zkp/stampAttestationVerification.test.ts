import crypto from "crypto";
import { verifyServerPassportStampAttestation } from "@/lib/zkp/stampAttestationVerification";
import {
  PASSPORT_SIGNING_KEY,
  computeNomadSignatureFingerprint,
  type PassportStamp,
} from "@/lib/zkp/nomadProof";

describe("verifyServerPassportStampAttestation", () => {
  const validStamp: PassportStamp = {
    stampId: "STAMP-TEST-2026-A1B2C3D4",
    badgeType: "NOMAD_100_HOURS",
    tierTitle: "100-Hour Focus Master",
    epoch: 2026,
    issuedAt: "2026-10-15T12:00:00.000Z",
    nullifierHash:
      "a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0",
    verificationSignature: "",
    svgMarkup: "<svg></svg>",
    venueName: "Tokyo Focus Roastery",
  };

  beforeAll(() => {
    // Generate valid HMAC signature for validStamp
    const sigPayload = `${validStamp.stampId}:${validStamp.badgeType}:${validStamp.nullifierHash}:${validStamp.epoch}`;
    validStamp.verificationSignature = crypto
      .createHmac("sha256", PASSPORT_SIGNING_KEY)
      .update(sigPayload)
      .digest("hex");
  });

  it("1. Successfully verifies a stamp with authoritative server signature", () => {
    const result = verifyServerPassportStampAttestation({
      stampId: validStamp.stampId,
      badgeType: validStamp.badgeType,
      nullifierHash: validStamp.nullifierHash,
      epoch: validStamp.epoch,
      verificationSignature: validStamp.verificationSignature,
      issuedAt: validStamp.issuedAt,
    });

    expect(result.status).toBe("verified");
    expect(result.verified).toBe(true);
    expect(result.timestamp).toBe(validStamp.issuedAt);
    expect(result.signatureFingerprint).toBe(
      computeNomadSignatureFingerprint(validStamp.verificationSignature),
    );
    expect(result.error).toBeUndefined();
  });

  it("2. Returns pending status for offline stamp lacking server signature", () => {
    const resultNoSig = verifyServerPassportStampAttestation({
      stampId: validStamp.stampId,
      badgeType: validStamp.badgeType,
      nullifierHash: validStamp.nullifierHash,
      epoch: validStamp.epoch,
      verificationSignature: "",
      issuedAt: validStamp.issuedAt,
    });

    expect(resultNoSig.status).toBe("pending");
    expect(resultNoSig.verified).toBe(false);
    expect(resultNoSig.timestamp).toBe(validStamp.issuedAt);
    expect(resultNoSig.signatureFingerprint).toBeNull();
    expect(resultNoSig.error).toMatch(
      /offline stamp has not yet received server verification/i,
    );

    const resultExplicitPending = verifyServerPassportStampAttestation({
      stampId: validStamp.stampId,
      badgeType: validStamp.badgeType,
      nullifierHash: validStamp.nullifierHash,
      epoch: validStamp.epoch,
      verificationSignature: "pending_server_verification",
      issuedAt: validStamp.issuedAt,
    });
    expect(resultExplicitPending.status).toBe("pending");
  });

  it("3. Rejects tampered or invalid cryptographic signatures safely", () => {
    const tamperedSig =
      "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
    const result = verifyServerPassportStampAttestation({
      stampId: validStamp.stampId,
      badgeType: validStamp.badgeType,
      nullifierHash: validStamp.nullifierHash,
      epoch: validStamp.epoch,
      verificationSignature: tamperedSig,
      issuedAt: validStamp.issuedAt,
    });

    expect(result.status).toBe("invalid");
    expect(result.verified).toBe(false);
    expect(result.signatureFingerprint).toBeNull();
    expect(result.error).toMatch(/signature mismatch or invalid/i);
  });

  it("4. Rejects tampered stamp identity (e.g. Tampered stampId or badgeType)", () => {
    const resultTamperedId = verifyServerPassportStampAttestation({
      stampId: "STAMP-TAMPERED-ID",
      badgeType: validStamp.badgeType,
      nullifierHash: validStamp.nullifierHash,
      epoch: validStamp.epoch,
      verificationSignature: validStamp.verificationSignature,
      issuedAt: validStamp.issuedAt,
    });

    expect(resultTamperedId.status).toBe("invalid");
    expect(resultTamperedId.verified).toBe(false);
  });

  it("5. Handles missing or malformed input safely without throwing", () => {
    const emptyResult = verifyServerPassportStampAttestation({});
    expect(emptyResult.status).toBe("invalid");
    expect(emptyResult.verified).toBe(false);
    expect(emptyResult.error).toMatch(/missing required stamp/i);

    const missingNullifier = verifyServerPassportStampAttestation({
      stampId: "s1",
      badgeType: "b1",
      epoch: 2026,
    });
    expect(missingNullifier.status).toBe("invalid");
  });

  it("6. Correctly computes signature fingerprint", () => {
    const rawSig =
      "8f7e2a9b3c4d5e6f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f";
    const fp = computeNomadSignatureFingerprint(rawSig);
    expect(fp).toBe("8f7e2a9b...1c2d3e4f");

    expect(computeNomadSignatureFingerprint("")).toBe("");
    expect(computeNomadSignatureFingerprint("short")).toBe("short");
  });
});
