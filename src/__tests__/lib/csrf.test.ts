import { issueCsrfToken, verifyCsrfToken } from "../../lib/csrf";

describe("CSRF token utilities", () => {
  it("issues a signed token containing a raw part and a signature part", async () => {
    const { cookieValue, raw } = await issueCsrfToken();
    expect(cookieValue).toContain(".");
    expect(cookieValue.startsWith(raw)).toBe(true);
  });

  it("verifies a freshly issued token against its own raw value", async () => {
    const { cookieValue, raw } = await issueCsrfToken();
    const isValid = await verifyCsrfToken(cookieValue, raw);
    expect(isValid).toBe(true);
  });

  it("rejects when the header token doesn't match the cookie's raw value", async () => {
    const { cookieValue } = await issueCsrfToken();
    const isValid = await verifyCsrfToken(cookieValue, "some-other-value");
    expect(isValid).toBe(false);
  });

  it("rejects a cookie whose signature was tampered with", async () => {
    const { cookieValue, raw } = await issueCsrfToken();
    const separatorIndex = cookieValue.lastIndexOf(".");
    const tampered = `${cookieValue.slice(0, separatorIndex)}.tampered-signature`;
    const isValid = await verifyCsrfToken(tampered, raw);
    expect(isValid).toBe(false);
  });

  it("rejects when the cookie is missing", async () => {
    const isValid = await verifyCsrfToken(undefined, "any-token");
    expect(isValid).toBe(false);
  });

  it("rejects when the header is missing", async () => {
    const { cookieValue } = await issueCsrfToken();
    const isValid = await verifyCsrfToken(cookieValue, undefined);
    expect(isValid).toBe(false);
  });

  it("produces different raw tokens on each call", async () => {
    const first = await issueCsrfToken();
    const second = await issueCsrfToken();
    expect(first.raw).not.toEqual(second.raw);
  });
});
