# Offline QR Passcards: Signing Scheme, Payload and Key Rotation Specification

This is the normative reference for the cryptographic scheme behind offline QR passcards: the primitives and their assumptions, the exact token layout, how public keys reach scanners, how a token is verified, what the design does and does not defend against, and the operator runbook for rotating signing keys.

It was verified against the implementation on `main` (commit `ffe42f6`). Where this document and the code disagree, the code is the source of truth and this document has a bug.

Related documents:

- [offline-qr-passcards.md](./offline-qr-passcards.md): implementation guide (storage, display, environment variables).
- [OFFLINE_QR_PASSCARD_SPEC.md](./OFFLINE_QR_PASSCARD_SPEC.md): booking request and response schemas and a scanner workflow summary.

Source files covered:

| File                                                   | Role                                                    |
| :----------------------------------------------------- | :------------------------------------------------------ |
| `src/lib/security/offlineQrSigner.ts`                  | Payload rules, signing, verification, key import/export |
| `src/lib/security/serverOfflinePasscardIssuer.ts`      | Server only: loads the private key, builds the payload  |
| `src/lib/security/keyRotation.ts`                      | Validates and sanitizes the published public key set    |
| `src/lib/security/offlinePasscardStore.ts`             | Client IndexedDB storage of issued tokens               |
| `src/app/api/bookings/confirm/route.ts`                | Issues a passcard when a booking is confirmed           |
| `src/app/api/security/qr-passcard/issue/route.ts`      | Re-issues (renews) a passcard for an active booking     |
| `src/app/api/security/offline-passcards/keys/route.ts` | Publishes the public verification keys                  |

## 1. Scope and how this differs from the original request

