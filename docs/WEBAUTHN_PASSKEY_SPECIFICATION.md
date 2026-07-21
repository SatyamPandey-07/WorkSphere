# WebAuthn Passkey FIDO2 Protocol & Cross-Platform Sync

This document describes how WorkSphere uses WebAuthn / FIDO2 passkeys: registration, challenge generation, multi-device sync, assertion verification, and the fallbacks we rely on when a ceremony cannot complete.

Related code:

- `src/lib/webauthn.ts` — RP ID normalization, origin checks, challenge compare, `clientDataJSON` parse
- `src/app/api/auth/webauthn/verify/route.ts` — `POST /api/auth/webauthn/verify`
- `src/lib/webauthn-frame.ts` + `src/components/PasskeyFrameNotice.tsx` — iframe / Permissions-Policy fallback
- Sign-in / sign-up pages embed Clerk’s passkey UI and the frame notice

For RP subdomain delegation detail, see also `docs/WEBAUTHN_PASSKEY_SECURITY_SPECIFICATION.md`.

---

## 1. Roles

| Role | Responsibility |
|------|----------------|
| **Relying Party (RP)** | WorkSphere (via Clerk + our verify helpers). Identified by an RP ID such as `worksphere.com` or `localhost`. |
| **Authenticator** | Platform (Touch ID / Face ID / Windows Hello) or a roaming key. Holds the private key; never sends it to the server. |
| **Client (browser)** | Runs `navigator.credentials.create` / `.get`, returns attestation or assertion to the RP. |
| **Credential store** | Cloud-synced passkey vault (iCloud Keychain, Google Password Manager, etc.) or a device-bound key. Sync is between the user’s authenticators, not through WorkSphere’s database. |

---

## 2. Registration sequence (credential create)

```text
User (sign-up / settings)
        │
        ▼
Clerk / RP issues PublicKeyCredentialCreationOptions
  (challenge, user id, rp.id, pubKeyCredParams, …)
        │
        ▼
Browser → authenticator (user verification)
        │
        ▼
Authenticator creates keypair, returns:
  • credentialId
  • publicKey (COSE)
  • attestationObject
  • clientDataJSON  (type: webauthn.create)
        │
        ▼
RP verifies challenge + origin, stores credentialId + publicKey
  (private key never leaves the authenticator / sync vault)
```

### Challenge generation (registration)

1. Generate **≥ 32 bytes** of CSPRNG entropy (`crypto.getRandomValues` / `crypto.randomBytes`).
2. Encode as **base64url** (no padding) for the client.
3. Bind the challenge to the pending registration (short TTL, single use).
4. Put the same value in `PublicKeyCredentialCreationOptions.challenge`.

The authenticator hashes `clientDataJSON` and includes that hash in the signed attestation. Replays fail because a used challenge must be invalidated server-side.

---

## 3. Authentication sequence (assertion)

```text
User (sign-in)
        │
        ▼
RP issues PublicKeyCredentialRequestOptions
  (challenge, allowCredentials?, rpId)
        │
        ▼
Browser → authenticator (user verification)
        │
        ▼
Authenticator signs:
  authenticatorData || SHA-256(clientDataJSON)
        │
        ▼
Client posts assertion (incl. clientDataJSON) to RP
        │
        ▼
POST /api/auth/webauthn/verify   (WorkSphere)
  parse clientDataJSON
  type must be webauthn.get
  challenge === expectedChallenge
  origin allowed for normalized RP ID
        │
        ▼
Full signature check against stored publicKey
  (Clerk / credential store) → session
```

WorkSphere’s verify route focuses on **challenge + origin / RP ID policy** before a session is trusted. Full COSE signature verification against the stored public key is performed by the identity provider (Clerk) that owns the credential record.

### Challenge generation (authentication)

Same entropy and encoding rules as registration. A new challenge is minted per login attempt. `expectedChallenge` on `POST /api/auth/webauthn/verify` must match the `challenge` field inside decoded `clientDataJSON`.

---

## 4. Public key cryptographic formats

### Algorithms offered to the authenticator

Typical `pubKeyCredParams` (COSE algorithm identifiers):

| alg (COSE) | Name | Notes |
|------------|------|--------|
| `-7` | ES256 (ECDSA P-256 + SHA-256) | Preferred on most platform authenticators |
| `-257` | RS256 (RSASSA-PKCS1-v1_5 + SHA-256) | Wider hardware support |
| `-8` | EdDSA (Ed25519) | Optional where supported |

WorkSphere should prefer ES256 when the authenticator supports it.

### How the public key is stored

