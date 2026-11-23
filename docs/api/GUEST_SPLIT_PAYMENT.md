# Guest Split Payment API Guide

Comprehensive API documentation for the WorkSphere guest split-payment token lifecycle and checkout endpoints: `GET /api/payments/split/{token}` and `POST /api/payments/split/{token}`.

---

## 1. Overview

The Guest Split Payment API enables guests invited to a workspace booking to review their allocated share of the booking cost and record payment state in WorkSphere's database using the verified token claims.

When a host reserves a workspace and adds guests, the billing system computes individual shares (via `calculateSplitBill`) and generates a signed payment token for each participant. Guests receive a payment link (e.g. `/pay/split/{token}`) containing this token. Access to the split-payment endpoints requires both an authenticated Clerk session and a valid, unexpired signed token; a valid token alone is not sufficient for an unauthenticated request. Once authenticated, the token provides the claims necessary to inspect checkout details and record payment state in WorkSphere's database.

> [!IMPORTANT]
> **Internal State Recording vs. External Settlement:**  
> The guest split-payment endpoint records payment status directly within the WorkSphere database (`BookingGuest` table). The endpoint **does not** integrate with an external payment gateway (such as Stripe, PayPal, or Adyen), does not process credit cards, does not collect payment method tokens, and does not verify third-party settlement webhooks.
>
> The endpoint verifies only the token signature and expiration timestamp. The amount and currency in the token are used to record internal WorkSphere payment state (`paidAt`, `paidAmountCents`, `paidCurrency`). No money transfer, card charge, or external payment-provider settlement is verified by the system, and a valid token is not evidence of external funds transfer.

---

## 2. Endpoint Summary

