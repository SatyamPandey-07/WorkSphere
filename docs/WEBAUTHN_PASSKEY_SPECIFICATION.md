# WebAuthn Passkey FIDO2 Protocol & Cross-Platform Sync

This document describes how WorkSphere uses **WebAuthn / FIDO2 passkeys**, including registration, challenge generation, multi-device synchronization, assertion verification, troubleshooting procedures, and fallback mechanisms when a WebAuthn ceremony cannot be completed.

## Related Code

- `src/lib/webauthn.ts` — RP ID normalization, origin checks, challenge comparison, and `clientDataJSON` parsing.
- `src/lib/passkey/rotation.ts` — Passkey rotation status, expiry prompts, and expired-credential cleanup.
- `src/lib/passkey/attestation.ts` — Key expiry helpers (`shouldPromptRotation`, `getKeyExpiryDate`).
- `src/app/api/auth/passkey/rotation/route.ts` — `GET`/`POST` rotation status, rotate, and cleanup actions.
- `src/app/api/auth/passkey/credentials/[id]/route.ts` — Credential rename and revocation (`DELETE`).
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

# 8. Passkey Rotation Security Protocol

This section documents the **security lifecycle** for WorkSphere-managed passkeys stored in Prisma (`PasskeyCredential`): when to rotate, how credentials are revoked, how the server replaces public keys, and how to manage keys across multiple devices.

## 8.1 Rotation Interval and Triggers

| Constant / helper | Location | Value / behavior |
| ----------------- | -------- | ---------------- |
| `KEY_ROTATION_INTERVAL_DAYS` | `src/lib/passkey/rotation.ts` | **90 days** from credential `createdAt` |
| `needsRotation` / `shouldPromptRotation` | `rotation.ts` / `attestation.ts` | Prompt when **≤ 14 days** remain until expiry |
| `expiresAt` on create | `register/verify` | Set to `now + 90 days` when the credential is first stored |
| `cleanupExpiredPasskeys` | `rotation.ts` | Deletes credentials whose `createdAt` is older than 90 days |

**Triggers that start a rotation ceremony:**

1. **Scheduled expiry** — Credential age reaches or exceeds the 90-day rotation interval.
2. **Pre-expiry prompt** — `daysUntilExpiry ≤ 14` (`needsRotation: true` from `GET /api/auth/passkey/rotation`).
3. **User-initiated** — Settings UI calls `POST /api/auth/passkey/rotation` with `{ "action": "rotate", "credentialId": "<cuid>" }` after (or while) registering a replacement authenticator.
4. **Compromise / lost device** — Immediate **revocation** (see §8.2), then register a fresh passkey; do not wait for the 90-day window.
5. **Authenticator firmware / OS vault reset** — Old `credentialId` will fail assertions; revoke the server row and enroll again.

```text
Registration (create)
        │  expiresAt = now + 90d
        ▼
Active use (counter / lastUsedAt updates)
        │
        ├─ daysUntilExpiry ≤ 14  →  prompt rotation (UI)
        ├─ expired / cleanup     →  revoke row (deleteMany)
        └─ lost/stolen device    →  immediate DELETE by id
                │
                ▼
New WebAuthn create ceremony → new publicKey in Prisma
                │
                ▼
Revoke previous PasskeyCredential (if still present)
```

## 8.2 Credential Revocation Flow

Revocation removes the **server-side trust** for a credential. The authenticator may still hold a private key locally, but WorkSphere will no longer accept assertions for that `credentialId`.

| Path | API | Effect |
| ---- | --- | ------ |
| Explicit revoke | `DELETE /api/auth/passkey/credentials/[id]` | Deletes one `PasskeyCredential` owned by the authenticated user |
| Bulk expiry cleanup | `POST /api/auth/passkey/rotation` `{ "action": "cleanup" }` | `deleteMany` where `createdAt < now - 90 days` for that user |
| Account deletion | Prisma `onDelete: Cascade` on `User` | All passkeys for the user are removed |

**Revocation steps (security order):**

1. Authenticate the session (`auth()` / Clerk `userId`).
2. Load the credential with `{ id, userId }` ownership check — never delete by `credentialId` alone without `userId`.
3. `prisma.passkeyCredential.delete({ where: { id } })` (or `deleteMany` for cleanup).
4. Confirm the client no longer lists the credential (`GET` credentials).
5. If this was the user’s only passkey, require an alternate factor (email / passwordless) before completing logout of other sessions.

Spent `PasskeyChallenge` rows are deleted after successful register/authenticate verify and are unrelated to long-lived credential revocation.

## 8.3 Server-Side Public Key Replacement (Prisma)

WebAuthn **cannot rotate a private key in place**. Cryptographic rotation means: enroll a **new** credential (new key pair) and stop trusting the old one. On the server, that is a **public key replacement** in the `PasskeyCredential` model.

### Schema (`prisma/schema.prisma`)