The request that led to this document (issue #7729) described an Ed25519 scheme with an authorization tier. The implementation differs in several places. The differences are listed first so nobody builds a scanner against the wrong assumptions.

| Topic                | Issue wording                | Implemented                                                                                                                      |
| :------------------- | :--------------------------- | :------------------------------------------------------------------------------------------------------------------------------- |
| Signature algorithm  | Ed25519                      | ECDSA on curve P-256 with SHA-256, through the Web Crypto API. Ed25519 is not used anywhere.                                     |
| Payload shape        | "binary/JSON"                | A fixed order JSON array of 7 items, encoded as UTF-8, then Base64URL. Not binary.                                               |
| Authorization tier   | Field in the payload         | There is no tier field. The payload carries `userId` and `seatNumber` instead.                                                   |
| Public key caching   | Cached in IndexedDB          | The app's IndexedDB holds issued tokens only. No public key cache exists in the repository, and there is no scanner application. |
| Anti replay          | Defenses documented          | None. A token is a bearer credential. Section 7 states what limits the damage and what a scanner can add.                        |
| Clock skew tolerance | Maximum tolerance documented | Default 0 seconds, hard cap 300 seconds, set per verification call.                                                              |

Everything in sections 2 to 9 describes the implemented behavior. Text marked **Recommendation** is guidance for scanner and operator authors and is not implemented in the repository.

## 2. Cryptographic primitives and security assumptions

### 2.1 Primitives

| Item               | Value                                                                                                          |
| :----------------- | :------------------------------------------------------------------------------------------------------------- |
| Signature scheme   | ECDSA, curve P-256, hash SHA-256 (the JOSE name is `ES256`)                                                    |
| Implementation     | Web Crypto API (`crypto.subtle`), in the browser, in Node and on the server                                    |
| Signature encoding | Raw IEEE P1363: 32 byte `r` followed by 32 byte `s`, 64 bytes total. Not DER.                                  |
| Signed bytes       | The exact payload bytes carried in the token. Nothing is re-serialized or canonicalized on the verifying side. |
| Text encoding      | UTF-8                                                                                                          |
| Transport encoding | Base64URL without padding, using the characters `A-Z a-z 0-9 - _`                                              |
| Key format         | JWK (`kty: "EC"`, `crv: "P-256"`)                                                                              |
| Format version     | `1`, the first item of the payload array                                                                       |

ECDSA signatures are randomized. Signing the same payload twice gives two different, equally valid tokens. Never compare or deduplicate tokens as strings; use `bookingId` (section 7).

A symmetric scheme such as HMAC would put the signing secret on every scanner, so one stolen scanner could mint passcards. With an asymmetric scheme a scanner holds public keys only.

### 2.2 Security assumptions

The scheme is only as strong as these assumptions. If one fails, the guarantee next to it fails with it.

| #   | Assumption                                                                                                                                                                                                       | If it fails                                                                                  |
| :-- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------- |
| A1  | The private signing key stays on the server. It lives in `OFFLINE_PASSCARD_PRIVATE_KEY_JWK`, is read only by a module that imports `server-only`, and is imported as non extractable with the `sign` usage only. | Anyone with the key can mint valid passcards. Follow the emergency procedure in section 9.4. |
| A2  | A scanner holds authentic public keys. The only distribution channel is HTTPS to the keys endpoint. No key pinning is implemented for these keys, and the token carries no key identifier.                       | A scanner given an attacker's key accepts the attacker's passcards.                          |
| A3  | The scanner clock is close to real time.                                                                                                                                                                         | Genuine passcards are refused or expired ones accepted (section 8).                          |
| A4  | The scanner checks that `venueId` in the payload is its own venue. The verification function has no idea which door it protects.                                                                                 | A passcard for one venue opens another.                                                      |
| A5  | Web Crypto is available. Every signing and verification call throws or fails closed without it.                                                                                                                  | Signing throws. Verification reports `bad-signature`.                                        |
| A6  | The QR code is treated as a bearer credential. Possession of the token is proof of entry within its window.                                                                                                      | Copies of a token work as well as the original (section 7).                                  |

### 2.3 What the token does not provide

- No confidentiality. The payload is encoded, not encrypted. Anyone who can see the QR can read the booking, user and venue identifiers, the times and the seat. It contains no name, email address or payment data.
- No revocation. A cancelled booking's token stays valid until `validUntil`, and an offline scanner cannot learn about the cancellation.
- No single use. There is no nonce and no counter.

## 3. Token format

### 3.1 Grammar

```
token   = base64url(payload_bytes) "." base64url(signature)
payload = JSON array, 7 items, serialized with JSON.stringify (no whitespace)
```

A token has exactly two segments separated by one dot. The token carries no JWS header and no `kid`. This keeps the QR small and means a verifier must try its keys one by one (section 6).

### 3.2 Payload items

```
[1, bookingId, userId, venueId, validFrom, validUntil, seatNumber]
```

| Index | Field        | Type    | Rule                                                                                                         |
| :---- | :----------- | :------ | :----------------------------------------------------------------------------------------------------------- |
| 0     | version      | number  | Must equal `1`. Any other value makes the token `malformed`.                                                 |
| 1     | `bookingId`  | string  | Nonempty, at most 128 characters.                                                                            |
| 2     | `userId`     | string  | Nonempty, at most 128 characters.                                                                            |
| 3     | `venueId`    | string  | Nonempty, at most 128 characters.                                                                            |
| 4     | `validFrom`  | integer | Unix seconds, a safe integer, 0 or more. The passcard is not valid before this moment.                       |
| 5     | `validUntil` | integer | Unix seconds, a safe integer, 0 or more, and strictly greater than `validFrom`. Not valid after this moment. |
| 6     | `seatNumber` | string  | Nonempty, at most 128 characters. The issuer writes `"UNASSIGNED"` when the booking has no seat.             |

Length is the JavaScript string length (UTF-16 code units). The array must have exactly 7 items. The same rules apply when signing (`assertValidPayload` throws) and when parsing a token (a violation gives `malformed`).

There is deliberately no authorization tier, name, email or payment field.

### 3.3 How the issuer fills the fields

`buildPasscardPayload` in `serverOfflinePasscardIssuer.ts` builds the payload from a confirmed booking:

| Field                            | Source                                                                                                                                         |
| :------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------- |
| `bookingId`, `userId`, `venueId` | The booking record. Each must be a nonempty string.                                                                                            |
| `validFrom`                      | `Math.floor(startsAt / 1000)`. `startsAt` is the booking start parsed in the booking's time zone, so it is one absolute instant.               |
| `validUntil`                     | `endsAt` when the booking has one. Otherwise `startsAt` plus the booking duration, or 60 minutes when the duration is missing or not positive. |
| `seatNumber`                     | The trimmed seat, or `"UNASSIGNED"`.                                                                                                           |

If `validUntil` is not strictly later than `validFrom`, issuance throws and no token is produced for that booking.

### 3.4 Signature

The signature covers the UTF-8 bytes of the serialized payload, which are the bytes that were Base64URL encoded into the first segment. A verifier decodes the first segment, verifies the signature over those decoded bytes, and only then parses them.

### 3.5 Structural checks before any cryptography

A token is `malformed` if any of these is true:

- It is not a string, or does not split into exactly two segments on `.`.
- A segment is empty or contains a character outside `A-Z a-z 0-9 - _`.
- The decoded signature is not exactly 64 bytes.
- (After the signature is checked) the payload is not a JSON array of 7 items, the version is not `1`, or a field breaks its rule.

### 3.6 Worked example

This vector was produced by the real `signOfflinePasscard` with a throwaway key pair. The private key was discarded. Do not use this key for anything.

Public key (JWK):

```json
{
  "kty": "EC",
  "crv": "P-256",
  "x": "BjVALa0YghTUQ9FErME3gUqJuKpd4GCFddA9oFHKHz4",
  "y": "SjqtxzwUzACTWwUVv63t1A3TL7XpYyfEMAgtMu6cwMQ"
}
```

Payload (90 bytes of UTF-8):

```json
[
  1,
  "bk_example_0001",
  "user_example_0001",
  "venue_example_0001",
  1800000000,
  1800003600,
  "A12"
]
```

Token (207 characters):

```
WzEsImJrX2V4YW1wbGVfMDAwMSIsInVzZXJfZXhhbXBsZV8wMDAxIiwidmVudWVfZXhhbXBsZV8wMDAxIiwxODAwMDAwMDAwLDE4MDAwMDM2MDAsIkExMiJd.cOwI7BGzXNV4T83vQIE9b4SVkrbgVCSxyV1eTFQeaOscnIjH10bKjDB8Kfm4yfjw0ZvEt11jVe3Yvag7xd998w
```

The validity window is 1800000000 to 1800003600 (one hour). Because the window is in the future, check it with an explicit `now`:

```ts
import {
  importVerificationKey,
  verifyOfflinePasscard,
} from "@/lib/security/offlineQrSigner";

const key = await importVerificationKey(publicJwk);
const result = await verifyOfflinePasscard(token, key, {
  now: 1_800_000_100_000, // milliseconds, inside the window
});
// result: { valid: true, payload: { bookingId: "bk_example_0001", ... } }
```

Token size follows from the payload. With ten digit timestamps the payload is about 37 bytes plus the total length of the four text fields, and the token is about 4/3 of that plus 87 characters (86 for the signature and one for the dot). The example above is 90 bytes and 207 characters. Real identifiers are usually longer, so real tokens are too.

## 4. Issuance

### 4.1 Server configuration

| Variable                           | Content                                                                                              | Read by                                            |
| :--------------------------------- | :--------------------------------------------------------------------------------------------------- | :------------------------------------------------- |
| `OFFLINE_PASSCARD_PRIVATE_KEY_JWK` | JSON of the active EC P-256 private JWK. Must contain `kty: "EC"`, `crv: "P-256"`, `d`, `x` and `y`. | `serverOfflinePasscardIssuer.ts`, `keyRotation.ts` |
| `OFFLINE_PASSCARD_PUBLIC_JWKS`     | JSON `{ "keys": [ ... ] }` of the public keys to publish, the active one plus retained older ones.   | `keyRotation.ts`                                   |

Neither variable is listed in `.env.example` at the time of writing. They are server secrets and configuration; never commit real values.

`getSigningKey` imports the private key as non extractable with usage `sign` and caches the imported key in memory, keyed by the raw environment string. If the variable changes, the next call imports the new value.

### 4.2 Where passcards are issued

| Endpoint                               | When                                                   | Auth           |
| :------------------------------------- | :----------------------------------------------------- | :------------- |
| `POST /api/bookings/confirm`           | A booking is confirmed. One token per created booking. | Signed in user |
| `POST /api/security/qr-passcard/issue` | The holder needs a fresh token for an active booking.  | Signed in user |

Confirm response fields (details in [OFFLINE_QR_PASSCARD_SPEC.md](./OFFLINE_QR_PASSCARD_SPEC.md)): `offlinePasscard` (first booking), `offlinePasscards` (array, only when more than one booking was created, `null` where signing failed), `offlinePasscardError` (always the string `"Signing unavailable"`). A signing failure never fails the booking.

Renewal endpoint, `POST /api/security/qr-passcard/issue`:

- Body: `{ "bookingId": "<id>" }`, 1 to 128 characters.
- Only the caller's own bookings with status `CONFIRMED` or `CHECKED_IN` qualify. A missing booking and somebody else's booking give the same `404`.
- The validity window is rebuilt from the booking, so renewal never extends access beyond the reserved slot.
- Rate limit: 5 requests per user per hour.

| Status | Meaning                                                  |
| :----- | :------------------------------------------------------- |
| `200`  | `{ "success": true, "offlinePasscard": "<token>" }`      |
| `400`  | Invalid body, or the booking time could not be resolved. |
| `401`  | Not signed in.                                           |
| `404`  | No active booking with that id for this user.            |
| `410`  | The booking has already ended, so it cannot be renewed.  |
| `429`  | Renewal rate limit exceeded.                             |
| `503`  | Signing or lookup failed.                                |

Renewal produces a new token string for the same booking and the same window. Because signatures are randomized, a booking can have several different valid token strings at once.

### 4.3 Private key validation

`validateSigningJwk` rejects the key unless `kty` is `"EC"`, `crv` is `"P-256"`, and `d`, `x` and `y` are nonempty strings. `importSigningKey` independently refuses a JWK with no `d`.

## 5. Public key distribution and caching

### 5.1 Keys endpoint

`GET /api/security/offline-passcards/keys` needs no authentication and returns a JWKS:

```json
{
  "keys": [
    {
      "kty": "EC",
      "crv": "P-256",
      "x": "...",
      "y": "...",
      "kid": "key-2026-1",
      "use": "sig",
      "alg": "ES256"
    }
  ]
}
```

Response headers: `Cache-Control: public, max-age=86400, stale-while-revalidate=3600`. A scanner or CDN can therefore serve a key set that is up to 25 hours old.

`getPublicJwks` enforces these rules on `OFFLINE_PASSCARD_PUBLIC_JWKS` and the endpoint returns `500` with `{ "error": "Public verification keys unavailable" }` if any of them is broken:

| Rule                                                                                                                            | Why                                                       |
| :------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------- |
| The value is valid JSON with a `keys` array of at most 10 entries (`MAX_RETAINED_PUBLIC_KEYS`).                                 | Bounds verification cost on scanners.                     |
| Each key has `kty: "EC"`, `crv: "P-256"`, nonempty `x` and `y`. `use`, if present, is `"sig"`. `alg`, if present, is `"ES256"`. | Only keys that can verify this scheme are published.      |
| No key contains `d`. A key with private material is rejected, not stripped.                                                     | A leaked private key must never be published by accident. |
| Only `kty`, `crv`, `x`, `y`, `use`, `alg` and `kid` survive. Other fields are dropped.                                          | Keeps the published set minimal.                          |
| Every key has a nonempty `kid`, and no two keys share a `kid`.                                                                  | Gives operators a stable name for each key.               |
| If `OFFLINE_PASSCARD_PRIVATE_KEY_JWK` is set, a published key with the same `crv`, `x` and `y` must exist.                      | Guarantees the active signing key can always be verified. |

The active signing key is identified by its coordinates, not by `kid`. Tokens do not mention `kid` at all.

An empty or unset `OFFLINE_PASSCARD_PUBLIC_JWKS` publishes `{ "keys": [] }`.

### 5.2 Importing keys on a scanner

| Function                       | Behavior                                                                                                                                          |
| :----------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------ |
| `importVerificationKey(jwk)`   | Throws if the JWK contains `d`. Imports as a P-256 ECDSA key with usage `verify`.                                                                 |
| `importVerificationKeys(jwks)` | Accepts `{ keys: [...] }` or a plain array. Reads at most 10 entries. Skips any entry that is unusable or contains `d`, without raising an error. |

Because `importVerificationKeys` skips bad entries silently, a scanner should compare the number of imported keys with the number of keys in the response and treat a shortfall as a problem.

### 5.3 What the repository caches in IndexedDB

The only IndexedDB data in the repository is the holder's token store (`offlinePasscardStore.ts`):

| Item         | Value                                                            |
| :----------- | :--------------------------------------------------------------- |
| Database     | `worksphere-offline-passcards`, version 1                        |
| Object store | `passcards`, key path `bookingId`                                |
| Index        | `validUntil`                                                     |
| Record       | `{ bookingId, venueId, token, validFrom, validUntil, storedAt }` |

Behavior to rely on:

- One record per booking. Saving replaces the earlier token.
- `getOfflinePasscard` deletes and refuses an expired token (`now > validUntil * 1000`). `pruneExpiredOfflinePasscards` removes all expired records.
- `getOfflinePasscardRecord` reads without pruning. It is for display only and is never proof of validity.
- `saveOfflinePasscard` checks the signature only when the caller passes `verificationKey` or `verificationKeys` (the window is not checked). `storeOfflinePasscardsFromBooking`, which the booking flow uses, passes neither, so tokens received from the confirm response are stored as given.
- No signing key and no public key is ever stored.

### 5.4 Recommendation: caching public keys on a scanner

The repository has no scanner application, so there is no implemented public key cache. A scanner that has to work offline should:

1. Fetch the keys endpoint whenever the network is available and store the response body (public JWKs only) together with a `fetchedAt` time, in a store separate from the token store.
2. Refresh at least once a day, which matches the `max-age`, and refresh again right after any rotation or key compromise notice.
3. On a failed refresh, keep using the last good set. Do not replace a good set with an empty or partial one.
4. Store JWKs, not exported key objects, and import them with `importVerificationKeys` at startup. Compare the imported count with the stored count.
5. Record `fetchedAt` and show operators when the set is old, because a stale set will not know about a rotation or a revoked key.
6. Try the newest key first. The server publishes keys in the order of the environment variable, and the first genuine match ends the search, so listing the active key first saves verifications.

## 6. Verification

`verifyOfflinePasscard(token, key, options)` and `verifyOfflinePasscardWithKeys(token, keys, options)` implement the algorithm below. A scanner must follow the same order.

1. **Structure.** Split the token and check the structure in section 3.5. A failure returns `malformed`. With a key set, a malformed token returns `malformed` even when the key list is empty.
2. **Signature.** Verify the 64 byte signature over the decoded payload bytes. With a key set, try the keys in order, at most 10 (`MAX_VERIFICATION_KEYS`); keys beyond the tenth are ignored. The first key under which the signature is genuine decides the result. If no key matches, or the key list is empty, the result is `bad-signature`.
3. **Payload.** Parse the bytes. A payload that breaks section 3.2 returns `malformed`, even with a genuine signature.
4. **Window.** Unless `enforceWindow` is `false`, compare `now` with the window (section 8). The result is `not-yet-valid` or `expired` with the payload attached, or `valid`.
5. **Local checks, by the caller.** Compare `payload.venueId` with the scanner's own venue. For a desk scanner, also compare `payload.seatNumber` with the desk, where `"UNASSIGNED"` means no specific seat. Apply any local replay policy (section 7).

| Result                         | Meaning                                       | Scanner action                   |
| :----------------------------- | :-------------------------------------------- | :------------------------------- |
| `{ valid: true, payload }`     | Genuine and inside its window.                | Admit after the venue check.     |
| `not-yet-valid` (with payload) | Genuine, but now is before the window starts. | Refuse. May show the start time. |
| `expired` (with payload)       | Genuine, but now is after the window ended.   | Refuse.                          |
| `bad-signature`                | No key matches this payload and signature.    | Refuse.                          |
| `malformed`                    | Not a token of this format.                   | Refuse.                          |

The signature is checked before the window, so a `not-yet-valid` or `expired` result always describes a genuine passcard, and its payload can be trusted for display. The payload is present on a failure only in those two cases.

`decodeOfflinePasscardPayload(token)` reads the payload without checking the signature. Use it to display or index a token that is verified separately. Never use it to decide admission.

## 7. Anti replay defenses and sharing

### 7.1 What exists

Nothing in the token or the verifier prevents reuse.

- There is no nonce, no `jti` and no single use state.
- The same token can be scanned any number of times inside its window.
- A photo or screenshot of the QR is as good as the original.
- Two scanners cannot tell that the other has already admitted a token, because they are offline.

What limits the damage:

- The window. A copy is useless before `validFrom` and after `validUntil`. The window is the booking length.
- The venue check. A token is bound to one `venueId`.
- The signature. A token cannot be created or edited without the private key.
- On the holder's device, expired tokens are deleted when read.

### 7.2 Recommendation: a local admit log

A scanner that needs single entry behavior can keep its own log:

1. After an admission, store the `bookingId` and the time of admission.
2. Refuse or flag a second scan with the same `bookingId`.
3. Report the log when the scanner is back online.

Key the log on `bookingId`, not on the token string. Renewal (section 4.2) and the randomized signature mean the same booking can legitimately have several different token strings.

This protects one device, not a whole venue. Two doors with separate logs can each admit the same booking once. The repository does not implement an admit log.

## 8. Clock skew and time handling

The check uses the scanner's clock unless the caller passes `now` in milliseconds (a number or a `Date`).

A token is inside its window when:

```
validFrom * 1000 - skew <= now <= validUntil * 1000 + skew        (milliseconds)
skew = clockSkewSeconds * 1000
```

| Rule                                           | Value                                                                                 |
| :--------------------------------------------- | :------------------------------------------------------------------------------------ |
| Default tolerance                              | 0 seconds. Both boundary seconds are valid.                                           |
| Maximum tolerance (`MAX_CLOCK_SKEW_SECONDS`)   | 300 seconds (5 minutes). A larger value is capped to 300, not rejected.               |
| Negative, `NaN` or infinite `clockSkewSeconds` | Treated as 0.                                                                         |
| Applied to                                     | Both ends of the window. Ignored when `enforceWindow` is `false`.                     |
| Where it is passed                             | Per call, as an option of either verify function. No production code passes it today. |

The tolerance also lengthens the time a copied token can be replayed, by up to `skew` before the start and `skew` after the end. That is why it is capped.

Effect of a wrong scanner clock:

| Scanner clock | Effect                                                                                                                         |
| :------------ | :----------------------------------------------------------------------------------------------------------------------------- |
| Slow          | Genuine tokens are refused as `not-yet-valid` at the start of a booking. Expired tokens are accepted for as long as the drift. |
| Fast          | Genuine tokens are refused as `expired` near the end. Tokens are accepted early.                                               |

**Recommendation:**

- Synchronize the scanner clock whenever the network is available and record when that last happened.
- Pass the smallest `clockSkewSeconds` that covers the measured drift. Do not rely on the 300 second cap as a default.
- Treat a clock that has not been synchronized for a long time as untrusted and fall back to a manual check.

## 9. Key rotation runbook

### 9.1 Facts the procedure depends on

- Tokens carry no `kid`. A scanner cannot tell which key signed a token, so every retained public key stays in the verification set until no token signed by it can still be valid.
- At most 10 public keys can be published. The server returns `500` from the keys endpoint when there are more.
- The keys endpoint also returns `500` if the active private key is not in the published set. This is the most important ordering constraint: **publish the new public key before switching the private key.**
- Scanners may hold a key set that is up to 25 hours old (`max-age` 24 hours plus `stale-while-revalidate` 1 hour).
- Renewals and new bookings are signed with the key that is active when they happen. Tokens already issued keep their old signature.
- Revocation of a single token is not possible. Revocation of a key is.

### 9.2 Generate a key pair

Run on a trusted machine with Node 20 or newer. Use a `kid` that is unique and never reused, for example `key-2027-1`.

```js
// generate-passcard-key.mjs
// Usage: node generate-passcard-key.mjs key-2027-1
import { webcrypto } from "node:crypto";

const kid = process.argv[2];
if (!kid) throw new Error("Pass a key id, for example key-2027-1");

const pair = await webcrypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
);
const { kty, crv, x, y, d } = await webcrypto.subtle.exportKey(
  "jwk",
  pair.privateKey,
);

console.log("PRIVATE, secret manager only:");
console.log(JSON.stringify({ kty, crv, x, y, d }));
console.log("PUBLIC, append to the keys array:");
console.log(JSON.stringify({ kty, crv, x, y, kid, use: "sig", alg: "ES256" }));
```

Handling rules for the private output:

- Store it only in the deployment platform's secret store. Never commit it, paste it into a ticket, chat or log, or put it in `.env.example`.
- Clear the terminal scrollback and shell history afterward.
- Never place it in `OFFLINE_PASSCARD_PUBLIC_JWKS`. The endpoint would return `500`.

### 9.3 Planned rotation

Do the phases in order. Do not combine them into one deployment.

**Phase 1. Publish the new public key.**

1. Add the new public JWK (with its `kid`) to the `keys` array in `OFFLINE_PASSCARD_PUBLIC_JWKS`, next to the current key. Keep the count at 10 or fewer. Listing the new key first is allowed, since the active key is matched by coordinates.
2. Do not touch `OFFLINE_PASSCARD_PRIVATE_KEY_JWK`. Deploy.
3. Check the endpoint: `curl https://<host>/api/security/offline-passcards/keys`. Expect `200` and both `kid` values.
4. Wait at least 25 hours so every scanner and CDN has the set that contains the new key. Where scanners can be refreshed by hand, confirm each one has refreshed instead of waiting.

**Phase 2. Switch the signing key.**

1. Set `OFFLINE_PASSCARD_PRIVATE_KEY_JWK` to the new private JWK. Redeploy so the new value is loaded.
2. Check the endpoint again. It must still return `200`. A `500` here means the new private key is missing from the public set; revert the private key and fix the public set.
3. Smoke test with a staging booking. Fetch the keys endpoint, import it with `importVerificationKeys`, and confirm `verifyOfflinePasscardWithKeys(token, keys)` returns `valid: true` for the new token, and still does for a token issued before the switch.

Rollback in this phase: put the previous private JWK back. The old public key is still published, so nothing else changes.

**Phase 3. Retire the old public key.**

1. Work out when the last token signed by the old key can expire: the latest end time among the bookings whose passcards were issued or renewed before the switch.
2. After that moment, plus 25 hours for cached key sets and the largest `clockSkewSeconds` any scanner uses, remove the old key from `OFFLINE_PASSCARD_PUBLIC_JWKS` and deploy.
3. Check the endpoint returns `200` with only the retained keys, and destroy the old private key in the secret store.

Removing the old public key before then makes every unexpired token signed by it fail with `bad-signature`.

### 9.4 Emergency rotation (private key leaked or suspected)

Assume anyone with the key can mint valid tokens for any venue until scanners stop trusting the old public key.

1. Generate a new pair (section 9.2).
2. Set `OFFLINE_PASSCARD_PRIVATE_KEY_JWK` to the new key and set `OFFLINE_PASSCARD_PUBLIC_JWKS` to contain the new public key only. The old public key must not remain, or forged tokens still verify. Deploy both together so the endpoint never fails the active key check.
3. Check the endpoint returns `200` with only the new `kid`.
4. Force every scanner to refresh now. The 24 hour cache means a scanner will not pick up the change on its own for up to 25 hours, and until it does, forged tokens are accepted.
5. Tokens already issued to genuine users become invalid with the old key. Holders recover through the renewal endpoint (section 4.2), which needs an active booking and is limited to 5 requests per user per hour. Plan front desk support for people who are locked out.
6. After the incident, review how the key leaked, and record the date and the `kid` of the compromised key.

### 9.5 Operator checklist

- [ ] New key pair generated, private half stored only in the secret store.
- [ ] `kid` is new and unique.
- [ ] New public key published and confirmed (`200`, both `kid` values) before the private key changes.
- [ ] 25 hours elapsed, or every scanner confirmed refreshed.
- [ ] Private key switched, endpoint still `200`, staging token verifies.
- [ ] Old public key removed only after its last token expired plus cache lag.
- [ ] Published key count is 10 or fewer.

## 10. Known gaps

These are properties of the current implementation, not oversights in this document.

| Gap                                                  | Detail                                                                                                    |
| :--------------------------------------------------- | :-------------------------------------------------------------------------------------------------------- |
| No scanner application                               | Only the verification functions exist. Venue, seat, clock and replay checks are the scanner author's job. |
| No public key cache implementation                   | Section 5.4 is guidance only.                                                                             |
| No replay protection                                 | Section 7.                                                                                                |
| No revocation of a single token                      | A cancelled booking's passcard stays valid until `validUntil`.                                            |
| No tier or clearance level                           | The token authorizes entry to a venue for a window, nothing more.                                         |
| No `kid` in the token                                | Verification cost grows with the number of retained keys, up to 10 verifications.                         |
| Environment variables undocumented in `.env.example` | See section 4.1.                                                                                          |

## 11. Constants

| Constant                           | Value          | Defined in                       | Meaning                                              |
| :--------------------------------- | :------------- | :------------------------------- | :--------------------------------------------------- |
| `OFFLINE_PASSCARD_VERSION`         | `1`            | `offlineQrSigner.ts`             | First item of the payload.                           |
| `SIGNATURE_BYTES`                  | `64`           | `offlineQrSigner.ts`             | Raw P-256 signature length.                          |
| `MAX_FIELD_LENGTH`                 | `128`          | `offlineQrSigner.ts`             | Longest text field.                                  |
| `MAX_CLOCK_SKEW_SECONDS`           | `300`          | `offlineQrSigner.ts`             | Largest accepted clock skew tolerance.               |
| `MAX_VERIFICATION_KEYS`            | `10`           | `offlineQrSigner.ts`             | Keys tried for one token, and keys imported per set. |
| `MAX_RETAINED_PUBLIC_KEYS`         | `10`           | `keyRotation.ts`                 | Keys allowed in the published set.                   |
| `UNASSIGNED_SEAT`                  | `"UNASSIGNED"` | `serverOfflinePasscardIssuer.ts` | Seat value when none is assigned.                    |
| `DEFAULT_BOOKING_DURATION_MINUTES` | `60`           | `serverOfflinePasscardIssuer.ts` | Duration when the booking has none.                  |

## 12. Tests that pin this behavior

| Area                                   | Test file                                                                       |
| :------------------------------------- | :------------------------------------------------------------------------------ |
| Signing, verification, malformed input | `src/__tests__/lib/security/offlineQrSigner.test.ts`                            |
| Clock skew and its cap                 | `src/__tests__/lib/security/offlineQrSignerClockSkew.test.ts`                   |
| Multi key verification                 | `src/__tests__/lib/security/offlineQrSignerKeySet.test.ts`                      |
| Client token storage                   | `src/__tests__/lib/security/offlinePasscardStore.test.ts`                       |
| Server issuer and payload building     | `src/__tests__/security/serverOfflinePasscardIssuer.test.ts`                    |
| Key rotation and JWKS rules            | `src/__tests__/security/keyRotation.test.ts`, `keyRotationVerification.test.ts` |
| Public keys endpoint                   | `src/__tests__/security/publicKeyEndpoint.test.ts`                              |
| Confirm route integration              | `src/__tests__/security/bookingConfirmPasscardIntegration.test.ts`              |
| Renewal endpoint                       | `src/__tests__/api/qrPasscardIssue.test.ts`                                     |

## 13. Changing the format

Any change to the payload layout, the algorithm or the encoding is a format change. Increase `OFFLINE_PASSCARD_VERSION` and update this document in the same pull request. Current verifiers reject any version other than `1` as `malformed`, so scanners must be updated before the issuer starts producing the new version, or old and new versions must be issued side by side during a migration.
