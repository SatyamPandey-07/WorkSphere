# Offline QR Passcards

A passcard that needs the network is useless in a basement or a shielded coworking space. An offline passcard is one compact token, signed with ECDSA (P-256, SHA-256) through the Web Crypto API and drawn as a QR code. A scanner that holds the venue's public verification key can check it with no network.

Code: `src/lib/security/offlineQrSigner.ts` (sign and verify), `src/lib/security/offlinePasscardStore.ts` (IndexedDB), `src/components/bookings/FlightClearancePasscard.tsx` (QR).

## Token format

```
token = base64url(payload) + "." + base64url(signature)
payload = [1, bookingId, userId, venueId, validFrom, validUntil, seatNumber]
```

- The payload is a fixed order JSON array, not an object, so the same facts always give the same bytes and the QR stays small (about 250 characters).
- `validFrom` and `validUntil` are Unix seconds. Text fields are non-empty and at most 128 characters.
- The signature is the raw 64 byte P-256 form (r then s) that Web Crypto produces, not DER.
- The signature is checked against the exact payload bytes carried in the token, never a re-serialised copy, so there is nothing to canonicalise on the verifying side.

## Verifying

`verifyOfflinePasscard(token, verificationKey, { now?, enforceWindow? })` checks the signature first and the validity window second. It returns `{ valid: true, payload }` or `{ valid: false, reason }`:

| reason          | meaning                                                                             |
| :-------------- | :---------------------------------------------------------------------------------- |
| `malformed`     | not two Base64URL segments, wrong signature length, or a payload of the wrong shape |
| `bad-signature` | the signature does not match this payload under this key                            |
| `not-yet-valid` | genuine, but `now` is before `validFrom` (the payload is returned)                  |
| `expired`       | genuine, but `now` is after `validUntil` (the payload is returned)                  |

Both boundary seconds are valid.

## Keys

- The issuer keeps the private key. Only the public key (a JWK) goes to scanners or to the browser.
- `importVerificationKey` refuses a JWK that carries private material (`d`). `importSigningKey` refuses one that does not.
- `generateOfflinePasscardKeyPair`, `exportVerificationKeyJwk`, `importVerificationKey` and `importSigningKey` cover the key lifecycle.

## Storage

`offlinePasscardStore.ts` keeps one token per booking in IndexedDB (`worksphere-offline-passcards`, keyed by `bookingId`). A token is proof of entry, so an expired one is never served: reading it deletes it. `pruneExpiredOfflinePasscards()` clears all expired ones.

`BookingModal` calls `storeOfflinePasscardsFromBooking` on a confirmed booking. It looks for `offlinePasscard` on the booking in the response (or on each booking of a list), stores what is valid and skips the rest. A storage problem never fails the booking.

## Display

`FlightClearancePasscard` takes optional `offlineToken` and `bookingId` props. A token passed in wins; otherwise the one stored for `bookingId` is loaded. With a token the QR is the token itself (level M, larger) and a "Works offline" badge shows. With neither, the QR is the online verify link as before.

## Not covered yet

Issuing: nothing on the server signs tokens yet, so `/api/bookings` does not return `offlinePasscard`. Issuing needs a private key held on the server and rules for the validity window and seat number. Until then the client side works with any token produced by `signOfflinePasscard`.
