import {
  createTeamPassAttestationSignature,
  verifyTeamPassAttestationSignature,
  type TeamPassAttestationPayload,
} from "@/lib/security/teamPassAttestation";

describe("Team pass attestation signatures (#10241)", () => {
  const secret = "test-team-pass-secret-with-at-least-32-characters";

  const payload: TeamPassAttestationPayload = {
    attestationId: "attestation-001",
    venueId: "venue-001",
    memberId: "member-001",
    nonce: "unique-nonce-001",
    issuedAt: "2026-11-26T10:00:00.000Z",
    expiresAt: "2026-11-26T11:00:00.000Z",
  };

  it("creates a deterministic SHA-256 HMAC signature", () => {
    const first = createTeamPassAttestationSignature(payload, secret);
    const second = createTeamPassAttestationSignature(payload, secret);

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("verifies an authentic attestation", () => {
    const signature = createTeamPassAttestationSignature(payload, secret);

    expect(verifyTeamPassAttestationSignature(payload, signature, secret)).toBe(
      true,
    );
  });

  it("rejects modified attestation claims", () => {
    const signature = createTeamPassAttestationSignature(payload, secret);

    const modified = {
      ...payload,
      memberId: "forged-member",
    };

    expect(
      verifyTeamPassAttestationSignature(modified, signature, secret),
    ).toBe(false);
  });

  it("rejects a signature generated with another secret", () => {
    const signature = createTeamPassAttestationSignature(payload, secret);

    expect(
      verifyTeamPassAttestationSignature(
        payload,
        signature,
        "another-secret-with-at-least-32-characters",
      ),
    ).toBe(false);
  });

  it("rejects malformed signatures", () => {
    expect(
      verifyTeamPassAttestationSignature(payload, "invalid-signature", secret),
    ).toBe(false);
  });

  it("rejects missing or weak secrets", () => {
    expect(() => createTeamPassAttestationSignature(payload, "weak")).toThrow();

    expect(
      verifyTeamPassAttestationSignature(payload, "a".repeat(64), "weak"),
    ).toBe(false);
  });

  it("rejects invalid timestamps", () => {
    const invalid = {
      ...payload,
      issuedAt: "not-a-date",
    };

    expect(() => createTeamPassAttestationSignature(invalid, secret)).toThrow();
  });

  it("rejects expiry earlier than issue time", () => {
    const invalid = {
      ...payload,
      expiresAt: "2026-11-26T09:00:00.000Z",
    };

    expect(
      verifyTeamPassAttestationSignature(invalid, "a".repeat(64), secret),
    ).toBe(false);
  });
});
