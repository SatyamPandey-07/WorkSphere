# WebAuthn Passkey FIDO2 Protocol & Cross-Platform Sync

This document describes how WorkSphere uses **WebAuthn / FIDO2 passkeys**, including registration, challenge generation, multi-device synchronization, assertion verification, troubleshooting procedures, and fallback mechanisms when a WebAuthn ceremony cannot be completed.

## Related Code

- `src/lib/webauthn.ts` — RP ID normalization, origin checks, challenge comparison, and `clientDataJSON` parsing.
- `src/app/api/auth/webauthn/verify/route.ts` — Handles `POST /api/auth/webauthn/verify`.
- `src/lib/webauthn-frame.ts` and `src/components/PasskeyFrameNotice.tsx` — Handle iframe and Permissions-Policy fallback behavior.
- Sign-in and sign-up pages embed Clerk's passkey UI along with the frame notice.

> **Note:** For RP subdomain delegation details, see `docs/WEBAUTHN_PASSKEY_SECURITY_SPECIFICATION.md`.

---

# 1. Roles

| Role | Responsibility |
|------|----------------|
| **Relying Party (RP)** | WorkSphere (via Clerk and verification helpers). Identified by an RP ID such as `worksphere.com` or `localhost`. |
| **Authenticator** | Platform authenticator (Touch ID, Face ID, Windows Hello) or a roaming security key. Stores the private key and never sends it to the server. |
| **Client (Browser)** | Executes `navigator.credentials.create()` and `navigator.credentials.get()`, then returns attestation or assertion to the relying party. |
| **Credential Store** | Cloud-synced passkey vault (iCloud Keychain, Google Password Manager, etc.) or a device-bound key. Synchronization occurs between authenticators, not through WorkSphere's database. |

---

# 2. Registration Sequence (Credential Creation)

```text
User (Sign-up / Settings)
        │
        ▼
Clerk / RP issues PublicKeyCredentialCreationOptions
(challenge, user ID, rp.id, pubKeyCredParams, ...)
        │
        ▼
Browser → Authenticator (User Verification)
        │
        ▼
Authenticator creates key pair and returns:
• credentialId
• publicKey (COSE)
• attestationObject
• clientDataJSON (type: webauthn.create)
        │
        ▼
RP verifies challenge and origin, then stores
credentialId and publicKey
(private key never leaves the authenticator or sync vault)
```

## Challenge Generation (Registration)

During registration, the relying party generates a secure challenge before credential creation.

### Steps

1. Generate at least **32 bytes** of cryptographically secure random data using:
   - `crypto.getRandomValues()`, or
   - `crypto.randomBytes()`
2. Encode the challenge as **Base64URL** (without padding).
3. Bind the challenge to the pending registration using a **short expiration time** and allow **single use only**.
4. Include the same value in `PublicKeyCredentialCreationOptions.challenge`.
5. The authenticator hashes `clientDataJSON` and includes the hash inside the signed attestation.
6. After successful verification, invalidate the challenge to prevent replay attacks.
---

# 3. Authentication Sequence (Assertion)

```text
User (Sign-in)
        │
        ▼
RP issues PublicKeyCredentialRequestOptions
(challenge, allowCredentials?, rpId)
        │
        ▼
Browser → Authenticator (User Verification)
        │
        ▼
Authenticator signs:
authenticatorData || SHA-256(clientDataJSON)
        │
        ▼
Client posts assertion (including clientDataJSON) to RP
        │
        ▼
POST /api/auth/webauthn/verify (WorkSphere)
  • Parse clientDataJSON
  • Verify type is webauthn.get
  • Compare challenge with expectedChallenge
  • Validate origin against normalized RP ID
        │
        ▼
Full signature verification using stored publicKey
(handled by Clerk / Credential Store)
        │
        ▼
Session Created
```

WorkSphere's verification route validates the **challenge**, **origin**, and **RP ID policy** before trusting a session. Full COSE signature verification against the stored public key is performed by **Clerk**, which owns the credential record.

## Challenge Generation (Authentication)

Authentication follows the same secure challenge generation rules as registration.

### Steps

