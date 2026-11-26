# Nomad Attendance Certificate Cryptographic Verification Flow

This document details the architectural lifecycle, PDF generation pipeline, cryptographic proof generation, public verification endpoint, and operational troubleshooting for WorkSphere's Nomad Attendance Certificates.

---

## 1. Overview and Architecture

Nomad Attendance Certificates serve as an official, tamper-evident record of physical co-working attendance across the WorkSphere network. The lifecycle spans stay completion, on-demand issuance, cryptographic hash generation, vector PDF rendering, and public QR verification.

```
+--------------------------------------------------------------------------------------------------+
| 1. Issuance Trigger                                                                              |
|    - User requests certificate via GET /api/bookings/:bookingId/certificate                      |
|    - Client modal preview via <NomadCertificateModal /> or <NomadPassportCertificate />          |
+--------------------------------------------------------------------------------------------------+
                                             |
                                             v
+--------------------------------------------------------------------------------------------------+
| 2. Stay Validation & Record Retrieval                                                            |
|    - Query Prisma DB: booking by ID or confirmationId, including user and venue data             |
|    - Authorization check: authenticated Clerk userId matches booking.userId                      |
|    - Status assertion: rejects CANCELLED, CANCELLED_BY_OPERATOR, or PENDING                      |
|    - Derive check-in (date + time) and check-out (check-in + durationMinutes)                    |
+--------------------------------------------------------------------------------------------------+
                                             |
                                             v
+--------------------------------------------------------------------------------------------------+
| 3. Cryptographic Proof Computation                                                               |
|    - Deterministic ID: WS-CERT-<CLEAN_SEED>                                                      |
|    - HMAC-SHA256 digest over formatted payload string using server secret                        |
|    - Signature fallback / pre-signed override support                                            |
+--------------------------------------------------------------------------------------------------+
                                             |
                                             v
+--------------------------------------------------------------------------------------------------+
| 4. PDF Generation Pipeline                                                                       |
|    - Build canonical verification URL: /api/certificates/verify?id=<id>&hash=<32-char prefix>    |
|    - Generate ISO/IEC 18004 2D boolean QR code matrix via lib/qr/svgQr                           |
|    - Render A4 PDF document via pdf-lib with standard WinAnsi fonts                              |
|    - Stream PDF buffer to client as attachment                                                   |
+--------------------------------------------------------------------------------------------------+
                                             |
                                             v
+--------------------------------------------------------------------------------------------------+
| 5. Public Verification (/api/certificates/verify)                                                |
|    - Scanned QR code sends GET request with id and hash query parameters                         |
|    - Resolves booking & venue record from database                                               |
|    - Recomputes expected HMAC-SHA256 from database facts                                         |
|    - Performs prefix match comparison                                                            |
|    - Returns sanitized privacy payload (masked surname, verified dates, status)                  |
+--------------------------------------------------------------------------------------------------+
```

### Implemented vs. Proposed Capabilities

| Area | Implemented Status | Notes & Scope |
| :--- | :--- | :--- |
| **Tamper Detection** | Implemented | Server computes HMAC-SHA256 over stay facts using symmetric secret. |
| **Asymmetric Digital Signatures** | Supported in interfaces, HMAC used by default | `AttendanceStayDetails.signature` and `AttendanceCertificateOptions.algorithm` accept pre-signed keys (`RSA-SHA256`), but the default pipeline produces an HMAC-SHA256 hexadecimal digest. |
| **Storage & Persistence** | Computed On-Demand (Stateless) | Certificates and hashes are recomputed dynamically from booking records upon download and verification; hashes are not stored as dedicated ledger records in the database. |
| **Delivery Mechanism** | Direct HTTP Stream | Downloaded as binary `application/pdf` attachment via `Content-Disposition`. No persistent S3/cloud blob storage is used for certificate PDFs. |
| **Privacy Protection** | Implemented | Verification endpoint masks user surnames (`Sarah Connor` $\rightarrow$ `Sarah C.`) and omits email/contact PII. |

---

## 2. PDF Generation Pipeline and Layout