```prisma
model PasskeyCredential {
  id                String   @id @default(cuid())
  userId            String
  user              User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  credentialId      String   @unique   // WebAuthn credential ID (Base64URL)
  publicKey         Bytes              // COSE public key bytes (RP verification material)
  counter           BigInt   @default(0)
  transports        String[] @default([])
  deviceType        String   @default("singleDevice")  // singleDevice | multiDevice
  backedUp          Boolean  @default(false)
  name              String
  aaguid            String?
  attestationFormat String?
  createdAt         DateTime @default(now())
  lastUsedAt        DateTime @default(now())
  expiresAt         DateTime           // lifecycle / rotation deadline

  @@index([userId])
}
```

### Replacement procedure

1. Run a new **registration** ceremony (`register/options` → `navigator.credentials.create` → `register/verify`).
2. On verify success, persist the new material:

```ts
await prisma.passkeyCredential.create({
  data: {
    userId,
    credentialId: credential.id,                    // new unique ID
    publicKey: Buffer.from(credential.publicKey), // replaces trust root
    counter: BigInt(credential.counter),
    transports: credential.transports || [],
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    name: name?.trim() || "Passkey Credential",
    aaguid: aaguid || null,
    expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
  },
});
```

3. **Revoke** the previous row (`DELETE .../credentials/[id]` or cleanup). Do **not** overwrite `publicKey` on the old `credentialId` — the authenticator’s private key is bound to that ID; a mismatched public key would break verification and invite confusion.
4. Registration options should `excludeCredentials` existing passkeys so the authenticator does not silently re-emit an already-stored credential.

`POST .../rotation` with `action: "rotate"` refreshes operational metadata (`lastUsedAt` / reported `newExpiresAt`) for lifecycle UX; **cryptographic** replacement always goes through create + revoke as above so `publicKey` and `credentialId` stay consistent.

## 8.4 Multi-Device Key Management Guidelines

| Guideline | Rationale |
| --------- | --------- |
| Prefer **at least two** registered passkeys per account (e.g. laptop + phone, or platform + security key) | Survives loss of one authenticator without account lockout |
| Treat `deviceType: "multiDevice"` + `backedUp: true` as cloud-synced vault keys | Same synced secret may appear on several devices; revoking the server row revokes all synced copies for this RP |
| Treat `singleDevice` / `backedUp: false` as device-bound | Losing that hardware requires a different enrolled factor |
| Use `excludeCredentials` on registration | Prevents duplicate enrollments of the same authenticator credential |
| Name credentials clearly (`PATCH .../credentials/[id]` `{ "name": "..." }`) | Users can revoke the correct device after theft |
| After revoking a lost device, **rotate remaining** keys if compromise is suspected | Limits replay of cloned or backup vault material |
| Never export or log `publicKey` Bytes in plaintext logs | Reduces credential stuffing / targeted forgery risk |
| Keep RP ID stable across subdomains | Changing `WEBAUTHN_RP_ID` invalidates all stored passkeys (see §7) |
| Run periodic `cleanup` for expired rows | Shrinks the attack surface of stale `credentialId`s |
| Do not share one hardware key across unrelated user accounts without separate credentials | Preserves per-user counter and revocation boundaries |

**Sync vs server:** Platform sync (iCloud Keychain, Google Password Manager) moves **private** keys between the user’s devices. WorkSphere only stores **public** keys in Prisma and never participates in private-key sync.

---

# 9. API Surface (WorkSphere)

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

# 10. Summary

- Registration and authentication follow the standard **FIDO2/WebAuthn** create and get ceremonies using server-issued challenges.
- Public keys are stored in **COSE** format (typically ES256), while private keys remain on the authenticator or synchronized credential vault.
- Passkeys follow a **90-day rotation lifecycle** with 14-day prompts, Prisma `publicKey` replacement via new registration, and explicit revocation (`DELETE` / cleanup).
- Multi-device authentication is enabled through platform passkey synchronization combined with a shared parent RP ID.
- WorkSphere never transfers private keys between devices.
- Fallback authentication methods are available for iframe restrictions and other scenarios where WebAuthn cannot be completed.

---

# 11. Troubleshooting & Common Error Codes

This section describes common `DOMException` errors that may occur during WebAuthn registration or authentication, along with their causes and recommended resolutions.

| DOMException | Common Root Cause | Resolution Steps |
|--------------|------------------|------------------|
| **NotAllowedError** | User canceled the biometric prompt, request timed out, or origin is insecure (HTTP instead of HTTPS). | 1. Use HTTPS or `http://localhost`.<br>2. Ensure `rp.id` matches the current hostname.<br>3. Retry without canceling the authentication prompt. |
| **InvalidStateError** | Credential already exists or an excluded credential matches during registration. | 1. Verify the user is not re-registering an existing passkey.<br>2. Remove existing test passkeys from the browser or operating system before testing again. |
| **SecurityError** | Domain mismatch between the current origin and `rp.id`, or WebAuthn is blocked by Feature Policy / Permissions Policy inside an iframe. | 1. Confirm `rp.id` matches the current domain.<br>2. Execute WebAuthn only from an allowed top-level browsing context. |

---

# 12. Contributor Step-by-Step Resolution Guide

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