1. Generate a new cryptographically secure random challenge.
2. Encode it using **Base64URL**.
3. Create a **new challenge for every login attempt**.
4. Store it temporarily as `expectedChallenge`.
5. During `POST /api/auth/webauthn/verify`, compare the decoded `clientDataJSON.challenge` with `expectedChallenge`.
6. Reject authentication if the values do not match.

---

# 4. Public Key Cryptographic Formats

## Algorithms Offered to the Authenticator

| COSE Algorithm | Name | Notes |
|---------------|------|------|
| **-7** | ES256 (ECDSA P-256 + SHA-256) | Preferred for most platform authenticators. |
| **-257** | RS256 (RSASSA-PKCS1-v1_5 + SHA-256) | Provides wider hardware compatibility. |
| **-8** | EdDSA (Ed25519) | Optional where supported. |

> **Recommendation:** WorkSphere should prefer **ES256** whenever the authenticator supports it.

## Public Key Storage

The authenticator returns the public key inside the CBOR `attestationObject`.

The server stores:

- `credentialId` (bytes or Base64URL)
- COSE or SPKI public key material
- Signature counter (used for anti-cloning protection)

> **Important:** The private key is **never uploaded** to WorkSphere.

## clientDataJSON

The verification helper expects the following structure:

```json
{
  "type": "webauthn.get",
  "challenge": "<base64url challenge>",
  "origin": "https://app.example.com"
}
```

### Verification Process

`parseClientDataJSON()` in `src/lib/webauthn.ts` performs the following steps:

1. Base64URL-decodes the payload.
2. Parses the decoded JSON.
3. Verifies that:
   - `challenge` exists.
   - `origin` exists.
   - `type` equals `webauthn.get`.
4. Rejects assertions with missing fields or an unexpected `type`.
---

# 5. Multi-Device Credential Sync

Passkeys are often **discoverable credentials** that can be synchronized through the user's platform account.

```text
Phone creates passkey
        │
        ▼
Vendor Sync (iCloud / Google / etc.)
        │
        ▼
Laptop authenticator receives the same
credentialId + key
        │
        ▼
Same RP ID + User Account
        │
        ▼
Login succeeds on either device
```

## WorkSphere Implications

- RP ID must remain stable across all hosts the user may access.
- `normalizeRpId()` (or `WEBAUTHN_RP_ID`) normalizes to the parent domain so subdomains such as `app.` and `staging.` can share credentials.
- Origin validation is performed using `isOriginAllowedForRpId()`.
- A valid origin must either:
  - Exactly match the RP ID, or
  - Be a subdomain of the RP ID.
- WorkSphere does **not** synchronize private keys between devices.
- Any authenticator holding a registered credential for the RP ID can authenticate successfully.
- Device-bound (non-synced) passkeys continue to work, but users must register separately on each device when synchronization is disabled.

## Cross-Subdomain Example

```text
Register on:
https://app.worksphere.com
(rpId → worksphere.com)

        │
        ▼

Authenticate on:
https://admin.worksphere.com

Origin allowed under the same RP ID
```

---

# 6. Fallback Verification

When WebAuthn cannot be completed, users should still be able to sign in using alternative authentication methods.

| Situation | Behavior |
|-----------|----------|
| Cross-origin iframe embed | `getFrameWebAuthnStatus().shouldBlockPasskeys` displays `PasskeyFrameNotice` and blocks `credentials.create()` / `credentials.get()` with a controlled `SecurityError`. |
| Missing Permissions-Policy delegation | Same behavior as above (`publickey-credentials-get` is not permitted). |
| Authenticator canceled or timed out | Fall back to Clerk Email, Password, or OTP authentication. |
| Challenge or origin mismatch | `POST /api/auth/webauthn/verify` returns **401** with **"Invalid WebAuthn challenge signature"** and no session is created. |
| Localhost / Preview environments | RP ID may be `localhost`, but challenge and origin validation are still required. |

## Expected Fallback Order

1. Passkey authentication (platform or synchronized passkey).
2. Clerk authentication methods:
   - Email Magic Link
   - Password
   - One-Time Password (OTP)
3. Display a message instructing users to open the application in a full browser tab when embedded.

---

# 7. Security Guidelines

- Never log or store:
  - Private keys
  - Authenticator PINs
  - Biometric information
