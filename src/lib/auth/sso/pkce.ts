import crypto from "crypto";

/**
 * Generates a high-entropy cryptographically random string to be used as the PKCE Code Verifier.
 * The length should be between 43 and 128 characters according to RFC 7636.
 *
 * @param length - The length of the verifier (default 128)
 * @returns A base64url encoded string
 */
export function generateCodeVerifier(length = 128): string {
  if (length < 43 || length > 128) {
    throw new Error("Code verifier length must be between 43 and 128 characters");
  }
  return crypto.randomBytes(length).toString("base64url").substring(0, length);
}

/**
 * Generates a PKCE Code Challenge derived from the Code Verifier using the S256 method.
 *
 * @param verifier - The code verifier generated previously
 * @returns A base64url encoded SHA-256 hash of the verifier
 */
export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Validates a given verifier against an existing challenge using the S256 method.
 *
 * @param verifier - The code verifier provided by the client during token exchange
 * @param challenge - The code challenge previously stored during the authorization request
 * @returns boolean indicating if the verifier is valid
 */
export function validateCodeVerifier(verifier: string, challenge: string): boolean {
  const expectedChallenge = generateCodeChallenge(verifier);
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedChallenge),
      Buffer.from(challenge)
    );
  } catch {
    return expectedChallenge === challenge;
  }
}
