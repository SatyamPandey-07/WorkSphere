# Enterprise WebAuthn Passkey Security & Subdomain Delegation

## Overview

This specification details the WebAuthn (FIDO2) integration for WorkSphere. It covers the cryptographic challenge lifecycle, user verification enforcement, and the Relying Party (RP) origin delegation strategy required to support passkeys seamlessly across our enterprise subdomains.

---

## 1. FIDO2 Sequence Flows

### Registration Flow (Credential Creation)

1. **Initiation:** The client requests passkey registration.
2. **Challenge Generation:** The server generates a cryptographic challenge and user identity payload, returning `PublicKeyCredentialCreationOptions`.
3. **Authenticator Interaction:** The browser prompts the user for user verification (e.g., FaceID, TouchID, or device PIN). The authenticator generates a new keypair.
4. **Attestation:** The client returns the `attestationObject` and `clientDataJSON` to the server.
5. **Storage:** The server validates the `clientDataJSON` and `authenticatorData`, verifies the attestation, and securely stores the `credentialID` and `publicKey` mapped to the user.

### Authentication Flow (Login)

1. **Initiation:** The client inputs their identifier (or uses discoverable credentials) to log in.
2. **Challenge Generation:** The server generates a new challenge, returning `PublicKeyCredentialRequestOptions`.
3. **Assertion:** The user authenticates via device user verification. The authenticator signs the payload, where the signed data is `authenticatorData || SHA-256(clientDataJSON)`.
4. **Verification:** The client sends the assertion to the server. The server validates the `clientDataJSON` and `authenticatorData`, verifies the signature against the stored `publicKey`, and grants a session token.

## 2. Challenge Creation Rules

To prevent replay attacks and ensure cryptographic integrity, all WebAuthn challenges must adhere to the following strict rules:

- **Entropy:** Challenges must contain a minimum of 32 bytes of cryptographically secure random data generated via `crypto.randomBytes(32)` (Node.js) or `crypto.getRandomValues()` (Web Crypto API).
- **Encoding:** Challenges must be converted to `base64url` format without padding before being sent to the client.
- **Lifecycle (TTL):** A challenge is valid for a maximum of 5 minutes (`300000 ms`).
- **Single-Use:** Once a challenge is validated during registration or authentication, it must be immediately invalidated/deleted from the Redis cache.

## 3. RP ID & Subdomain Delegation

To allow users to register a passkey on `app.worksphere.com` and use it to log in on `admin.worksphere.com`, we utilize a top-level Relying Party ID (RP ID).

- **Configured RP ID:** `worksphere.com`
- **Rule:** The WebAuthn specification allows authenticators scoped to a root domain (`worksphere.com`) to be utilized across any valid subdomain.

### Origin & RP ID Policy Enforcement

The following helper strictly enforces the origin and RP ID policy as a preliminary step in the broader WebAuthn verification pipeline. Note: This implementation explicitly trusts the root domain and all HTTPS subdomains of `worksphere.com` to match the application's configuration.

```typescript
/**
 * Validates the origin and RP ID of a WebAuthn response.
 * Note: This handles origin/challenge policy enforcement, not the full cryptographic signature validation.
 * @param {string} clientOrigin - The origin returned from the authenticator's client data JSON.
 * @param {string} rpId - The Relying Party ID configured on the server.
 * @returns {boolean} - True if valid, throws Error if invalid.
 */
function validateWebAuthnOriginPolicy(
  clientOrigin: string,
  rpId: string,
): boolean {
  // 1. Validate Origin (Parse URL to enforce HTTPS and valid hostnames)
  try {
    const originUrl = new URL(clientOrigin);

    if (originUrl.protocol !== "https:") {
      throw new Error(
        `WebAuthn Error: Insecure protocol ${originUrl.protocol}`,
      );
    }

    const isAllowedHost =
      originUrl.hostname === "worksphere.com" ||
      originUrl.hostname.endsWith(".worksphere.com");

    if (!isAllowedHost) {
      throw new Error(
        `WebAuthn Error: Untrusted origin hostname ${originUrl.hostname}`,
      );
    }
  } catch (e) {
    throw new Error(`WebAuthn Error: Invalid origin format ${clientOrigin}`);
  }

  // 2. Validate RP ID (ensures the credential belongs to our top-level domain)
  const expectedRpId = "worksphere.com";
  if (rpId !== expectedRpId) {
    throw new Error(
      `WebAuthn Error: RP ID mismatch. Expected ${expectedRpId}, got ${rpId}`,
    );
  }

  return true;
}
```