- Generate high-entropy challenges.
- Use short challenge expiration times.
- Allow each challenge to be used only once.
- Perform constant-time challenge comparison whenever practical.
- Bind verification to both:
  - Origin
  - RP ID
- Reject requests originating from unauthorized hosts, even if the challenge matches.
- Prefer `userVerification: "required"` during both registration and authentication.
- Prefer the **ES256** algorithm whenever supported.
- Reject unexpected `clientDataJSON.type` values.
- Treat iframe embeds as untrusted unless explicitly allowed through `Permissions-Policy`.
- When WebAuthn is unavailable, gracefully fall back to passwordless email authentication.
- Keep `WEBAUTHN_RP_ID` aligned with the production registrable domain, since changing it invalidates previously registered passkeys.
- Rate-limit assertion verification endpoints in the same manner as other authentication routes.
- After successful assertion verification:
  - Invalidate the challenge.
  - Rotate session cookies using the normal Clerk session flow.
  ---

# 8. API Surface (WorkSphere)

## Endpoint

### `POST /api/auth/webauthn/verify`

### Request Body

```json
{
  "clientDataJSON": "<base64url>",
  "expectedChallenge": "<base64url>",
  "rpId": "<optional override>"
}
```

### Success Response (200)

```json
{
  "verified": true,
  "rpId": "worksphere.com"
}
```

### Failure Response (400 / 401)

Returns validation errors or:

```text
Invalid WebAuthn challenge signature
```

> **Note:** This endpoint does **not** replace Clerk session creation. It validates the WebAuthn client data policy used alongside the broader authentication stack.

---

# 9. Summary

- Registration and authentication follow the standard **FIDO2/WebAuthn** create and get ceremonies using server-issued challenges.
- Public keys are stored in **COSE** format (typically ES256), while private keys remain on the authenticator or synchronized credential vault.
- Multi-device authentication is enabled through platform passkey synchronization combined with a shared parent RP ID.
- WorkSphere never transfers private keys between devices.
- Fallback authentication methods are available for iframe restrictions and other scenarios where WebAuthn cannot be completed.

---

# 10. Troubleshooting & Common Error Codes

This section describes common `DOMException` errors that may occur during WebAuthn registration or authentication, along with their causes and recommended resolutions.

| DOMException | Common Root Cause | Resolution Steps |
|--------------|------------------|------------------|
| **NotAllowedError** | User canceled the biometric prompt, request timed out, or origin is insecure (HTTP instead of HTTPS). | 1. Use HTTPS or `http://localhost`.<br>2. Ensure `rp.id` matches the current hostname.<br>3. Retry without canceling the authentication prompt. |
| **InvalidStateError** | Credential already exists or an excluded credential matches during registration. | 1. Verify the user is not re-registering an existing passkey.<br>2. Remove existing test passkeys from the browser or operating system before testing again. |
| **SecurityError** | Domain mismatch between the current origin and `rp.id`, or WebAuthn is blocked by Feature Policy / Permissions Policy inside an iframe. | 1. Confirm `rp.id` matches the current domain.<br>2. Execute WebAuthn only from an allowed top-level browsing context. |

---

# 11. Contributor Step-by-Step Resolution Guide

Follow these steps when debugging passkey issues during local development or pull request verification.

## 1. Verify Local Environment (HTTPS / Host Configuration)

WebAuthn requires a secure origin.

- Use:
  - `http://localhost:3000`, or
  - an HTTPS domain.
- Avoid custom IP addresses (such as `http://192.168.x.x`), as they result in a `SecurityError`.

## 2. Check Server-Side Relying Party Identification

Verify that `WEBAUTHN_RP_ID` in `.env.local` matches:

- `localhost` during local development.
- `worksphere.com` for staging and production environments.

## 3. Reset Testing Credentials

### Chrome / Edge

- Open **Developer Tools**.
- Navigate to the **WebAuthn** tab.
- Enable **Virtual Authenticator**.
- Clear existing virtual credentials before testing again.

### Safari (macOS)

- Open **System Settings**.
- Navigate to **Passwords**.
- Manage or remove existing passkeys before re-testing.

## 4. Inspect Server Assertion Verification Logs

Review server logs for:

- Challenge signature mismatches.
- Expired challenges.
- Authentication timeout errors.

> **Default challenge timeout:** **60 seconds**.