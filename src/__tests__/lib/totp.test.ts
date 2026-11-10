import {
  buildOtpauthUri,
  formatSecretForDisplay,
  normalizeTotpSecret,
} from "@/lib/auth/totp";

const SECRET = "JBSWY3DPEHPK3PXP";

describe("normalizeTotpSecret", () => {
  it("accepts a valid base32 secret", () => {
    expect(normalizeTotpSecret(SECRET)).toBe(SECRET);
  });

  it("removes spaces and hyphens, uppercases and drops trailing padding", () => {
    expect(normalizeTotpSecret("jbsw y3dp-ehpk 3pxp")).toBe(SECRET);
    expect(normalizeTotpSecret(`${SECRET}====`)).toBe(SECRET);
  });

  it("rejects characters outside the base32 alphabet", () => {
    expect(normalizeTotpSecret("JBSWY3DPEHPK3PX1")).toBeNull(); // 1
    expect(normalizeTotpSecret("JBSWY3DPEHPK3PX0")).toBeNull(); // 0
    expect(normalizeTotpSecret("JBSWY3DPEHPK3PX!")).toBeNull();
  });

  it("rejects secrets that are too short or too long", () => {
    expect(normalizeTotpSecret("JBSWY3DP")).toBeNull();
    expect(normalizeTotpSecret("A".repeat(15))).toBeNull();
    expect(normalizeTotpSecret("A".repeat(16))).toBe("A".repeat(16));
    expect(normalizeTotpSecret("A".repeat(64))).toBe("A".repeat(64));
    expect(normalizeTotpSecret("A".repeat(65))).toBeNull();
  });

  it("rejects empty and non-string values", () => {
    expect(normalizeTotpSecret("")).toBeNull();
    expect(normalizeTotpSecret("   ")).toBeNull();
    expect(normalizeTotpSecret(null)).toBeNull();
    expect(normalizeTotpSecret(undefined)).toBeNull();
  });
});

describe("formatSecretForDisplay", () => {
  it("groups the secret in blocks of four", () => {
    expect(formatSecretForDisplay(SECRET)).toBe("JBSW Y3DP EHPK 3PXP");
  });

  it("handles a length that is not a multiple of four", () => {
    expect(formatSecretForDisplay("A".repeat(18))).toBe(
      "AAAA AAAA AAAA AAAA AA",
    );
  });

  it("normalizes before grouping", () => {
    expect(formatSecretForDisplay("jbsw y3dp ehpk 3pxp")).toBe(
      "JBSW Y3DP EHPK 3PXP",
    );
  });

  it("returns an empty string for an invalid secret", () => {
    expect(formatSecretForDisplay("nope")).toBe("");
    expect(formatSecretForDisplay(null)).toBe("");
  });
});

describe("buildOtpauthUri", () => {
  it("builds the standard provisioning URI", () => {
    expect(
      buildOtpauthUri({
        issuer: "WorkSphere",
        account: "alex@example.com",
        secret: SECRET,
      }),
    ).toBe(
      "otpauth://totp/WorkSphere:alex%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=WorkSphere",
    );
  });

  it("percent-encodes the issuer and account", () => {
    const uri = buildOtpauthUri({
      issuer: "Work Sphere",
      account: "a&b@x.com",
      secret: SECRET,
    });
    expect(uri).toBe(
      "otpauth://totp/Work%20Sphere:a%26b%40x.com?secret=JBSWY3DPEHPK3PXP&issuer=Work%20Sphere",
    );
  });

  it("encodes a colon in the issuer so the label stays unambiguous", () => {
    const uri = buildOtpauthUri({
      issuer: "A:B",
      account: "me",
      secret: SECRET,
    });
    expect(uri).toContain("otpauth://totp/A%3AB:me?");
  });

  it("normalizes the secret", () => {
    const uri = buildOtpauthUri({
      issuer: "WorkSphere",
      account: "me",
      secret: "jbsw y3dp ehpk 3pxp",
    });
    expect(uri).toContain("secret=JBSWY3DPEHPK3PXP");
  });

  it("produces a URI that can be parsed back", () => {
    const uri = buildOtpauthUri({
      issuer: "WorkSphere",
      account: "alex@example.com",
      secret: SECRET,
    }) as string;
    const url = new URL(uri);

    expect(url.protocol).toBe("otpauth:");
    expect(url.host).toBe("totp");
    expect(decodeURIComponent(url.pathname.slice(1))).toBe(
      "WorkSphere:alex@example.com",
    );
    expect(url.searchParams.get("secret")).toBe(SECRET);
    expect(url.searchParams.get("issuer")).toBe("WorkSphere");
  });

  it("returns null for an invalid secret, issuer or account", () => {
    expect(
      buildOtpauthUri({ issuer: "WorkSphere", account: "me", secret: "bad" }),
    ).toBeNull();
    expect(
      buildOtpauthUri({ issuer: "  ", account: "me", secret: SECRET }),
    ).toBeNull();
    expect(
      buildOtpauthUri({ issuer: "WorkSphere", account: "", secret: SECRET }),
    ).toBeNull();
  });
});
