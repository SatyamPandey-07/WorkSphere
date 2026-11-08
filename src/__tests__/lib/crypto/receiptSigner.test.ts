import crypto from "crypto";
import {
  signReservationReceipt,
  verifyReservationReceipt,
  generateReceiptKeyPair,
  canonicalizeReceiptPayload,
  computeReceiptDigest,
  verifyRawBufferSignature,
  ReservationReceiptPayload,
  ALGORITHM_CONFIGS,
} from "@/lib/crypto/receiptSigner";

describe("Cryptographic Receipt Signing and Verification", () => {
  const samplePayload: ReservationReceiptPayload = {
    bookingId: "booking_12345",
    confirmationId: "WS-CONF-9876",
    venueId: "venue_abc",
    venueName: "Silicon Workspace Hub",
    userId: "user_789",
    userEmail: "developer@worksphere.app",
    date: "2026-10-04",
    time: "14:00",
    durationHours: 2,
    totalAmount: 32.4,
    currency: "USD",
    issuedAt: "2026-10-04T10:00:00.000Z",
    status: "CONFIRMED",
  };

  it("exposes algorithm configuration map with proper curve and hash mappings", () => {
    expect(ALGORITHM_CONFIGS["RSA-SHA256"].hash).toBe("SHA256");
    expect(ALGORITHM_CONFIGS["ECDSA-P256"].curve).toBe("prime256v1");
    expect(ALGORITHM_CONFIGS["ECDSA-P384"].curve).toBe("secp384r1");
    expect(ALGORITHM_CONFIGS["ECDSA-P384"].hash).toBe("SHA384");
  });

  it("canonicalizes receipt payload consistently regardless of key order and excludes undefined fields", () => {
    const permutedPayload = {
      status: "CONFIRMED",
      time: "14:00",
      bookingId: "booking_12345",
      date: "2026-10-04",
      venueName: "Silicon Workspace Hub",
      currency: "USD",
      confirmationId: "WS-CONF-9876",
      totalAmount: 32.4,
      userId: "user_789",
      venueId: "venue_abc",
      issuedAt: "2026-10-04T10:00:00.000Z",
      userEmail: "developer@worksphere.app",
      durationHours: 2,
      optionalUndefinedField: undefined,
    } as unknown as ReservationReceiptPayload;

    const canonical1 = canonicalizeReceiptPayload(samplePayload);
    const canonical2 = canonicalizeReceiptPayload(permutedPayload);
    expect(canonical1).toEqual(canonical2);

    // Ensure undefined fields are stripped completely from the canonical string
    expect(canonical2).not.toContain("optionalUndefinedField");

    const digest1 = computeReceiptDigest(canonical1);
    const digest2 = computeReceiptDigest(canonical2);
    expect(digest1).toEqual(digest2);
  });

  it("signs and verifies receipt using RSA-SHA256 digital signature", () => {
    const { publicKeyPem, privateKeyPem } = generateReceiptKeyPair("RSA");

    const signature = signReservationReceipt(samplePayload, {
      algorithm: "RSA-SHA256",
      privateKeyPem,
      publicKeyPem,
    });

    expect(signature.signature).toBeDefined();
    expect(signature.algorithm).toBe("RSA-SHA256");
    expect(signature.digest).toHaveLength(64);

    const verification = verifyReservationReceipt(
      samplePayload,
      signature.signature,
      publicKeyPem,
      "RSA-SHA256"
    );

    expect(verification.valid).toBe(true);
    expect(verification.digestMatches).toBe(true);
    expect(verification.signerIdentity).toBe("WorkSphere Cryptographic Authority");
  });

  it("signs and verifies receipt using ECDSA-P256 digital signature", () => {
    const { publicKeyPem, privateKeyPem } = generateReceiptKeyPair("ECDSA");

    const signature = signReservationReceipt(samplePayload, {
      algorithm: "ECDSA-P256",
      privateKeyPem,
      publicKeyPem,
    });

    expect(signature.signature).toBeDefined();
    expect(signature.algorithm).toBe("ECDSA-P256");

    const verification = verifyReservationReceipt(
      samplePayload,
      signature.signature,
      publicKeyPem,
      "ECDSA-P256"
    );

    expect(verification.valid).toBe(true);
    expect(verification.digestMatches).toBe(true);
  });

  it("signs and verifies receipt using ECDSA-P384 digital signature with 384-bit curve", () => {
    const { publicKeyPem, privateKeyPem } = generateReceiptKeyPair("ECDSA-P384");

    const signature = signReservationReceipt(samplePayload, {
      algorithm: "ECDSA-P384",
      privateKeyPem,
      publicKeyPem,
    });

    expect(signature.signature).toBeDefined();
    expect(signature.algorithm).toBe("ECDSA-P384");

    const verification = verifyReservationReceipt(
      samplePayload,
      signature.signature,
      publicKeyPem,
      "ECDSA-P384"
    );

    expect(verification.valid).toBe(true);
    expect(verification.digestMatches).toBe(true);
  });

  it("rejects verification when receipt totalAmount is modified after signing", () => {
    const { publicKeyPem, privateKeyPem } = generateReceiptKeyPair("RSA");

    const signature = signReservationReceipt(samplePayload, {
      algorithm: "RSA-SHA256",
      privateKeyPem,
      publicKeyPem,
    });

    const tamperedPayload: ReservationReceiptPayload = {
      ...samplePayload,
      totalAmount: 1000.0, // Tampered amount
    };

    const verification = verifyReservationReceipt(
      tamperedPayload,
      signature.signature,
      publicKeyPem,
      "RSA-SHA256"
    );

    expect(verification.valid).toBe(false);
    expect(verification.digestMatches).toBe(false);
  });

  it("rejects verification when receipt currency is modified after signing", () => {
    const { publicKeyPem, privateKeyPem } = generateReceiptKeyPair("ECDSA-P256");

    const signature = signReservationReceipt(samplePayload, {
      algorithm: "ECDSA-P256",
      privateKeyPem,
      publicKeyPem,
    });

    const tamperedPayload: ReservationReceiptPayload = {
      ...samplePayload,
      currency: "EUR", // Tampered currency
    };

    const verification = verifyReservationReceipt(
      tamperedPayload,
      signature.signature,
      publicKeyPem,
      "ECDSA-P256"
    );

    expect(verification.valid).toBe(false);
    expect(verification.digestMatches).toBe(false);
  });

  it("rejects verification when verified against an invalid/wrong public key", () => {
    const keyPair1 = generateReceiptKeyPair("RSA");
    const keyPair2 = generateReceiptKeyPair("RSA");

    const signature = signReservationReceipt(samplePayload, {
      algorithm: "RSA-SHA256",
      privateKeyPem: keyPair1.privateKeyPem,
      publicKeyPem: keyPair1.publicKeyPem,
    });

    const verification = verifyReservationReceipt(
      samplePayload,
      signature.signature,
      keyPair2.publicKeyPem, // Wrong public key
      "RSA-SHA256"
    );

    expect(verification.valid).toBe(false);
  });

  it("verifies signature regardless of initial key ordering in nested receipt structures (RFC 8785)", () => {
    const { publicKeyPem, privateKeyPem } = generateReceiptKeyPair("ECDSA-P256");

    const payloadWithNested = {
      bookingId: "booking_abc",
      confirmationId: "CONF-123",
      venueId: "venue_xyz",
      venueName: "Metro Hub",
      userId: "user_1",
      date: "2026-10-09",
      time: "10:00",
      totalAmount: 50,
      currency: "USD",
      issuedAt: "2026-10-09T00:00:00Z",
      status: "CONFIRMED",
      metadata: {
        zKey: "last",
        aKey: "first",
        nested: {
          beta: 2,
          alpha: 1,
        },
      },
    } as unknown as ReservationReceiptPayload;

    const signature = signReservationReceipt(payloadWithNested, {
      algorithm: "ECDSA-P256",
      privateKeyPem,
      publicKeyPem,
    });

    // Create an equivalent payload with completely reversed / shuffled key order at every level
    const shuffledPayload = {
      status: "CONFIRMED",
      metadata: {
        nested: {
          alpha: 1,
          beta: 2,
        },
        aKey: "first",
        zKey: "last",
      },
      time: "10:00",
      issuedAt: "2026-10-09T00:00:00Z",
      date: "2026-10-09",
      currency: "USD",
      totalAmount: 50,
      userId: "user_1",
      venueName: "Metro Hub",
      venueId: "venue_xyz",
      confirmationId: "CONF-123",
      bookingId: "booking_abc",
    } as unknown as ReservationReceiptPayload;

    const result = verifyReservationReceipt(
      shuffledPayload,
      signature.signature,
      publicKeyPem,
      "ECDSA-P256",
      signature.digest
    );

    expect(result.valid).toBe(true);
    expect(result.digestMatches).toBe(true);
  });

  describe("Raw Buffer Digital Signature Verification (PDF bytes)", () => {
    it("verifies valid raw PDF buffer signature using RSA-SHA256", () => {
      const pdfBytes = Buffer.from("%PDF-1.4 sample reservation receipt bytes");
      const { publicKeyPem, privateKeyPem } = generateReceiptKeyPair("RSA");

      // Sign raw buffer
      const signer = crypto.createSign("SHA256");
      signer.update(pdfBytes);
      signer.end();
      const signatureBase64 = signer.sign(
        {
          key: privateKeyPem,
          padding: crypto.constants.RSA_PKCS1_PADDING,
        },
        "base64"
      );

      const isValid = verifyRawBufferSignature(pdfBytes, signatureBase64, publicKeyPem, "RSA-SHA256");
      expect(isValid).toBe(true);

      // Corrupted buffer verification
      const corruptedBytes = Buffer.from("%PDF-1.4 tampered bytes");
      const isCorruptedValid = verifyRawBufferSignature(corruptedBytes, signatureBase64, publicKeyPem, "RSA-SHA256");
      expect(isCorruptedValid).toBe(false);
    });

    it("verifies valid raw PDF buffer signature using ECDSA-P384", () => {
      const pdfBytes = Buffer.from("%PDF-1.4 high security receipt");
      const { publicKeyPem, privateKeyPem } = generateReceiptKeyPair("ECDSA-P384");

      const signer = crypto.createSign("SHA384");
      signer.update(pdfBytes);
      signer.end();
      const signatureBase64 = signer.sign(
        {
          key: privateKeyPem,
          dsaEncoding: "der",
        },
        "base64"
      );

      const isValid = verifyRawBufferSignature(pdfBytes, signatureBase64, publicKeyPem, "ECDSA-P384");
      expect(isValid).toBe(true);

      const isCorruptedValid = verifyRawBufferSignature(
        Buffer.from("invalid content"),
        signatureBase64,
        publicKeyPem,
        "ECDSA-P384"
      );
      expect(isCorruptedValid).toBe(false);
    });
  });
});
