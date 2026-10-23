/**
 * Pure helpers for TOTP authenticator setup: secret validation and display,
 * and the otpauth:// provisioning URI that authenticator apps read from a QR
 * code. Secrets must be generated and stored on the server; nothing here
 * creates one.
 */

/** Shortest accepted base32 secret (80 bits, the minimum most apps accept). */
export const MIN_SECRET_LENGTH = 16;
/** Longest accepted secret; keeps the QR code within the encoder's capacity. */
export const MAX_SECRET_LENGTH = 64;

const BASE32_PATTERN = /^[A-Z2-7]+$/;

/**
 * Cleans a base32 TOTP secret: removes spaces, hyphens and trailing "=",
 * uppercases it, and checks it is valid base32 of an accepted length.
 * Returns null when the value is not usable.
 */
export function normalizeTotpSecret(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/[\s-]+/g, "")
    .replace(/=+$/, "")
    .toUpperCase();
  if (
    cleaned.length < MIN_SECRET_LENGTH ||
    cleaned.length > MAX_SECRET_LENGTH ||
    !BASE32_PATTERN.test(cleaned)
  ) {
    return null;
  }
  return cleaned;
}

/**
 * Groups a secret in blocks of four for easier manual entry
 * ("JBSW Y3DP EHPK 3PXP"). Returns an empty string for an invalid secret.
 */
export function formatSecretForDisplay(
  value: string | null | undefined,
): string {
  const normalized = normalizeTotpSecret(value);
  if (!normalized) return "";
  return (normalized.match(/.{1,4}/g) ?? []).join(" ");
}

export interface OtpauthUriInput {
  issuer: string;
  account: string;
  secret: string;
}

/**
 * Builds the otpauth://totp provisioning URI:
 *   otpauth://totp/Issuer:account?secret=BASE32&issuer=Issuer
 * The issuer and account are percent-encoded, so spaces, "@" and "&" stay
 * valid. Returns null when the secret, issuer or account is missing or invalid.
 */
export function buildOtpauthUri({
  issuer,
  account,
  secret,
}: OtpauthUriInput): string | null {
  const normalized = normalizeTotpSecret(secret);
  const issuerName = typeof issuer === "string" ? issuer.trim() : "";
  const accountName = typeof account === "string" ? account.trim() : "";
  if (!normalized || !issuerName || !accountName) return null;

  const encodedIssuer = encodeURIComponent(issuerName);
  const label = `${encodedIssuer}:${encodeURIComponent(accountName)}`;
  return `otpauth://totp/${label}?secret=${normalized}&issuer=${encodedIssuer}`;
}
