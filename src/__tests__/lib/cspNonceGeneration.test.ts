/**
 * Tests for Content Security Policy nonce generation and validation.
 */

function generateNonce(length = 16): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < length; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}

function isValidNonce(nonce: string, minLength = 16): boolean {
  return /^[A-Za-z0-9+/=]+$/.test(nonce) && nonce.length >= minLength;
}

function buildCspHeader(nonces: string[]): string {
  const scriptSrc = nonces.map((n) => `'nonce-${n}'`).join(" ");
  return `default-src 'self'; script-src 'self' ${scriptSrc}; style-src 'self' 'unsafe-inline';`;
}

function extractNoncesFromCsp(csp: string): string[] {
  const matches = csp.match(/'nonce-([^']+)'/g) ?? [];
  return matches.map((m) => m.replace(/^'nonce-|'$/g, ""));
}

describe("CSP nonce generation", () => {
  it("generated nonce has correct length", () => {
    expect(generateNonce(16)).toHaveLength(16);
  });

  it("generated nonces are different each time", () => {
    expect(generateNonce()).not.toBe(generateNonce()); // statistically always different
  });

  it("isValidNonce: alphanumeric → valid", () => {
    expect(isValidNonce("ABCDabcd12345678")).toBe(true);
  });

  it("isValidNonce: too short → invalid", () => {
    expect(isValidNonce("abc", 16)).toBe(false);
  });

  it("isValidNonce: spaces → invalid", () => {
    expect(isValidNonce("abc def gh ijklm")).toBe(false);
  });

  it("buildCspHeader includes nonce directives", () => {
    const csp = buildCspHeader(["abc123", "xyz789"]);
    expect(csp).toContain("'nonce-abc123'");
    expect(csp).toContain("'nonce-xyz789'");
  });

  it("buildCspHeader: no nonces still has script-src", () => {
    expect(buildCspHeader([])).toContain("script-src");
  });

  it("extractNoncesFromCsp recovers nonces", () => {
    const csp = buildCspHeader(["abc123", "xyz789"]);
    const nonces = extractNoncesFromCsp(csp);
    expect(nonces).toContain("abc123");
    expect(nonces).toContain("xyz789");
  });

  it("extractNoncesFromCsp: no nonces → empty array", () => {
    expect(extractNoncesFromCsp("default-src 'self'")).toHaveLength(0);
  });
});
