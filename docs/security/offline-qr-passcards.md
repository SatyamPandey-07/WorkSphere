# Offline QR Passcards

A passcard that needs the network is useless in a basement or a shielded coworking space. An offline passcard is one compact token, signed with ECDSA (P-256, SHA-256) through the Web Crypto API and drawn as a QR code. A scanner that holds the venue's public verification key can check it with no network.

For the request and response schemas, the scanner workflow and the threat model, see [OFFLINE_QR_PASSCARD_SPEC.md](./OFFLINE_QR_PASSCARD_SPEC.md).

Code:
- Shared crypto: `src/lib/security/offlineQrSigner.ts` (sign and verify)
- Client IndexedDB store: `src/lib/security/offlinePasscardStore.ts`
- Passcard UI component: `src/components/bookings/FlightClearancePasscard.tsx`
- Server-side issuer: `src/lib/security/serverOfflinePasscardIssuer.ts`
- Key rotation & JWKS utilities: `src/lib/security/keyRotation.ts`
- Public verification endpoint: `src/app/api/security/offline-passcards/keys/route.ts`

## Token format

```
token = base64url(payload) + "." + base64url(signature)
payload = [1, bookingId, userId, venueId, validFrom, validUntil, seatNumber]
```

- The payload is a fixed order JSON array, not an object, so the same facts always give the same bytes and the QR stays small (about 250 characters).
- `validFrom` and `validUntil` are Unix seconds. Text fields are non-empty and at most 128 characters.
- When a booking does not have a designated seat assigned, the server issues the token with `seatNumber = "UNASSIGNED"`, satisfying non-empty string validation.
- The signature is the raw 64 byte P-256 form (r then s) that Web Crypto produces, not DER.
- The signature is checked against the exact payload bytes carried in the token, never a re-serialised copy, so there is nothing to canonicalise on the verifying side.
- No `kid` or JWS header is placed in the token to keep the QR payload compact and preserve 100% backward compatibility with existing client verifiers.

## Server-Side Signing and Issuance (#7820)

Server-side issuance occurs upon booking confirmation in `POST /api/bookings/confirm`.

### Environment Configuration

- `OFFLINE_PASSCARD_PRIVATE_KEY_JWK`: JSON string of the active EC P-256 private JWK (must include `kty: "EC"`, `crv: "P-256"`, `d`, `x`, `y`). Kept strictly server-side using `"server-only"`.
- `OFFLINE_PASSCARD_PUBLIC_JWKS`: JSON string containing an array of public verification JWKs (e.g. `{"keys": [{"kty": "EC", "crv": "P-256", "x": "...", "y": "...", "kid": "key-2026-1", "use": "sig", "alg": "ES256"}]}`).

### Failure Behavior

Passcard signing is designed to never abort or fail a successful booking transaction. If the private key is unconfigured, malformed, or signing fails:
- The confirmed booking succeeds and is stored in the database.
- The API response omits `offlinePasscard` and returns `offlinePasscardError: "Signing unavailable"`.
- No invalid, fabricated, or null tokens are stored by the client.

### Timestamp & Validity Window Rules

- `validFrom`: derived directly from the booking's wall-clock start time parsed into a UTC `Date` instant using `parseBookingDateTime(date, time, timeZone)`, converted once to Unix epoch seconds (`Math.floor(startsAt.getTime() / 1000)`).
- `validUntil`: calculated by adding the booking duration (in minutes, defaulting to 60 minutes if omitted or non-positive) to `startsAt`.
- If `validUntil <= validFrom`, payload construction throws and token issuance is safely aborted for that booking.

## Key Rotation Procedure

1. **Active Signing Key**: The active signing key in `OFFLINE_PASSCARD_PRIVATE_KEY_JWK` is used to sign all newly created bookings.
2. **Public Verification Keys**: The environment variable `OFFLINE_PASSCARD_PUBLIC_JWKS` contains the current active public key along with previously issued retained public keys.
3. **Multi-Key Verification**: Scanners verify tokens against the set of retained public keys. `importVerificationKeys(jwks)` imports the published key set and `verifyOfflinePasscardWithKeys(token, keys)` tries the keys sequentially (bounded to at most 10 keys). Tokens signed with older keys remain valid until their `validUntil` expiration timestamp passes.
4. **Key Retirement**: Once all tokens issued by a retired key have expired, the old public key can be removed from `OFFLINE_PASSCARD_PUBLIC_JWKS`.

## Public Verification Endpoint

`GET /api/security/offline-passcards/keys` publishes the public verification JWKS.

- Standard JWKS response: `{ "keys": [ ... ] }`.
- Publishes only public fields (`kty`, `crv`, `x`, `y`, `use`, `alg`, `kid`).
- Private component `d` is strictly forbidden and stripped.
- HTTP response headers set `Cache-Control: public, max-age=86400, stale-while-revalidate=3600`.

## Offline Verification & Revocation Limitations

Scanners check signatures against the cached public verification JWKS without cellular or network access. Offline scanners evaluate cryptographic validity and the `validFrom`/`validUntil` time window. Because offline scanners do not contact a central database, immediate revocation of an unexpired passcard while completely offline is not possible until the scanner reconnects or the token's validity window expires.

## Verifying

`verifyOfflinePasscard(token, verificationKey, { now?, enforceWindow? })` checks the signature first and the validity window second. It returns `{ valid: true, payload }` or `{ valid: false, reason }`:

| reason          | meaning                                                                             |
| :-------------- | :---------------------------------------------------------------------------------- |
| `malformed`     | not two Base64URL segments, wrong signature length, or a payload of the wrong shape |
| `bad-signature` | the signature does not match this payload under this key                            |
| `not-yet-valid` | genuine, but `now` is before `validFrom` (the payload is returned)                  |
| `expired`       | genuine, but `now` is after `validUntil` (the payload is returned)                  |

Both boundary seconds are valid.

## Storage

`offlinePasscardStore.ts` keeps one token per booking in IndexedDB (`worksphere-offline-passcards`, keyed by `bookingId`). A token is proof of entry, so an expired one is never served: reading it deletes it. `pruneExpiredOfflinePasscards()` clears all expired ones.

`BookingModal` calls `storeOfflinePasscardsFromBooking` on a confirmed booking. It looks for `offlinePasscard` on the booking in the response (or on each booking of a list), stores what is valid and skips the rest. A storage problem never fails the booking.

## Display

`FlightClearancePasscard` takes optional `offlineToken` and `bookingId` props. A token passed in wins; otherwise the one stored for `bookingId` is loaded. With a token the QR is the token itself (level M, larger) and a "Works offline" badge shows. With neither, the QR is the online verify link as before.
