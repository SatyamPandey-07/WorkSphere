/**
 * Tests for the CSRF guard logic used by POST /api/auth/resend-otp.
 *
 * Directly exercises issueCsrfToken + verifyCsrfToken (the same calls the
 * route makes) without importing next/server, which is incompatible with
 * the jsdom test environment used by this project.
 */

import { issueCsrfToken, verifyCsrfToken } from "../../lib/csrf";

describe("resend-otp CSRF guard logic", () => {
  it("rejects when no cookie and no header are provided", async () => {
    const isValid = await verifyCsrfToken(undefined, undefined);
    expect(isValid).toBe(false);
  });

  it("rejects when the header doesn't match the cookie's raw value", async () => {
    const { cookieValue } = await issueCsrfToken();
    const isValid = await verifyCsrfToken(cookieValue, "wrong-token");
    expect(isValid).toBe(false);
  });

  it("rejects when only the header is present (no cookie)", async () => {
    const { raw } = await issueCsrfToken();
    const isValid = await verifyCsrfToken(undefined, raw);
    expect(isValid).toBe(false);
  });

  it("rejects when only the cookie is present (no header)", async () => {
    const { cookieValue } = await issueCsrfToken();
    const isValid = await verifyCsrfToken(cookieValue, undefined);
    expect(isValid).toBe(false);
  });

  it("accepts a valid matching cookie + header pair", async () => {
    const { cookieValue, raw } = await issueCsrfToken();
    const isValid = await verifyCsrfToken(cookieValue, raw);
    expect(isValid).toBe(true);
  });

  it("rejects a tampered cookie signature even with the correct raw header", async () => {
    const { cookieValue, raw } = await issueCsrfToken();
    const sep = cookieValue.lastIndexOf(".");
    const tampered = `${cookieValue.slice(0, sep)}.tampered`;
    const isValid = await verifyCsrfToken(tampered, raw);
    expect(isValid).toBe(false);
  });
});