| Method | Endpoint                      | Description                                                                                                                   |
| :----- | :---------------------------- | :---------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/payments/split/{token}` | Verifies the split payment token and returns checkout details, venue information, host name, and current payment status.      |
| `POST` | `/api/payments/split/{token}` | Idempotently records payment state in WorkSphere's database using the verified token claims and unlocks a digital guest pass. |

---

## 3. Authentication and Middleware Behavior

WorkSphere protects split-payment routes using Clerk authentication at the edge middleware layer:

- **Dual-Requirement Access Contract:**  
  A valid token alone is not sufficient to access the endpoint. Successful access requires both:
  - An **authenticated Clerk session** at the edge middleware layer, and
  - A **valid, unexpired signed token** verified by the route handler.
- **Edge Middleware Boundary (`src/middleware.ts`):**  
  The path `/api/payments/split/*` is not registered in `isPublicRoute`. All incoming requests matching `/(api|trpc)(.*)` are intercepted by Clerk middleware if no active session is present. Unauthenticated requests are issued an **HTTP 307 Temporary Redirect** to `/sign-in` with an encoded `redirect_url` parameter preserving the target checkout URL.
- **Route Handler Execution:**  
  The route handlers in `src/app/api/payments/split/[token]/route.ts` do not invoke Clerk's `auth()` helper and do not return an HTTP `401 Unauthorized` JSON response. Once the request passes the edge middleware boundary with an authenticated session, the endpoint authorizes operations based on the cryptographic validity of the path `{token}`.

---

## 4. Signed Token Format

Split-payment tokens are created by `generateSplitPaymentToken` and verified by `verifySplitPaymentToken` in `src/lib/billing/splitPayment.ts`.

### Token Structure

A split payment token consists of two dot-separated segments:

```text
<base64url-encoded-payload>.<base64url-encoded-signature>
```

1. **Payload Segment:** The serialized JSON string of the token payload, encoded using URL-safe Base64 (`base64url`).
2. **Signature Segment:** An HMAC-SHA256 signature generated over the Base64URL-encoded payload string using the server secret (`SPLIT_PAYMENT_SECRET`), encoded in Base64URL.

```text
BASE64URL(JSON payload) + "." +
BASE64URL(HMAC-SHA256(BASE64URL(JSON payload)))
```

### Verification and Lifetime

- **Signature Comparison:** When verifying the token, `verifySplitPaymentToken` recomputes the HMAC-SHA256 signature over the payload segment. The implementation checks signature-buffer lengths and uses `crypto.timingSafeEqual` to compare equal-length signature buffers.
- **Default Expiration:** Tokens default to a validity window of **72 hours** (`expiresInHours: 72`). If `Date.now() > payload.expiresAt`, the token is rejected as expired.
- **Default Currency:** If no currency is supplied during token generation, the token utility defaults to `"USD"`.

---

## 5. Token Payload Schema

The decoded JSON payload contains the following properties:

| Field       | Type                | Description                                                    |
| :---------- | :------------------ | :------------------------------------------------------------- |
| `bookingId` | `string`            | The unique identifier of the associated `Booking`.             |
| `guestId`   | `string`            | The unique identifier of the associated `BookingGuest` record. |
| `email`     | `string`            | The email address of the invited guest.                        |
| `name`      | `string` (optional) | The display name of the guest, if provided when invited.       |
| `amount`    | `number`            | The guest's calculated share of the total booking cost.        |
| `currency`  | `string`            | Three-letter currency code (e.g. `"USD"`).                     |
| `venueName` | `string`            | The venue name recorded at token creation time.                |
| `date`      | `string`            | The booking date at token creation time (e.g. `"2026-10-15"`). |
| `time`      | `string`            | The booking time at token creation time (e.g. `"14:00"`).      |
| `expiresAt` | `number`            | Unix epoch timestamp in milliseconds when the token expires.   |

### Example Decoded Payload

```json
{
  "bookingId": "booking_cuid_12345678",
  "guestId": "guest_cuid_87654321",
  "email": "guest@example.com",
  "name": "Jordan Lee",
  "amount": 25.5,
  "currency": "USD",
  "venueName": "Downtown Central Workspace",
  "date": "2026-10-15",
  "time": "14:00",
  "expiresAt": 1792195200000
}
```

---

## 6. Secret Configuration and Security Considerations

### Signing Secret Configuration

The token engine reads the signing secret from the environment:

```typescript
const SPLIT_SECRET = process.env.SPLIT_PAYMENT_SECRET || "<in-source-fallback>";
```

> [!WARNING]
> **Production Secret Requirement:**  
> The current implementation falls back to an in-source default key when `SPLIT_PAYMENT_SECRET` is absent from environment variables, rather than failing closed. Production deployments **must** explicitly configure a unique, high-entropy `SPLIT_PAYMENT_SECRET` in their environment configuration to protect token signatures against tampering.

### Operational Considerations

- **Secret Rotation Invalidation:** Modifying or rotating `SPLIT_PAYMENT_SECRET` immediately invalidates all active, unredeemed split payment tokens issued under the prior secret.
- **Token Sensitivity & Dual-Requirement Security:** Access requires both an active Clerk authentication session and a valid signed token; presenting a signed token without an authenticated session results in an HTTP 307 redirect to `/sign-in`. However, for any authenticated user, presenting a valid signed token allows viewing checkout details and recording payment state in WorkSphere's database using the verified token claims. Tokens must therefore be treated as sensitive credentials, transmitted only via secure direct channels (e.g., email or WhatsApp deep links), and never logged in plain text or indexed publicly.

---

## 7. GET `/api/payments/split/{token}`

Verifies the split payment token and returns checkout details for the guest.

### Path Parameters

| Parameter | Type     | Required | Description                                                       |
| :-------- | :------- | :------- | :---------------------------------------------------------------- |
| `token`   | `string` | Yes      | The dot-separated signed payment token (`<payload>.<signature>`). |

### Request Processing & Verification Sequence

1. **Token Verification:** Evaluates `verifySplitPaymentToken(token)`. Returns HTTP `400` if the signature is invalid or the token has expired.
2. **Booking Resolution:** Queries the database for the booking by `payload.bookingId`, selecting venue details, host user names, and the guest record matching `payload.guestId`. Returns HTTP `404` if the booking is not found.
3. **Guest Association:** Confirms that the guest belongs to the booking. Returns HTTP `404` if no matching guest record exists.
4. **Paid Status Evaluation:** Evaluates `isPaid = guest.paidAt != null`.
5. **Inactive State Checks (Unpaid Only):** If the guest has **not** paid:
   - If `booking.status` is `"CANCELLED"` or `"CANCELLED_BY_OPERATOR"`, returns HTTP `410 Gone`.
   - If `guest.status` is `"CANCELLED"` or `"DECLINED"`, returns HTTP `409 Conflict`.
     _(If the guest has already paid, these cancellation checks are skipped so the guest can still review their completed checkout)._
6. **Host & Duration Fallbacks:** Resolves host name from `booking.user.firstName` and `lastName`, falling back to `"Host"`. Booking duration falls back to `60` minutes if falsy in the database.

### Request Example

```http
GET /api/payments/split/<signed-token> HTTP/1.1
Host: <your-workspace-host>
Cookie: __session=<session-token>
Accept: application/json
```

### Success Response (`200 OK`)

```json
{
  "valid": true,
  "payload": {
    "bookingId": "booking_cuid_12345678",
    "guestId": "guest_cuid_87654321",
    "email": "guest@example.com",
    "name": "Jordan Lee",
    "amount": 25.5,
    "currency": "USD",
    "venueName": "Downtown Central Workspace",
    "date": "2026-10-15",
    "time": "14:00",
    "expiresAt": 1792195200000
  },
  "isPaid": false,
  "venue": {
    "name": "Downtown Central Workspace",
    "address": "100 Market St, San Francisco, CA",
    "category": "coworking",
    "imageUrl": "https://images.example.com/venues/downtown-hub.jpg",
    "wifiSpeed": 250
  },
  "hostName": "Alex Rivera",
  "bookingDetails": {
    "date": "2026-10-15",
    "time": "14:00",
    "seatNumber": "Hot Desk 12",
    "duration": 120
  }
}
```

### Response Fields

- `valid` (`boolean`): Always `true` on successful verification.
- `payload` (`object`): The verified token payload.
- `isPaid` (`boolean`): Whether payment has been recorded (`paidAt != null`).
- `venue` (`object`): Selected venue details:
  - `name` (`string`): Venue name.
  - `address` (`string | null`): Venue street address.
  - `category` (`string`): Venue category.
  - `imageUrl` (`string | null`): Cover image URL.
  - `wifiSpeed` (`number | null`): Rated Wi-Fi speed in Mbps.
- `hostName` (`string`): Host full name, or `"Host"` fallback.
- `bookingDetails` (`object`):
  - `date` (`string`): Scheduled booking date.
  - `time` (`string`): Scheduled booking time.
  - `seatNumber` (`string | null`): Assigned seat or desk identifier.
  - `duration` (`number`): Booking duration in minutes (defaults to `60` if falsy).

### Error Responses

| Status Code                 | Reason                                                           | Response Body                                                          |
| :-------------------------- | :--------------------------------------------------------------- | :--------------------------------------------------------------------- |
| `400 Bad Request`           | Invalid token signature, malformed format, or token expired      | `{"error": "Invalid or expired payment link"}`                         |
| `404 Not Found`             | Booking does not exist                                           | `{"error": "Booking not found"}`                                       |
| `404 Not Found`             | Guest record does not exist on this booking                      | `{"error": "Invalid payment link"}`                                    |
| `409 Conflict`              | Unpaid guest invitation has status `DECLINED` or `CANCELLED`     | `{"error": "This invitation is no longer active."}`                    |
| `410 Gone`                  | Unpaid booking has status `CANCELLED` or `CANCELLED_BY_OPERATOR` | `{"error": "This booking was cancelled, so there is nothing to pay."}` |
| `500 Internal Server Error` | Database query or unhandled server error                         | `{"error": "Failed to load split payment details"}`                    |

---

## 8. POST `/api/payments/split/{token}`

Records payment state in WorkSphere's database using the verified token claims and unlocks their digital guest pass.

> [!NOTE]
> The handler does not read or parse a request body. All payment inputs are derived from the verified path token and current database state. Any request body supplied by the client is ignored.

### Path Parameters

| Parameter | Type     | Required | Description                                                       |
| :-------- | :------- | :------- | :---------------------------------------------------------------- |
| `token`   | `string` | Yes      | The dot-separated signed payment token (`<payload>.<signature>`). |

### Transactional Processing Sequence

The operation runs inside an atomic Prisma database transaction (`prisma.$transaction`):

1. **Token Verification:** Validates token signature and expiration. Returns HTTP `400` if invalid.
2. **Guest Verification:** Finds the `BookingGuest` record by `payload.guestId`.
   - If the guest does not exist or `guest.bookingId !== payload.bookingId`, returns outcome `invalid` -> HTTP `400`.
3. **Already-Paid Check:** If `guest.paidAt != null`, returns outcome `already_paid` -> HTTP `200` (`{"success": true, "message": "Already paid"}`).
4. **Cancellation Checks:**
   - If `booking.status` is `"CANCELLED"` or `"CANCELLED_BY_OPERATOR"`, returns outcome `booking_cancelled` -> HTTP `410`.
   - If `guest.status` is `"CANCELLED"` or `"DECLINED"`, returns outcome `guest_inactive` -> HTTP `409`.
5. **Conditional Atomic State Update:**
   Executes a compare-and-swap update via `tx.bookingGuest.updateMany`:
   ```typescript
   where: {
     id: guest.id,
     bookingId: payload.bookingId,
     paidAt: null,
     status: { notIn: ["CANCELLED", "DECLINED"] },
   },
   data: {
     status: "ACCEPTED",
     paidAt: new Date(),
     paidAmountCents: Math.round(payload.amount * 100),
     paidCurrency: payload.currency,
   }
   ```
   - If `marked.count !== 1`, the update matched 0 rows and the transaction returns outcome `already_paid` -> HTTP `200` (`{"success": true, "message": "Already paid"}`). As documented in the implementation, this occurs either because another concurrent request recorded payment, or because the guest was cancelled between the initial lookup and the conditional update. A failed conditional update does not prove that payment was already recorded.
6. **Post-Commit Event Dispatch:**
   Only the request that successfully records the payment attempts to emit the `booking:guest-rsvp` event on the application `eventBus`. Already-paid requests and losing concurrent submissions do not emit it. Event emission happens after the database transaction commits. Any failure during event emission is caught and logged, and does not fail the HTTP response or roll back the committed payment. The route does not implement a transactional outbox or provide retry guarantees for event delivery.
7. **Live Booking Data Pass Generation:** The digital guest pass is generated using **current booking data from the database** (handling cases where the booking was rescheduled after the token was issued).

### Request Example

```http
POST /api/payments/split/<signed-token> HTTP/1.1
Host: <your-workspace-host>
Cookie: __session=<session-token>
```

### Success Response (`200 OK` — New Payment)

Returned when the payment is successfully recorded for the first time:

```json
{
  "success": true,
  "message": "Guest Pass unlocked & payment confirmed!",
  "guestPass": {
    "passCode": "GP-1234-8765",
    "guestName": "Jordan Lee",
    "venueName": "Downtown Central Workspace",
    "date": "2026-10-15",
    "time": "14:00",
    "amountPaid": 25.5,
    "currency": "USD",
    "wifiAccessCode": "WorkSphere-HighSpeed-Guest",
    "accessLevel": "Full Coworking & Meeting Access"
  }
}
```

### Idempotent Response (`200 OK` — Already Paid)

Returned when the guest record already has `paidAt != null`:

```json
{
  "success": true,
  "message": "Already paid"
}
```

### Error Responses

| Status Code                 | Reason                                              | Response Body                                                    |
| :-------------------------- | :-------------------------------------------------- | :--------------------------------------------------------------- |
| `400 Bad Request`           | Invalid or expired token                            | `{"error": "Invalid or expired payment token"}`                  |
| `400 Bad Request`           | Guest not found or belongs to a different booking   | `{"error": "Invalid payment link"}`                              |
| `409 Conflict`              | Guest invitation is `DECLINED` or `CANCELLED`       | `{"error": "This invitation is no longer active."}`              |
| `410 Gone`                  | Booking is `CANCELLED` or `CANCELLED_BY_OPERATOR`   | `{"error": "This booking was cancelled, so no payment is due."}` |
| `500 Internal Server Error` | Database transaction failure or unhandled exception | `{"error": "Payment processing failed. Please try again."}`      |

---

## 9. RSVP Status vs. Payment Status

The `BookingGuest` model in `prisma/schema.prisma` explicitly decouples invitation response status from split-bill payment state:

```prisma
model BookingGuest {
  id              String      @id @default(cuid())
  bookingId       String
  status          GuestStatus @default(PENDING) // PENDING, SENT, FAILED, CANCELLED, ACCEPTED, DECLINED
  paidAt          DateTime?
  paidAmountCents Int?
  paidCurrency    String?
  // ...
}
```

- **`status === "ACCEPTED"` (RSVP Only):** Indicates that the guest confirmed attendance via the free invitation link. It does **not** signify that any monetary share has been collected.
- **`paidAt != null` (Paid State):** Indicates that payment has been recorded for this guest. A guest has paid if and only if `paidAt` is set.
- **State Convergence on Payment:** When `POST /api/payments/split/[token]` successfully executes, it updates `status` to `"ACCEPTED"` while simultaneously recording `paidAt`, `paidAmountCents`, and `paidCurrency`.
- **System Invariant:** Downstream clients and dashboards must never treat `status === "ACCEPTED"` as proof of payment.

---

## 10. Transactional and Idempotency Behavior

The split-payment recording flow enforces strict idempotency:

1. **Compare-and-Swap Filter:** The update requires `paidAt: null` and active status (`status: { notIn: ["CANCELLED", "DECLINED"] }`) in the `updateMany` criteria.
2. **Conditional Update Outcome (`marked.count !== 1`):** When `marked.count !== 1`, the route returns `{ "success": true, "message": "Already paid" }`. As documented in the implementation, this occurs either because:
   - Another concurrent request recorded payment, OR
   - The guest was cancelled between the initial lookup and conditional update.  
     A failed conditional update does not prove that payment was already recorded; it indicates that the guest record no longer satisfied the atomic update criteria.
3. **Event Emission Handling:** Only the request that successfully records the payment attempts to emit `booking:guest-rsvp`. Already-paid and losing concurrent requests do not emit it. Event emission happens after the database transaction commits, and any failures are caught and logged without affecting the committed payment. The system does not implement a transactional outbox or provide guaranteed delivery or retry mechanics for the event.

---

## 11. Guest Pass Response

The `guestPass` object returned upon successful payment provides the guest with access credentials:

| Field            | Source / Derivation                                                          | Description                                                                                                                 |
| :--------------- | :--------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------- |
| `passCode`       | `GP-${bookingId.slice(-4).toUpperCase()}-${guestId.slice(-4).toUpperCase()}` | Human-readable check-in code combining the last 4 characters of booking ID and guest ID.                                    |
| `guestName`      | `payload.name \|\| payload.email`                                            | Guest display name, falling back to the guest email.                                                                        |
| `venueName`      | Live database `booking.venue.name`                                           | Sourced from the database booking record (falls back to token `venueName`).                                                 |
| `date`           | Live database `booking.date`                                                 | Current scheduled booking date.                                                                                             |
| `time`           | Live database `booking.time`                                                 | Current scheduled booking start time.                                                                                       |
| `amountPaid`     | Verified token `payload.amount`                                              | Scalar amount recorded as paid.                                                                                             |
| `currency`       | Verified token `payload.currency`                                            | Currency code.                                                                                                              |
| `wifiAccessCode` | Static value: `"WorkSphere-HighSpeed-Guest"`                                 | Shared guest Wi-Fi access network key. _(Note: This is a static configuration value, not a unique per-booking credential)._ |
| `accessLevel`    | Static value: `"Full Coworking & Meeting Access"`                            | Granted workspace access tier.                                                                                              |

---

## 12. Security and Operational Notes

- **Access Control & Token Protection:** Access requires both an authenticated Clerk session and a valid, unexpired signed token; presenting a token alone is not sufficient to bypass edge authentication. Once authenticated, any user possessing a valid token can view checkout details and record payment state in WorkSphere's database using the verified token claims. Never expose split payment tokens in shared communication channels or public logs.
- **Production Secret Configuration:** Ensure `SPLIT_PAYMENT_SECRET` is set to a secure, randomly generated secret of at least 256 bits in production environments.
- **Signature Comparison:** The implementation checks signature-buffer lengths and uses `crypto.timingSafeEqual` to compare equal-length signature buffers.
- **Live Booking Synchronization:** Generating the guest pass from database records rather than token parameters ensures that host booking modifications (e.g. date changes or venue renames) are reflected immediately on the issued pass.

---

## 13. Related Documentation

- [Booking Guests API Reference](../BOOKINGS_GUESTS_API.md) — Guest invitation dispatch, RSVP endpoints, and PDF guest list generation.
- [WorkSphere API Reference](../API_REFERENCE.md) — High-level summary of all WorkSphere API routes.
- [API Documentation Index](./README.md) — Index of endpoint specifications and operational guides.
- [REST API Reference](../API.md) — Project-wide REST endpoints, schemas, and event streams.
