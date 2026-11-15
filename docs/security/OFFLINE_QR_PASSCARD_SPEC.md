# Offline QR Passcard Specification

This is the API and security specification for offline QR passcards: how the server issues one, what a scanner must check, and what the design does and does not protect against.

[offline-qr-passcards.md](./offline-qr-passcards.md) is the implementation guide (token format, key rotation, client storage, display). This document does not repeat it; it adds the request and response schemas, the scanner workflow and the threat model.

For the full signing scheme, payload specification, public key distribution and key rotation runbook, see [OFFLINE_QR_PASSCARDS_SPECIFICATION.md](./OFFLINE_QR_PASSCARDS_SPECIFICATION.md).

## What is implemented

Everything below describes the code as it is today. It differs from some descriptions of this feature, so the differences are listed first.

| Topic             | Implemented                                                                                                  |
| :---------------- | :----------------------------------------------------------------------------------------------------------- |
| Issuance endpoint | There is no dedicated issuance endpoint. A passcard is issued as part of `POST /api/bookings/confirm`.       |
| Signature         | ECDSA with P-256 and SHA-256, through the Web Crypto API. HMAC-SHA256 and Ed25519 are not used.              |
| Payload           | Booking, user, venue, validity window and seat. There is no membership tier or clearance level in the token. |
| Expiry            | `validUntil`, the end of the booking.                                                                        |
| Scanner           | The repository has the verification function a scanner needs, but no turnstile or desk-scanner application.  |

A symmetric scheme such as HMAC would require every scanner to hold the signing secret, so one stolen scanner could forge passcards. With ECDSA a scanner only holds public keys.

Source files:

- `src/lib/security/offlineQrSigner.ts`: payload validation, signing, verification
- `src/lib/security/serverOfflinePasscardIssuer.ts`: server-only issuer
- `src/lib/security/keyRotation.ts`: public key set
- `src/app/api/bookings/confirm/route.ts`: issuance
- `src/app/api/security/offline-passcards/keys/route.ts`: public keys
- `src/lib/security/offlinePasscardStore.ts`: client storage

## Issuance: `POST /api/bookings/confirm`

Requires a signed-in user. The request is the normal booking request; there are no passcard-specific fields.

### Request body

| Field                                                  | Type                   | Required                 | Notes                                                                                      |
| :----------------------------------------------------- | :--------------------- | :----------------------- | :----------------------------------------------------------------------------------------- |
| `venue.id`                                             | string, 1 to 200 chars | yes                      | Other `venue` fields (`placeId`, `name`, `address`, `category`, coordinates) are optional. |
| `time`                                                 | string                 | yes                      | Arrival time.                                                                              |
| `date`                                                 | string                 | one of `date` or `dates` | A single booking date.                                                                     |
| `dates`                                                | string[] , at most 31  | one of `date` or `dates` | Several dates create one booking each. Duplicates are removed.                             |
| `timeZone`                                             | string                 | no                       | IANA time zone. An invalid or missing value falls back to `UTC`.                           |
| `customerEmail`, `customerPhone`, `projectBillingCode` | string or null         | no                       | Not used for the passcard.                                                                 |

A booking may start up to 15 minutes in the past, to allow walk-ins.

### Successful response (200)

```json
{
  "success": true,
  "bookingId": "bk_1",
  "bookingIds": ["bk_1"],
  "confirmationId": "WS-1A2B3C4D",
  "confirmationIds": ["WS-1A2B3C4D"],
  "venueId": "venue_1",
  "offlinePasscard": "<payload>.<signature>"
}
```

| Field                  | Present when                           | Meaning                                                                                                    |
| :--------------------- | :------------------------------------- | :--------------------------------------------------------------------------------------------------------- |
| `offlinePasscard`      | the first booking's token was signed   | Token for the first booking.                                                                               |
| `offlinePasscards`     | more than one booking was created      | One entry per booking, in the order of `bookingIds`. An entry is `null` if that token could not be signed. |
| `offlinePasscardError` | at least one token could not be signed | Always the string `"Signing unavailable"`.                                                                 |

A signing failure never fails the booking. If the signing key is missing or invalid, the response is still `200` with `success: true`, without `offlinePasscard` and with `offlinePasscardError`.

### Error responses

| Status | When                                                                                                                                |
| :----- | :---------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | The body fails validation, the time or a date is invalid, or the slot is in the past. Body: `{ "success": false, "error": "..." }`. |
| `401`  | No signed-in user.                                                                                                                  |
| `429`  | More than 5 booking requests per user in a minute. Includes `Retry-After`.                                                          |

The route returns further statuses for booking conflicts; those are unrelated to passcards.

### Token contents

```
token   = base64url(payload) + "." + base64url(signature)
payload = [1, bookingId, userId, venueId, validFrom, validUntil, seatNumber]
```

