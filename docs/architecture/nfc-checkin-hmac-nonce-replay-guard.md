# NFC Check-In HMAC Signature and Nonce Replay Guard

This document describes the NFC tap-signature verification and nonce replay
protection implemented by `NFCDeskCheckinController`.

## Tap payload and signature

The controller accepts an `NFCTapPayload` with these fields:

| Field | Meaning |
| --- | --- |
| `tagUid` | NFC tag UID string. The interface describes an ISO 14443A Type A 7-byte UID represented as hex; the controller does not normalize or validate that format. |
| `userId` | User identity bound into the signature. |
| `deskId` | Registered desk identity; selects the desk's secret key. |
| `timestamp` | Tag-supplied Unix epoch time in milliseconds. |
| `nonce` | Tap nonce, included in the signature and replay cache. |
| `operation` | `checkin` or `checkout`; binds the signature to the requested operation. |
| `version` | Optional protocol version. If supplied, it must equal `"1"`. |
| `signature` | HMAC-SHA256 digest encoded as hexadecimal. |

`computeTapSignature()` uses the registered desk secret as the HMAC key and
SHA-256 as the hash. It signs this exact UTF-8 canonical string:

```text
1\n<tagUid>\n<userId>\n<deskId>\n<operation>\n<String(timestamp)>\n<nonce>
```

In the canonical string, `\n` means one LF byte (`0x0A`), with no leading or
trailing newline. Field order is fixed: protocol version, tag UID, user ID,
desk ID, operation, timestamp converted with JavaScript `String(timestamp)`,
and nonce. The version is always the controller constant `"1"`; omitting
`payload.version` does not remove it from the signed data. No trimming,
case-folding, Unicode normalization, or other field normalization is applied.
The generated digest is the full 32-byte HMAC rendered as 64 lowercase hex
characters.

Verification recomputes the digest and decodes expected and received
signatures with `Buffer.from(value, "hex")`. It requires equal decoded byte
lengths and compares them with Node's `timingSafeEqual`. A malformed signature
that throws during decoding/comparison is treated as invalid. Uppercase hex
decodes to the same bytes and can compare successfully; the verifier compares
decoded bytes, not hex-string casing.

## Secret handling

The controller does not generate keys or load them from an environment
variable. A caller supplies a string `secretKey` when calling
`registerDesk(deskId, secretKey)`. That key is held in the in-memory
`DeskRecord` for the desk and can be replaced with `rotateDeskKey`; rotating
the key takes effect immediately. Key length and format are not validated by
the controller.

`exportState()` includes the desk records and therefore their `secretKey`
values. Callers persisting exported snapshots must protect them as secret
material. The nonce map and desk registry are process-local unless an
application explicitly persists and restores snapshots.

## Timestamp freshness and nonce replay protection

The default maximum clock skew is **30,000 ms** (`maxClockSkewMs`), configurable
through `NFCDeskControllerConfig`. The check is:

```text
abs(currentTimeMs - payload.timestamp) > maxClockSkewMs  => reject
```

Thus a tap exactly at the configured skew boundary is accepted by the
freshness check; a tap even one millisecond beyond it is rejected. The default
nonce-cache retention is **60,000 ms** (`nonceCacheTtlMs`), also configurable.
The implementation does not separately validate that the timestamp is an
integer or finite number.

The nonce cache maps the nonce string to the `currentTimeMs` at successful
verification. Nonces are keyed only by their string value within one controller
instance, not by desk, user, or operation. The nonce must be part of a valid
signature before it can enter the cache. Verification order is:

1. Find the registered desk.
2. Check any supplied protocol version and reject revoked tags.
3. Check timestamp freshness.
4. Check the expected operation (`checkin` or `checkout`).
5. Verify the HMAC in constant time.
6. Remove expired nonce-cache entries, reject an already-seen nonce, then
   consume the nonce.

Nonce cleanup occurs on the path after a valid HMAC, not on a timer. An entry
is removed only when `currentTimeMs - storedTime > nonceCacheTtlMs`; at exactly
the TTL boundary it is still present and replay is rejected. Invalid signatures
do not consume a nonce. Since timestamps are checked before nonce cleanup,
expired-cache entries can remain until a later tap passes the signature check.

`exportState()` includes `seenNonces`; `restoreState()` restores them without
automatically expiring entries. The replay guard is therefore per
controller/cache state and is not a distributed, cross-process guarantee.

## Illustrative test vector

The following key is deliberately public test data and **must never be used in
production**:

```text
test-only-nfc-secret-not-for-production
```

Input values:

```text
version   = "1" (controller constant; payload.version may be omitted)
tagUid    = "04A1B2C3D4E5F6"
userId    = "user-42"
deskId    = "desk-17"
operation = "checkin"
timestamp = 1735689600000
nonce     = "nonce-8f3a2c"
```

Exact canonical payload (the line breaks are LF, with no trailing LF):

```text
1
04A1B2C3D4E5F6
user-42
desk-17
checkin
1735689600000
nonce-8f3a2c
```

Expected HMAC-SHA256 hex signature for that key and UTF-8 payload:

```text
3e60e7f850f8a3572146a45b6fad5673dbe59308ebf9ea7f4cf053886da1ffda
```

With `desk-17` registered to that test secret, no revoked tag, no prior use
of `nonce-8f3a2c`, and `currentTimeMs` set to `1735689600000`, verification
accepts this tap. A successful `checkIn()` then returns:

```json
{ "success": true, "state": "OCCUPIED" }
```

The successful verification consumes the nonce. Submitting another correctly
signed tap with the same nonce within the replay-cache window is rejected as a
replay. A tap with a timestamp outside the configured skew is rejected before
signature verification and does not consume its nonce.

## Failure results

The controller is a library class, not an HTTP endpoint; it returns JavaScript
result objects and error strings rather than HTTP status codes or error codes.

Authentication failures can return these messages:

- `Desk <deskId> is not registered`
- `Unsupported protocol version: <version>`
- `NFC tag <tagUid> has been revoked`
- `Timestamp drift <drift>ms exceeds max clock skew of <limit>ms`
- `Operation mismatch: expected '<expected>', got '<actual>'`
- `Invalid cryptographic NFC signature`
- `Replay attack detected: nonce <nonce> was already used`

`checkIn()` returns `{ success: false, state: "AVAILABLE", error }` for
authentication failures, increments `rejectedTaps`, and invokes the
unauthorized/rejected callbacks when configured. After authentication, it can
also reject a desk under maintenance or occupied by another user.

`checkOut()` likewise returns a failed result for authentication failures and
increments `rejectedTaps`; it does not invoke those check-in rejection
callbacks. A validly authenticated checkout can fail if the desk is already
available or the user is not the active checked-in user. Nonce consumption
happens during successful authentication, before these desk-state checks, so
a validly signed tap rejected for desk state has still consumed its nonce.