The PDF generation engine is implemented in [src/lib/pdf/generateCertificate.ts](file:///C:/Users/Saransh%20Kashyap/WorkSphere-9868-worktree/src/lib/pdf/generateCertificate.ts) using `pdf-lib`.

### 2.1 Document Dimensions and Coordinate Space

- **Page Standard:** ISO 216 / DIN A4 Portrait.
- **Dimensions:** Width `595.28 pt`, Height `841.89 pt` (72 PostScript points per inch).
- **Coordinate Origin:** Bottom-left `(0, 0)`.
- **Global Outer Margin:** `48 pt` on all sides. Content width: `499.28 pt` ($595.28 - 2 \times 48$).

### 2.2 Layout Geometry & Visual Structure

```
(0, 841.89) -------------------------------------------------------------------+
|                                                                               |
|   (36, 805.89)  [Outer Card Border: x=36, y=36, w=523.28, h=769.89]           |
|   +-----------------------------------------------------------------------+   |
|   | [Accent Band: h=6, color=#1f6be0]                                     |   |
|   | WORKSPHERE GLOBAL NOMAD NETWORK                   +---------------+   |   |
|   | Nomad Attendance Certificate                      | QR Code       |   |   |
|   | Official Record of Verified Co-Working Stay       | 78 x 78 pt    |   |   |
|   |                                                   | Scan to Verify|   |   |
|   | [Certificate ID & Booking Ref Badge: h=40]        +---------------+   |   |
|   |                                                                       |   |
|   | -------------------------------------------------------------------   |   |
|   | VERIFIED NOMAD: Nomad Full Name (e.g., Alex Rivera)                   |   |
|   |                                                                       |   |
|   | -------------------------------------------------------------------   |   |
|   | ATTENDANCE & STAY DETAILS [Box: h=115]                                |   |
|   |   Venue Name:           The Work Collective Lisbon                    |   |
|   |   Venue Address:        Rua do Alecrim 45...                          |   |
|   |   Verified Check-in:    2026-11-20 09:00 (Europe/Lisbon)              |   |
|   |   Verified Check-out:   2026-11-20 17:30 (Europe/Lisbon)              |   |
|   |   Total Stay Duration:  8 hrs 30 mins                                 |   |
|   |                                                                       |   |
|   | -------------------------------------------------------------------   |   |
|   | CRYPTOGRAPHIC EVIDENCE & TAMPER PROTECTION [Box: h=65]                |   |
|   |   Signature / Digest:   <64-hex HMAC-SHA256 digest>                   |   |
|   |   Online Verify Route:  https://worksphere.app/api/certificates/...    |   |
|   |                                                                       |   |
|   | [LEGAL NOTICE & SCOPE OF EVIDENCE Box: h=48]                          |   |
|   | -------------------------------------------------------------------   |   |
|   | Footer: WorkSphere Global Coworking Network · Verified Attendance...   |   |
|   +-----------------------------------------------------------------------+   |
|                                                                               |
(0, 0) -------------------------------------------------------------------------+
```

### 2.3 Color Palette Constants

| Semantic Element | Hex / RGB Representation | Role |
| :--- | :--- | :--- |
| `primaryBlue` | `#1f6be0` (`rgb(0.12, 0.42, 0.88)`) | Accent header band, section headers, brand marks, duration highlight |
| `darkNavy` | `#0f172a` (`rgb(0.06, 0.09, 0.16)`) | Main title, primary values, QR modules |
| `slateGrey` | `#64748b` (`rgb(0.39, 0.45, 0.55)`) | Subtitles, labels, footer notes, metadata captions |
| `cardBorder` | `#e0e8f0` (`rgb(0.88, 0.91, 0.94)`) | Dividers, bounding boxes, card frames |
| `lightBg` | `#f7fafd` (`rgb(0.97, 0.98, 1.0)`) | Badge containers, stay detail box fill |

### 2.4 Vector QR Code Embedding

- **Generator:** `generateQRMatrix` in `src/lib/qr/svgQr.ts` (pure TypeScript ISO/IEC 18004 implementation, Error Correction Level M).
- **Position & Dimensions:** `qrSize = 78 pt`, placed at `x = width - margin - qrSize = 469.28 pt`, `y = height - margin - 110 = 683.89 pt`.
- **Rendering Mechanism:** `drawVectorQr` renders direct vector rectangles via `page.drawRectangle` with an expansion offset of `+0.1 pt` to prevent anti-aliasing gaps between modules. No raster image conversion or canvas dependency is required.
- **Caption:** Bounding box (`w = 86 pt, h = 12 pt`) with text `"Scan to Verify"` positioned at `qrY - 10 pt`.

### 2.5 Font Embedding and Character Sanitization

- **Fonts:** Standard Type 1 embedded fonts (`StandardFonts.Helvetica`, `StandardFonts.HelveticaBold`, and `StandardFonts.HelveticaOblique`).
- **Font Fallback & Encoding Limitation:** Standard Type 1 fonts in PDF specifications utilize `WinAnsiEncoding` (code page 1252), which does not support full UTF-8, extended Cyrillic, Greek, or Asian scripts.
- **Sanitization Helper (`drawSafeText`):**
  ```typescript
  const sanitized = text.replace(/[^\x20-\x7E\xA0-\xFF]/g, " ").trim();
  ```
  Any glyph outside `[\x20-\x7E]` and `[\xA0-\xFF]` is replaced with a single space to avoid runtime `WinAnsi cannot encode` PDF generation crashes when rendering international names or venues.

---

## 3. Cryptographic Payload Structure

### 3.1 Hash Implementation: HMAC-SHA256 vs. Digital Signature

> [!IMPORTANT]
> The default WorkSphere verification mechanism uses an **HMAC-SHA256** keyed cryptographic hash, **not** an asymmetric digital signature (such as ECDSA or RSA). While interfaces allow pre-signed signatures (`signature?: string`), the internal generation produces a keyed message authentication code.

- **Primitive:** Node.js `crypto.createHmac("sha256", secret)`
- **Secret Selection:** `process.env.CERTIFICATE_VERIFICATION_SECRET || process.env.RECEIPT_VERIFICATION_SECRET || "worksphere-certificate-tamper-key"`
- **Digest Output:** 64-character lowercase hexadecimal string.

### 3.2 Canonicalization and Signed Data Format

The hash preimage is constructed strictly as a colon-delimited string of 6 components:

$$\text{Preimage} = \text{certificateId} : \text{bookingId} : \text{nomadName} : \text{venueName} : \text{checkInIso} : \text{checkOutIso}$$

#### Field Serialization Rules

1. `certificateId`: Deterministic ID formatted as `WS-CERT-<CLEAN_SEED>`, where `CLEAN_SEED` is derived from `confirmationId || bookingId` stripped of all non-alphanumeric characters, uppercased, and sliced to 16 characters.
2. `bookingId`: Exact string identifier (trimmed).
3. `nomadName`: Nomad full display name (trimmed).
4. `venueName`: Venue name (trimmed).
5. `checkInIso`: Check-in timestamp normalized to strict ISO 8601 UTC string (`Date.toISOString()`), e.g., `"2026-11-20T09:00:00.000Z"`.
6. `checkOutIso`: Check-out timestamp normalized to strict ISO 8601 UTC string (`Date.toISOString()`), e.g., `"2026-11-20T17:30:00.000Z"`.

**Example Preimage:**
```
WS-CERT-WSCONF7788:cl_sample_booking_123:Alex Rivera:The Work Collective Lisbon:2026-11-20T09:00:00.000Z:2026-11-20T17:30:00.000Z
```

### 3.3 Verification URL and QR Payload

The QR code encodes a URL referencing the canonical verification endpoint:

```
https://worksphere.app/api/certificates/verify?id=<certificateId>&hash=<hashPrefix>
```

- **Query Parameters:**
  - `id`: The certificate identifier (`certificateId`), e.g., `WS-CERT-WSCONF7788`.
  - `hash`: The first 32 characters (`signature.slice(0, 32)`) of the hexadecimal HMAC-SHA256 digest. Truncating to 32 characters (128 bits) preserves QR module density while maintaining collision resistance for URL query strings.
- **Base URL Resolution:**
  - In PDF generation options: `options.baseUrl` (defaults to `https://worksphere.app`).
  - In the booking API route: extracted dynamically from incoming request headers (`x-forwarded-host` or `host` prefixed with `x-forwarded-proto`).

---

## 4. Verification API Specification

### Endpoint: `GET /api/certificates/verify`

Public endpoint intended for browsers, QR scanners, and third parties to verify the validity of an attendance certificate.

- **Method:** `GET`
- **Route Handler:** [src/app/api/certificates/verify/route.ts](file:///C:/Users/Saransh%20Kashyap/WorkSphere-9868-worktree/src/app/api/certificates/verify/route.ts)
- **Runtime Mode:** `force-dynamic`
- **Authentication:** Public (no auth headers or session tokens required).

### 4.1 Query Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | **Yes** | Certificate ID (e.g., `WS-CERT-WSCONF7788` or `WS-CERT-B123`). |
| `hash` | `string` | **Yes** | 32-character prefix or full 64-character HMAC-SHA256 hex digest. |

### 4.2 HTTP Status Codes and Error Responses

#### 400 Bad Request — Missing Parameters
Returned when either `id` or `hash` is missing from the query string.
```json
{
  "valid": false,
  "status": "INVALID",
  "error": "Missing required verification parameters (id and hash)"
}
```

#### 404 Not Found — Record Not Found
Returned when no booking matches the extracted seed (neither by `confirmationId` nor by `id`).
```json
{
  "valid": false,
  "status": "NOT_FOUND",
  "error": "No attendance record found matching certificate identifier."
}
```

#### 410 Gone — Stay Revoked / Cancelled
Returned when the database record indicates the booking was cancelled (`CANCELLED` or `CANCELLED_BY_OPERATOR`).
```json
{
  "valid": false,
  "status": "REVOKED",
  "error": "This stay certificate has been cancelled or revoked.",
  "certificateId": "WS-CERT-9876"
}
```

#### 400 Bad Request — Cryptographic Mismatch / Tampered
Returned when the computed hash over database stay facts does not match the provided query hash.
```json
{
  "valid": false,
  "status": "TAMPERED",
  "error": "Cryptographic signature mismatch. Certificate may have been tampered with.",
  "certificateId": "WS-CERT-9876"
}
```

#### 500 Internal Server Error
Returned upon unexpected database or runtime exceptions.
```json
{
  "valid": false,
  "status": "ERROR",
  "error": "Internal server error during certificate verification"
}
```

### 4.3 200 OK — Successful Verification

Returned when the certificate identifier is found, the stay is active/completed, and the cryptographic hash matches the database facts.

```json
{
  "valid": true,
  "status": "VERIFIED",
  "certificateId": "WS-CERT-9876",
  "nomadName": "Sarah C.",
  "venueName": "Manhattan Nomad Hub",
  "stayDate": "2026-11-20",
  "durationMinutes": 180,
  "checkInTime": "2026-11-20T09:30:00.000Z",
  "checkOutTime": "2026-11-20T12:30:00.000Z",
  "timeZone": "America/New_York",
  "verifiedAt": "2026-11-24T07:58:12.345Z"
}
```

> [!NOTE]
> **Privacy Masking:** The returned `nomadName` masks the last name to its initial (e.g., `Sarah Connor` becomes `Sarah C.`), preventing public exposure of personal identifiable information (PII) to arbitrary QR scanners.

---

## 5. Verification Flow & Security Analysis

```
Client / Scanner                   Verify API Route                       Prisma Database
      |                                   |                                      |
      |--- GET /api/certificates/verify ->|                                      |
      |    (?id=...&hash=...)             |                                      |
      |                                   |--- findFirst(booking OR seed) ------>|
      |                                   |<-- booking + venue + user record ---|
      |                                   |                                      |
      |                                   |-- If !booking -> 404 NOT_FOUND       |
      |                                   |-- If cancelled -> 410 REVOKED        |
      |                                   |                                      |
      |                                   |-- computeAttendanceCertificateHash() |
      |                                   |   (using DB facts + server secret)   |
      |                                   |                                      |
      |                                   |-- Compare expected vs provided hash  |
      |                                   |-- If mismatch -> 400 TAMPERED        |
      |                                   |                                      |
      |<-- 200 OK (VERIFIED + masked) ----|                                      |
```

### 5.1 Verification Mechanisms

1. **Seed Extraction:** The API strips the `WS-CERT-` prefix from the `id` parameter:
   ```typescript
   const seed = certificateId.replace(/^WS-CERT-/i, "");
   ```
2. **Database Lookup:** Looks up the booking in Prisma using an insensitive query matching `confirmationId` or `id`.
3. **Status Check:** Explicitly checks for `CANCELLED` or `CANCELLED_BY_OPERATOR`.
4. **Fact Recomputation:** Recomputes the expected hash using:
   - `booking.date` and `booking.time` combined as ISO string.
   - `booking.duration` (defaulting to 120 minutes if null).
   - Reconstructed check-out: `checkInDate.getTime() + durationMinutes * 60000`.
   - Nomad full name from user record: `${user.firstName} ${user.lastName}`.
   - Venue name from venue record.
5. **Hash Matching:** Compares either the full hash or the 32-character prefix:
   ```typescript
   const hashMatch =
     expectedHash.startsWith(providedHash.toLowerCase()) ||
     providedHash.toLowerCase().startsWith(expectedHash.slice(0, 32));
   ```

### 5.2 Security Properties and Limitations

| Security Property | Actual Implementation Reality |
| :--- | :--- |
| **Authenticity & Integrity** | **Symmetric Keyed Protection:** Tampering with certificate fields (e.g. altering attendee name or check-in hours) invalidates the hash unless the attacker possesses `CERTIFICATE_VERIFICATION_SECRET`. |
| **Offline Verification** | **Not Supported:** The QR code verification URL directs to the server API, which validates against the Prisma database. Offline verification cannot confirm authenticity without exposing the symmetric secret. |
| **Non-Repudiation** | **Limited:** Because HMAC relies on a symmetric shared secret known to the server, it provides proof of origin from the server but does not provide cryptographic non-repudiation in the legal sense of a public-key digital signature. |
| **Replay & Expiry** | Certificates do not have an independent cryptographic expiration timestamp; validity is tied directly to the lifecycle status of the database booking record. |

---

## 6. Developer Troubleshooting Checklist

Use this checklist to diagnose issues across certificate generation and verification:

- [ ] **PDF Generation Fails with WinAnsi Error:**
  - *Cause:* Non-ASCII / Unicode characters (e.g., emojis, accented letters, non-Latin scripts) passed into standard Helvetica font.
  - *Solution:* Verify `drawSafeText` or sanitize input strings using `.replace(/[^\x20-\x7E\xA0-\xFF]/g, " ")`.
- [ ] **Check-Out Timestamp Earlier Than Check-In:**
  - *Cause:* Invalid duration or malformed date strings in booking record.
  - *Solution:* Ensure check-in and check-out parse to valid dates and `checkOutTime >= checkInTime`. `validateAttendanceData` throws an explicit error if inverted.
- [ ] **Hash Mismatch (`TAMPERED` Status on API):**
  - *Cause:* Difference between parameters passed during PDF generation vs. database values retrieved during verification. Common discrepancies include:
    - Trailing spaces in `nomadName` or `venueName`.
    - Date format differences: `ISO 8601` UTC strings (`Z` suffix) must match exactly.
    - Secret mismatch: Ensure `CERTIFICATE_VERIFICATION_SECRET` matches across environments.
- [ ] **QR Code Scanning Fails to Open URL:**
  - *Cause:* Incorrect `baseUrl` passed during generation (e.g. defaulting to `localhost:3000` or invalid host header).
  - *Solution:* Ensure reverse proxy forwards `x-forwarded-host` and `x-forwarded-proto`.
- [ ] **Certificate API Returns 404 NOT_FOUND:**
  - *Cause:* Certificate ID seed does not match `booking.confirmationId` or `booking.id`.
  - *Solution:* Check if `generateCertificateId` sanitization stripped essential characters needed to locate the database record.
- [ ] **Certificate API Returns 410 REVOKED:**
  - *Cause:* Booking status in database was updated to `CANCELLED` or `CANCELLED_BY_OPERATOR`.
  - *Solution:* This is expected behavior for cancelled bookings. Attendance certificates cannot be generated or verified for revoked stays.