| Position | Field                            | Rule                                                                                                               |
| :------- | :------------------------------- | :----------------------------------------------------------------------------------------------------------------- |
| 0        | version                          | Always `1`.                                                                                                        |
| 1 to 3   | `bookingId`, `userId`, `venueId` | Non-empty strings, at most 128 characters.                                                                         |
| 4        | `validFrom`                      | Unix seconds: the booking start in the booking's time zone.                                                        |
| 5        | `validUntil`                     | Unix seconds: start plus the booking duration, 60 minutes if the booking has none. Must be later than `validFrom`. |
| 6        | `seatNumber`                     | The assigned seat, or `"UNASSIGNED"`.                                                                              |

The signature is the raw 64-byte form (`r` then `s`), not DER.

## Public keys: `GET /api/security/offline-passcards/keys`

No authentication. Returns the verification keys as a JWKS:

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

- At most 10 keys. Each must have a unique `kid`.
- The private component `d` is never published.
- `Cache-Control: public, max-age=86400, stale-while-revalidate=3600`.
- `500` with `{ "error": "Public verification keys unavailable" }` if the key set is misconfigured.

## Offline verification workflow

This is what a turnstile or desk check-in scanner has to do. The first step needs the network; the rest do not.

1. **While online**, fetch the JWKS and store it. Import each key with `importVerificationKey`, which rejects a key that contains private material. Refresh at least daily.
2. **Scan** the QR code. Its text is the token.
3. **Verify** with `verifyOfflinePasscard(token, key)`. The token carries no key identifier, so try each stored key until one succeeds. A `bad-signature` result under every key means the passcard is not genuine.
4. **Check the venue.** `verifyOfflinePasscard` does not know which door it is at. The scanner must compare `payload.venueId` with its own venue, or a passcard for one venue opens another.
5. **Check the result.**

| Result                       | Action                                                                              |
| :--------------------------- | :---------------------------------------------------------------------------------- |
| `valid: true`                | Admit, after the venue check.                                                       |
| `not-yet-valid`              | Genuine but early. The payload is returned, so the scanner can show the start time. |
| `expired`                    | Genuine but the booking is over.                                                    |
| `bad-signature`, `malformed` | Refuse.                                                                             |

The signature is checked before the validity window, so `not-yet-valid` and `expired` always describe a genuine passcard.

For a desk scanner, also compare `payload.seatNumber` with the desk. A value of `UNASSIGNED` means the booking has no specific seat.

## Threat model

### Forgery

A passcard cannot be created or altered without the private key. The key is read only by a `server-only` module and is imported as non-extractable. Scanners and browsers hold public keys only.

If the private key leaks, anyone can mint passcards until the matching public key is removed from `OFFLINE_PASSCARD_PUBLIC_JWKS` and every scanner has refreshed. With the 24-hour cache header, that can take a day unless scanners are refreshed by hand.

### Replay and sharing

The token is a bearer credential. It has no nonce and no single-use state, and the scanner is offline, so:

- the same passcard can be scanned any number of times inside its window;
- a screenshot or photo of the QR code works as well as the original;
- two scanners at the same venue cannot tell that the other has already admitted it.

What limits the damage is the window: a copy is useless before `validFrom` and after `validUntil`.

A scanner that needs more should keep its own record of the `bookingId` values it has admitted and refuse or flag a repeat, then report that record when it is back online. That protects one device, not a whole venue. The repository does not implement this.

### Clock skew

By default the validity check has no tolerance. A passcard is valid when:

```
validFrom * 1000 - skew <= now <= validUntil * 1000 + skew    (milliseconds)
```

`skew` is `clockSkewSeconds * 1000`. The option defaults to 0 and is capped at 300 seconds (`MAX_CLOCK_SKEW_SECONDS`); a negative or non-finite value counts as 0.

`now` is the scanner's clock unless the caller passes the `now` option. A scanner that has been offline for a long time can drift, with these effects:

| Scanner clock | Effect                                                                                                                     |
| :------------ | :------------------------------------------------------------------------------------------------------------------------- |
| Slow          | Refuses genuine passcards as `not-yet-valid` at the start of a booking, and accepts expired ones for as long as the drift. |
| Fast          | Refuses genuine passcards as `expired` near the end, and accepts them early.                                               |

Recommendations for a scanner:

- Synchronise the clock whenever the network is available, and record when that last happened.
- To allow a tolerance, pass `clockSkewSeconds` to `verifyOfflinePasscard` or `verifyOfflinePasscardWithKeys`. Keep it small: every second of tolerance also extends the replay window.
- Treat a clock that has not been synchronised for a long time as untrusted and fall back to a manual check.

### Revocation

A cancelled booking's passcard stays cryptographically valid until `validUntil`. An offline scanner cannot learn about the cancellation. The only bound is the booking length.

### Information in the token

The payload is encoded, not encrypted. Anyone who can see the QR code can read the booking, user and venue identifiers, the times and the seat. It contains no name, email or payment data. `decodeOfflinePasscardPayload` reads these without checking the signature and must never be used to decide admission.

### Stolen device

On the holder's device the token is stored in IndexedDB. Whoever has the unlocked device can present the passcard. Expired tokens are deleted when read.
