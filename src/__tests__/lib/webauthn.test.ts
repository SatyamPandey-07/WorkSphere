import {
  isOriginAllowedForRpId,
  normalizeRpId,
  parseClientDataJSON,
  verifyWebAuthnChallenge,
} from "@/lib/webauthn";

function toClientDataJSON(data: object): string {
  const json = JSON.stringify(data);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("normalizeRpId", () => {
  const prev = process.env.WEBAUTHN_RP_ID;

  afterEach(() => {
    if (prev === undefined) delete process.env.WEBAUTHN_RP_ID;
    else process.env.WEBAUTHN_RP_ID = prev;
  });

  it("uses WEBAUTHN_RP_ID when set", () => {
    process.env.WEBAUTHN_RP_ID = "worksphere.app";
    expect(normalizeRpId("https://staging.worksphere.app")).toBe(
      "worksphere.app",
    );
  });

  it("derives parent domain from a staging subdomain", () => {
    delete process.env.WEBAUTHN_RP_ID;
    expect(normalizeRpId("https://staging.worksphere.app")).toBe(
      "worksphere.app",
    );
    expect(normalizeRpId("https://embed.worksphere.app")).toBe("worksphere.app");
  });

  it("keeps localhost as-is", () => {
    delete process.env.WEBAUTHN_RP_ID;
    expect(normalizeRpId("http://localhost:3000")).toBe("localhost");
  });
});

describe("isOriginAllowedForRpId", () => {
  it("allows the apex and its subdomains", () => {
    expect(
      isOriginAllowedForRpId("https://worksphere.app", "worksphere.app"),
    ).toBe(true);
    expect(
      isOriginAllowedForRpId("https://staging.worksphere.app", "worksphere.app"),
    ).toBe(true);
    expect(
      isOriginAllowedForRpId("https://foo.bar.worksphere.app", "worksphere.app"),
    ).toBe(true);
  });

  it("rejects unrelated hosts", () => {
    expect(
      isOriginAllowedForRpId("https://evil.example.com", "worksphere.app"),
    ).toBe(false);
    expect(
      isOriginAllowedForRpId("https://worksphere.app.evil.com", "worksphere.app"),
    ).toBe(false);
  });
});

describe("verifyWebAuthnChallenge", () => {
  const prev = process.env.WEBAUTHN_RP_ID;

  beforeEach(() => {
    process.env.WEBAUTHN_RP_ID = "worksphere.app";
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.WEBAUTHN_RP_ID;
    else process.env.WEBAUTHN_RP_ID = prev;
  });

  it("accepts a staging subdomain when RP ID is the parent", () => {
    const result = verifyWebAuthnChallenge({
      origin: "https://staging.worksphere.app",
      challenge: "abc123",
      expectedChallenge: "abc123",
    });
    expect(result).toEqual({ ok: true, rpId: "worksphere.app" });
  });

  it("returns the signature error when the challenge does not match", () => {
    const result = verifyWebAuthnChallenge({
      origin: "https://staging.worksphere.app",
      challenge: "nope",
      expectedChallenge: "abc123",
    });
    expect(result).toEqual({
      ok: false,
      error: "Invalid WebAuthn challenge signature",
    });
  });

  it("returns the signature error for an origin outside the RP ID", () => {
    const result = verifyWebAuthnChallenge({
      origin: "https://not-ours.example.com",
      challenge: "abc123",
      expectedChallenge: "abc123",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Invalid WebAuthn challenge signature");
    }
  });
});

describe("parseClientDataJSON", () => {
  it("round-trips a clientData payload", () => {
    const encoded = toClientDataJSON({
      type: "webauthn.get",
      challenge: "chal",
      origin: "https://staging.worksphere.app",
    });
    expect(parseClientDataJSON(encoded)).toEqual({
      type: "webauthn.get",
      challenge: "chal",
      origin: "https://staging.worksphere.app",
    });
  });
});