- Transported inside the CBOR `attestationObject` → `authData` → credential public key (COSE Key map).
- Server persists:
  - `credentialId` (bytes / base64url)
  - COSE or SPKI public key material
  - sign counter (anti-clone)
- Private key material is **never** uploaded to WorkSphere.

### `clientDataJSON` (JSON, then base64url on the wire)

Relevant fields for our verify helper:

```json
{
  "type": "webauthn.get",
  "challenge": "<base64url challenge>",
  "origin": "https://app.example.com"
}
```

`parseClientDataJSON` in `src/lib/webauthn.ts` base64url-decodes the payload and JSON-parses it. Verification rejects missing `challenge` / `origin`, or `type` other than `webauthn.get` on the assertion path.

---

## 5. Multi-device credential sync

Passkeys are often **discoverable** and synced by the platform account:

```text
Phone creates passkey
        │
        ▼
Vendor sync (iCloud / Google / etc.)
        │
        ▼
Laptop authenticator receives same credentialId + key
        │
        ▼
Same RP ID + user account → login works on either device
```

WorkSphere implications:

1. **RP ID must be stable across hosts** the user will open. We normalize to a parent domain via `normalizeRpId` (or `WEBAUTHN_RP_ID`) so `app.` and `staging.` share credentials.
2. **Origin check** uses `isOriginAllowedForRpId`: host equals RP ID or is a subdomain of it.
3. Sync is **not** implemented as a WorkSphere API. We do not copy private keys between devices; we accept assertions from any authenticator that holds a registered credential for that RP ID.
4. Device-bound (non-synced) keys still work; the user must register again on each device if sync is disabled.

Cross-subdomain example:

```text
Register on https://app.worksphere.com   (rpId → worksphere.com)
Assert  on https://admin.worksphere.com  (origin allowed under same rpId)
```

---

## 6. Fallback verification

When WebAuthn cannot run, users must still sign in.

| Situation | Behavior |
|-----------|----------|
| Cross-origin iframe embed | `getFrameWebAuthnStatus().shouldBlockPasskeys` → show `PasskeyFrameNotice`; guard blocks `credentials.get/create` with a controlled `SecurityError`. |
| Missing Permissions-Policy delegation | Same as above (`publickey-credentials-get` not allowed). |
| Authenticator cancel / timeout | Fall back to Clerk email / password / OTP flows on the sign-in page. |
| Challenge or origin mismatch | `POST /api/auth/webauthn/verify` returns `401` with `Invalid WebAuthn challenge signature` — do not create a session. |
| Localhost / preview | RP ID may be `localhost`; still require challenge match + origin rules. |

Fallback order we expect in product UX:

1. Passkey (platform or synced) when the top-level browsing context allows it
2. Other Clerk factors (email magic link, password, OTP)
3. Clear messaging when embedded (open in a full tab)

---

## 7. Security guidelines

1. **Never** log or store private keys, or raw authenticator PINs / biometrics.
2. Challenges: high entropy, short TTL, **single use**, constant-time compare where practical.
3. Bind verification to **origin + RP ID**; reject foreign hosts even if the challenge string matches.
4. Prefer **user verification required** (`userVerification: "required"`) for registration and login.
5. Prefer **ES256**; reject unexpected `type` values in `clientDataJSON`.
6. Treat iframe embeds as hostile to WebAuthn unless the embedder opts in via Permissions-Policy; degrade to passwordless email instead of failing loudly.
7. Keep `WEBAUTHN_RP_ID` aligned with production’s registrable domain; changing RP ID orphans existing passkeys.
8. Rate-limit assertion verification endpoints like other auth routes.
9. After a successful assertion, invalidate the challenge and rotate session cookies through the normal Clerk session path.

---

## 8. API surface (WorkSphere)

### `POST /api/auth/webauthn/verify`

Body:

```json
{
  "clientDataJSON": "<base64url>",
  "expectedChallenge": "<base64url>",
  "rpId": "<optional override>"
}
```

Success (`200`):

```json
{ "verified": true, "rpId": "worksphere.com" }
```

Failure (`400` / `401`): validation errors or `Invalid WebAuthn challenge signature`.

This route does **not** replace Clerk session creation; it validates the WebAuthn client data policy used alongside the broader auth stack.

---

## 9. Summary

- Registration and login follow standard FIDO2 create / get ceremonies with server-issued challenges.
- Public keys use COSE (typically ES256); private keys stay on the authenticator or vendor sync vault.
- Multi-device access comes from platform passkey sync plus a shared parent **RP ID**, not from shipping secrets through WorkSphere.
- Fallback paths cover iframe embeds and non-passkey Clerk factors when WebAuthn is unavailable.
