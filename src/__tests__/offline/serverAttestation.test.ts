/**
 * src/__tests__/offline/serverAttestation.test.ts
 *
 * Verifies asymmetric device attestation, replay protection, canonical payload
 * integrity, revocation, and server ingestion handling (#10165).
 */

import {
  generateDeviceKeyPair,
  registerDeviceCredential,
  revokeDeviceCredential,
  clearAttestationRegistries,
  buildCanonicalCheckinString,
  signCheckinAttestation,
  verifyCheckinSignature,
  verifyAndConsumeAttestation,
  CanonicalCheckinPayload,
  ATTESTATION_PROTOCOL_VERSION,
  MAX_CLOCK_SKEW_MS,
  MAX_OFFLINE_AGE_MS,
} from "@/lib/offline/deviceAttestation";
import { POST } from "@/app/api/checkin/route";

describe("Server-Verifiable Replay-Resistant Offline Check-in Attestation Protocol (#10165)", () => {
  const testUserId = "user_nomad_99";
  const testDeviceId = "device_macbook_pro_1";

  beforeEach(() => {
    clearAttestationRegistries();
  });

  afterEach(() => {
    clearAttestationRegistries();
  });

  it("1. Valid offline check-in produces verifiable signature and completes attestation", async () => {
    const keyPair = await generateDeviceKeyPair(true);
    registerDeviceCredential(testDeviceId, testUserId, keyPair.publicKeySpkiHex);

    const payload: CanonicalCheckinPayload = {
      protocolVersion: ATTESTATION_PROTOCOL_VERSION,
      userId: testUserId,
      deviceId: testDeviceId,
      venueId: "venue-sf-hub",
      seatId: "seat-desk-12",
      timestamp: Date.now() - 10000,
      clientNonce: "nonce-valid-1",
      idempotencyKey: "ik-valid-1",
    };

    const signature = await signCheckinAttestation(payload, keyPair.privateKey);
    expect(signature).toBeDefined();
    expect(typeof signature).toBe("string");

    const result = await verifyAndConsumeAttestation(payload, signature, testUserId);
    expect(result.valid).toBe(true);
    expect(result.status).toBe(200);
    expect(result.idempotent).toBe(false);
  });

  it("2. Modifying seat ID after signing invalidates the signature", async () => {
    const keyPair = await generateDeviceKeyPair(true);
    registerDeviceCredential(testDeviceId, testUserId, keyPair.publicKeySpkiHex);

    const payload: CanonicalCheckinPayload = {
      protocolVersion: ATTESTATION_PROTOCOL_VERSION,
      userId: testUserId,
      deviceId: testDeviceId,
      venueId: "venue-sf-hub",
      seatId: "seat-desk-12",
      timestamp: Date.now() - 5000,
      clientNonce: "nonce-seat-tamper",
      idempotencyKey: "ik-seat-tamper",
    };

    const signature = await signCheckinAttestation(payload, keyPair.privateKey);

    // Tamper seatId
    const tamperedPayload = { ...payload, seatId: "seat-desk-999" };
    const result = await verifyAndConsumeAttestation(tamperedPayload, signature, testUserId);

    expect(result.valid).toBe(false);
    expect(result.status).toBe(400);
    expect(result.code).toBe("INVALID_SIGNATURE");
  });

  it("3. Modifying venue ID after signing invalidates the signature", async () => {
    const keyPair = await generateDeviceKeyPair(true);
    registerDeviceCredential(testDeviceId, testUserId, keyPair.publicKeySpkiHex);

    const payload: CanonicalCheckinPayload = {
      protocolVersion: ATTESTATION_PROTOCOL_VERSION,
      userId: testUserId,
      deviceId: testDeviceId,
      venueId: "venue-sf-hub",
      seatId: "seat-desk-12",
      timestamp: Date.now() - 5000,
      clientNonce: "nonce-venue-tamper",
      idempotencyKey: "ik-venue-tamper",
    };

    const signature = await signCheckinAttestation(payload, keyPair.privateKey);

    // Tamper venueId
    const tamperedPayload = { ...payload, venueId: "venue-tokyo-hub" };
    const result = await verifyAndConsumeAttestation(tamperedPayload, signature, testUserId);

    expect(result.valid).toBe(false);
    expect(result.status).toBe(400);
    expect(result.code).toBe("INVALID_SIGNATURE");
  });

  it("4. Reused nonce on a different check-in operation is rejected as a replay attack", async () => {
    const keyPair = await generateDeviceKeyPair(true);
    registerDeviceCredential(testDeviceId, testUserId, keyPair.publicKeySpkiHex);

    const payload1: CanonicalCheckinPayload = {
      protocolVersion: ATTESTATION_PROTOCOL_VERSION,
      userId: testUserId,
      deviceId: testDeviceId,
      seatId: "seat-desk-01",
      timestamp: Date.now() - 5000,
      clientNonce: "reused-nonce-xyz",
      idempotencyKey: "ik-first-op",
    };
    const sig1 = await signCheckinAttestation(payload1, keyPair.privateKey);
    const res1 = await verifyAndConsumeAttestation(payload1, sig1, testUserId);
    expect(res1.valid).toBe(true);

    // Second operation reusing same nonce
    const payload2: CanonicalCheckinPayload = {
      protocolVersion: ATTESTATION_PROTOCOL_VERSION,
      userId: testUserId,
      deviceId: testDeviceId,
      seatId: "seat-desk-02",
      timestamp: Date.now() - 3000,
      clientNonce: "reused-nonce-xyz",
      idempotencyKey: "ik-second-op",
    };
    const sig2 = await signCheckinAttestation(payload2, keyPair.privateKey);
    const res2 = await verifyAndConsumeAttestation(payload2, sig2, testUserId);

    expect(res2.valid).toBe(false);
    expect(res2.status).toBe(409);
    expect(res2.code).toBe("NONCE_REPLAYED");
  });

  it("5. Retrying the exact same valid operation is idempotent", async () => {
    const keyPair = await generateDeviceKeyPair(true);
    registerDeviceCredential(testDeviceId, testUserId, keyPair.publicKeySpkiHex);

    const payload: CanonicalCheckinPayload = {
      protocolVersion: ATTESTATION_PROTOCOL_VERSION,
      userId: testUserId,
      deviceId: testDeviceId,
      seatId: "seat-desk-retry",
      timestamp: Date.now() - 2000,
      clientNonce: "nonce-retry-idemp",
      idempotencyKey: "ik-retry-idemp",
    };
    const sig = await signCheckinAttestation(payload, keyPair.privateKey);

    const res1 = await verifyAndConsumeAttestation(payload, sig, testUserId);
    expect(res1.valid).toBe(true);
    expect(res1.idempotent).toBe(false);

    // Identical retry
    const res2 = await verifyAndConsumeAttestation(payload, sig, testUserId);
    expect(res2.valid).toBe(true);
    expect(res2.idempotent).toBe(true);
  });

  it("6. Revoked device credential rejects new check-in attestations", async () => {
    const keyPair = await generateDeviceKeyPair(true);
    registerDeviceCredential(testDeviceId, testUserId, keyPair.publicKeySpkiHex);
    revokeDeviceCredential(testDeviceId);

    const payload: CanonicalCheckinPayload = {
      protocolVersion: ATTESTATION_PROTOCOL_VERSION,
      userId: testUserId,
      deviceId: testDeviceId,
      seatId: "seat-revoked-dev",
      timestamp: Date.now() - 1000,
      clientNonce: "nonce-revoked",
      idempotencyKey: "ik-revoked",
    };
    const sig = await signCheckinAttestation(payload, keyPair.privateKey);
    const result = await verifyAndConsumeAttestation(payload, sig, testUserId);

    expect(result.valid).toBe(false);
    expect(result.status).toBe(403);
    expect(result.code).toBe("DEVICE_REVOKED");
  });

  it("7. Excessively skewed or expired timestamp is rejected", async () => {
    const keyPair = await generateDeviceKeyPair(true);
    registerDeviceCredential(testDeviceId, testUserId, keyPair.publicKeySpkiHex);

    const now = Date.now();

    // In future beyond 5 minutes
    const futurePayload: CanonicalCheckinPayload = {
      protocolVersion: ATTESTATION_PROTOCOL_VERSION,
      userId: testUserId,
      deviceId: testDeviceId,
      seatId: "seat-fut",
      timestamp: now + MAX_CLOCK_SKEW_MS + 60000,
      clientNonce: "nonce-fut",
      idempotencyKey: "ik-fut",
    };
    const futSig = await signCheckinAttestation(futurePayload, keyPair.privateKey);
    const resFut = await verifyAndConsumeAttestation(futurePayload, futSig, testUserId, now);
    expect(resFut.valid).toBe(false);
    expect(resFut.code).toBe("TIMESTAMP_IN_FUTURE");

    // Older than 7 days
    const expiredPayload: CanonicalCheckinPayload = {
      protocolVersion: ATTESTATION_PROTOCOL_VERSION,
      userId: testUserId,
      deviceId: testDeviceId,
      seatId: "seat-exp",
      timestamp: now - MAX_OFFLINE_AGE_MS - 60000,
      clientNonce: "nonce-exp",
      idempotencyKey: "ik-exp",
    };
    const expSig = await signCheckinAttestation(expiredPayload, keyPair.privateKey);
    const resExp = await verifyAndConsumeAttestation(expiredPayload, expSig, testUserId, now);
    expect(resExp.valid).toBe(false);
    expect(resExp.code).toBe("TIMESTAMP_EXPIRED");
  });

  it("8. User substitution is rejected when device belongs to another user", async () => {
    const keyPair = await generateDeviceKeyPair(true);
    registerDeviceCredential(testDeviceId, testUserId, keyPair.publicKeySpkiHex);

    const payload: CanonicalCheckinPayload = {
      protocolVersion: ATTESTATION_PROTOCOL_VERSION,
      userId: "attacker_user",
      deviceId: testDeviceId,
      seatId: "seat-impersonate",
      timestamp: Date.now() - 1000,
      clientNonce: "nonce-attacker",
      idempotencyKey: "ik-attacker",
    };
    const sig = await signCheckinAttestation(payload, keyPair.privateKey);
    const result = await verifyAndConsumeAttestation(payload, sig, "attacker_user");

    expect(result.valid).toBe(false);
    expect(result.code).toBe("DEVICE_USER_MISMATCH");
  });

  it("9. Canonical string builder serializes all key dimensions deterministically", () => {
    const payload: CanonicalCheckinPayload = {
      protocolVersion: 2,
      userId: "u1",
      deviceId: "d1",
      venueId: "v1",
      seatId: "s1",
      timestamp: 123456789,
      clientNonce: "n1",
      idempotencyKey: "ik1",
    };
    const s1 = buildCanonicalCheckinString(payload);
    const s2 = buildCanonicalCheckinString(payload);
    expect(s1).toEqual(s2);
    expect(s1).toBe("v=2|uid=u1|dev=d1|ven=v1|seat=s1|ts=123456789|nonce=n1|ik=ik1");
  });

  describe("API Route Integration: /api/checkin", () => {
    it("handles verified attestation via POST /api/checkin successfully", async () => {
      const keyPair = await generateDeviceKeyPair(true);
      registerDeviceCredential(testDeviceId, testUserId, keyPair.publicKeySpkiHex);

      const payload: CanonicalCheckinPayload = {
        protocolVersion: ATTESTATION_PROTOCOL_VERSION,
        userId: testUserId,
        deviceId: testDeviceId,
        venueId: "venue-api-test",
        seatId: "seat-desk-api",
        timestamp: Date.now() - 5000,
        clientNonce: "nonce-api-1",
        idempotencyKey: "ik-api-1",
      };
      const signature = await signCheckinAttestation(payload, keyPair.privateKey);

      const req = new Request("http://localhost:3000/api/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          signature,
        }),
      });

      const response = await POST(req);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.seatId).toBe("seat-desk-api");
    });

    it("returns HTTP 409 on idempotent repeated sync through /api/checkin", async () => {
      const keyPair = await generateDeviceKeyPair(true);
      registerDeviceCredential(testDeviceId, testUserId, keyPair.publicKeySpkiHex);

      const payload: CanonicalCheckinPayload = {
        protocolVersion: ATTESTATION_PROTOCOL_VERSION,
        userId: testUserId,
        deviceId: testDeviceId,
        seatId: "seat-idemp-api",
        timestamp: Date.now() - 5000,
        clientNonce: "nonce-api-idemp",
        idempotencyKey: "ik-api-idemp",
      };
      const signature = await signCheckinAttestation(payload, keyPair.privateKey);

      const makeReq = () =>
        new Request("http://localhost:3000/api/checkin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, signature }),
        });

      const res1 = await POST(makeReq());
      expect(res1.status).toBe(200);

      const res2 = await POST(makeReq());
      expect(res2.status).toBe(409);
      const data2 = await res2.json();
      expect(data2.idempotent).toBe(true);
    });

    it("returns HTTP 400 when missing seatId", async () => {
      const req = new Request("http://localhost:3000/api/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "u1" }),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });
  });
});
