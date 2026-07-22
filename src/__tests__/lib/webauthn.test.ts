import {
  isMobileWebview,
  isOriginAllowedForRpId,
  normalizeRpId,
  parseClientDataJSON,
  verifyWebAuthnChallenge,
} from "@/lib/webauthn";
import { getExpectedOrigin } from "@/lib/passkey";

function toClientDataJSON(data: object): string {
  const json = JSON.stringify(data);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

describe("isMobileWebview", () => {
  const ios175WKWebViewUA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
  const iosCustomAppUA =
    "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WorkSphereApp/1.0";
  const iosSafariUA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const desktopChromeUA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  const androidWebviewUA =
    "Mozilla/5.0 (Linux; U; Android 14; en-us; Pixel 8 Build/UD1A.230803.022) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.144 Mobile Safari/537.36 wv";

  it("identifies iOS 17.5 WKWebView embeds as mobile webview", () => {
    expect(isMobileWebview(ios175WKWebViewUA)).toBe(true);
    expect(isMobileWebview(iosCustomAppUA)).toBe(true);
    expect(isMobileWebview(androidWebviewUA)).toBe(true);
  });

  it("returns false for standard desktop and mobile browsers", () => {
    expect(isMobileWebview(iosSafariUA)).toBe(false);
    expect(isMobileWebview(desktopChromeUA)).toBe(false);
    expect(isMobileWebview(null)).toBe(false);
    expect(isMobileWebview(undefined)).toBe(false);
  });
});

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
    expect(normalizeRpId("https://embed.worksphere.app")).toBe(
      "worksphere.app",
    );
  });

  it("keeps localhost as-is", () => {
    delete process.env.WEBAUTHN_RP_ID;
    expect(normalizeRpId("http://localhost:3000")).toBe("localhost");
  });
});

describe("isOriginAllowedForRpId", () => {
  const ios175WKWebViewUA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

  it("allows the apex and its subdomains", () => {
    expect(
      isOriginAllowedForRpId("https://worksphere.app", "worksphere.app"),
    ).toBe(true);
    expect(
      isOriginAllowedForRpId(
        "https://staging.worksphere.app",
        "worksphere.app",
      ),
    ).toBe(true);
    expect(
      isOriginAllowedForRpId(
        "https://foo.bar.worksphere.app",
        "worksphere.app",
      ),
    ).toBe(true);
  });

  it("rejects unrelated hosts for standard user agent", () => {
    expect(
      isOriginAllowedForRpId("https://evil.example.com", "worksphere.app"),
    ).toBe(false);
    expect(
      isOriginAllowedForRpId(
        "https://worksphere.app.evil.com",
        "worksphere.app",
      ),
    ).toBe(false);
  });

  it("relaxes exact match origin check for recognized mobile webview user agents", () => {
    expect(
      isOriginAllowedForRpId(
        "ios-app://custom-wrapper",
        "worksphere.app",
        ios175WKWebViewUA,
      ),
    ).toBe(true);
    expect(
      isOriginAllowedForRpId(
        "apple-touch-icon://embed",
        "worksphere.app",
        ios175WKWebViewUA,
      ),
    ).toBe(true);
  });
});

describe("verifyWebAuthnChallenge", () => {
  const prev = process.env.WEBAUTHN_RP_ID;
  const ios175WKWebViewUA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

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

  it("returns signature error for non-matching origin on standard browser UA", () => {
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

  it("succeeds for mobile webview UA even with custom embed origin", () => {
    const result = verifyWebAuthnChallenge({
      origin: "apple-touch-icon://embed",
      challenge: "abc123",
      expectedChallenge: "abc123",
      userAgent: ios175WKWebViewUA,
    });
    expect(result).toEqual({ ok: true, rpId: "worksphere.app" });
  });
});

describe("getExpectedOrigin", () => {
  const ios175WKWebViewUA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

  it("returns single origin for standard request", () => {
    const req = new Request("https://worksphere.app/api/auth/passkey/verify", {
      headers: { host: "worksphere.app" },
    });
    expect(getExpectedOrigin(req)).toBe("https://worksphere.app");
  });

  it("returns array including clientDataOrigin for iOS WKWebView user agent", () => {
    const req = new Request("https://worksphere.app/api/auth/passkey/verify", {
      headers: {
        host: "worksphere.app",
        "user-agent": ios175WKWebViewUA,
      },
    });
    expect(getExpectedOrigin(req, "apple-touch-icon://embed")).toEqual([
      "https://worksphere.app",
      "apple-touch-icon://embed",
    ]);
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
