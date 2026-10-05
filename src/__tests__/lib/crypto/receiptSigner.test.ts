import {
  signReservationReceipt,
  verifyReservationReceipt,
  generateReceiptKeyPair,
  canonicalizeReceiptPayload,
  computeReceiptDigest,
  ReservationReceiptPayload,
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

  it("canonicalizes receipt payload consistently regardless of key order", () => {
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
    };

    const canonical1 = canonicalizeReceiptPayload(samplePayload);
    const canonical2 = canonicalizeReceiptPayload(permutedPayload);
    expect(canonical1).toEqual(canonical2);

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

  it("rejects verification when receipt payload is tampered with", () => {
    const { publicKeyPem, privateKeyPem } = generateReceiptKeyPair("RSA");

    const signature = signReservationReceipt(samplePayload, {
      algorithm: "RSA-SHA256",
      privateKeyPem,
      publicKeyPem,
    });

    const tamperedPayload: ReservationReceiptPayload = {
      ...samplePayload,
      totalAmount: 1000.0, // Tampered price
    };

    const verification = verifyReservationReceipt(
      tamperedPayload,
      signature.signature,
      publicKeyPem,
      "RSA-SHA256"
    );

    expect(verification.valid).toBe(false);
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
});
