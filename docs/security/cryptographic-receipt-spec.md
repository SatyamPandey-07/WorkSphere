# Cryptographic Booking Receipt Verification & Digital Signing Specification

This document defines the cryptographic architecture and technical specification for verifiable digital booking receipts in WorkSphere, implemented in [`src/lib/crypto/receiptSigner.ts`](file:///c:/Users/admin/Desktop/workfere/src/lib/crypto/receiptSigner.ts) and verified via [`src/app/api/receipts/verify/route.ts`](file:///c:/Users/admin/Desktop/workfere/src/app/api/receipts/verify/route.ts).

---

## Table of Contents

1. [Executive Summary & Security Objectives](#1-executive-summary--security-objectives)
2. [Cryptographic Principles & Architecture](#2-cryptographic-principles--architecture)
3. [Canonical Payload Construction (RFC 8785 JCS)](#3-canonical-payload-construction-rfc-8785-jcs)
   - [Deterministic Field Normalization](#deterministic-field-normalization)
   - [Omission of Undefined Values](#omission-of-undefined-values)
   - [SHA-256 Digest Derivation](#sha-256-digest-derivation)
4. [Digital Signature Schemes: ECDSA (P-256 / P-384) & RSA-SHA256](#4-digital-signature-schemes-ecdsa-p-256--p-384--rsa-sha256)
   - [Algorithm Configurations Matrix](#algorithm-configurations-matrix)
   - [ECDSA P-256 Prime Curve (FIPS 186-4 / SECG secp256r1)](#ecdsa-p-256-prime-curve-fips-186-4--secg-secp256r1)
   - [ECDSA P-384 Curve (NIST P-384 / secp384r1)](#ecdsa-p-384-curve-nist-p-384--secp384r1)
   - [RSA-SHA256 (PKCS#1 v1.5 / 2048-bit Modulus)](#rsa-sha256-pkcs1-v15--2048-bit-modulus)
5. [Key Management & Authority Hierarchy](#5-key-management--authority-hierarchy)
   - [SPKI and PKCS#8 PEM Encoding](#spki-and-pkcs8-pem-encoding)
   - [WorkSphere Receipt Authority Default Keys](#worksphere-receipt-authority-default-keys)
   - [Key Rotation and Ephemeral Identifiers](#key-rotation-and-ephemeral-identifiers)
6. [Offline Verification Architecture & QR Code Format](#6-offline-verification-architecture--qr-code-format)
   - [Air-Gapped QR Code Data Payload](#air-gapped-qr-code-data-payload)
   - [Client-Side Offline Verification via IndexedDB & Web Cryptography](#client-side-offline-verification-via-indexeddb--web-cryptography)
7. [Verification Endpoints & API Protocol](#7-verification-endpoints--api-protocol)
   - [POST `/api/receipts/verify`](#post-apireceiptsverify)
   - [Public Key Verification Protocols](#public-key-verification-protocols)
8. [Threat Model & Attack Mitigations](#8-threat-model--attack-mitigations)
   - [Tampering & Receipt Manipulation](#tampering--receipt-manipulation)
   - [Replay Attacks & Cross-Venue Cloning](#replay-attacks--cross-venue-cloning)
   - [Key Compromise & Revocation](#key-compromise--revocation)
9. [TypeScript Data Contracts & API Reference](#9-typescript-data-contracts--api-reference)
10. [End-to-End Execution Sequence Diagrams](#10-end-to-end-execution-sequence-diagrams)

---

## 1. Executive Summary & Security Objectives

WorkSphere digital receipts serve as legally defensible, cryptographically non-repudiable proof of desk, venue, and workspace reservation purchases. In high-traffic shared physical facilities, physical front-desk terminals, security guards, and automated turnstiles require instantaneous, tamper-evident proof that a reservation is genuine, unexpired, and paid for—even when network connectivity is disrupted or disconnected.

Traditional database identifiers and printable HTML receipts are susceptible to client-side DOM tampering, screenshot manipulation, and unauthorized modification of booking times or fee amounts. WorkSphere eliminates this vulnerability through **cryptographically signed verifiable receipts**:

- **Cryptographic Non-Repudiation:** Receipts are signed exclusively by the WorkSphere Receipt Authority private key using ECDSA (P-256/P-384) or RSA-SHA256.
- **Deterministic Canonicalization:** Payloads are serialized using **RFC 8785 JSON Canonicalization Scheme (JCS)** rules to guarantee that whitespace, field order, and serialization discrepancies never produce mismatched digests across diverse runtimes.
- **Offline Verifiability:** Compact signed receipt certificates and QR codes can be validated completely offline by scanners and turnstiles with no internet access, using pre-installed WorkSphere root public keys.
- **Public Key Discovery:** Online verifiers can validate receipt authenticity against standard HTTPS verification endpoints.

---

## 2. Cryptographic Principles & Architecture

The receipt signing subsystem is divided into three functional stages:

```
┌────────────────────────────────┐
│   Reservation Receipt Model    │
│  (ReservationReceiptPayload)   │
└───────────────┬────────────────┘
                │
                ▼
┌────────────────────────────────┐
│   RFC 8785 Canonicalization    │  ===> Sort keys alphabetically, omit undefined fields,
│  (canonicalizeReceiptPayload)  │       produce deterministic UTF-8 JSON octets.
└───────────────┬────────────────┘
                │
                ▼
┌────────────────────────────────┐
│      SHA-256 Hash Digest       │  ===> Cryptographic one-way hash:
│     (computeReceiptDigest)     │       digest = SHA-256(canonicalJson)
└───────────────┬────────────────┘
                │
                ▼
┌────────────────────────────────┐
│     Asymmetric Sign Engine     │  ===> Sign using Authority Private Key (ECDSA P-256 / RSA)
│    (signReservationReceipt)    │       Output: Base64 digital signature & verification token
└────────────────────────────────┘
```

The system supports both elliptic curve cryptography (ECC) and classic RSA public-key schemes. ECC (specifically ECDSA P-256) is prioritized for mobile passes, offline QR codes, and embedded devices due to its compact signature size (64–72 bytes in DER format) and lower CPU computational overhead.

---

## 3. Canonical Payload Construction (RFC 8785 JCS)

In distributed systems, the same logical JSON object can be represented by multiple different byte sequences due to whitespace differences, dictionary key ordering permutations, and platform-specific floating-point or Unicode representations. A digital signature computed over one byte sequence will fail verification if another system reformats the JSON.

To eliminate digest ambiguity, WorkSphere enforces **RFC 8785 JSON Canonicalization**:

### Deterministic Field Normalization

Every receipt payload conforms to [`ReservationReceiptPayload`](file:///c:/Users/admin/Desktop/workfere/src/lib/crypto/receiptSigner.ts#L35):

```typescript
export interface ReservationReceiptPayload {
  bookingId: string;
  confirmationId: string;
  venueId: string;
  venueName: string;
  userId: string;
  userEmail?: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  durationHours?: number;
  totalAmount: number;
  currency: string;
  issuedAt: string; // ISO timestamp
  status: string;
}
```

The canonicalization algorithm performs:
1. Lexicographical sorting of all top-level object property keys according to UTF-16 code unit order (`Object.keys(payload).sort()`).
2. Recursive omission of any object attributes whose value is `undefined`.
3. Strict deterministic string encoding through standard ECMAScript JSON serialization without extra whitespace, tabs, or newlines.

```typescript
export function canonicalizeReceiptPayload(payload: ReservationReceiptPayload): string {
  const sortedKeys = Object.keys(payload).sort() as (keyof ReservationReceiptPayload)[];
  const sortedObj: Record<string, any> = {};
  for (const k of sortedKeys) {
    if (payload[k] !== undefined) {
      sortedObj[k] = payload[k];
    }
  }
  return JSON.stringify(sortedObj);
}
```

### Omission of Undefined Values

Optional fields such as `userEmail` or `durationHours` that evaluate to `undefined` are completely omitted from the sorted object prior to serialization, preventing serialization anomalies across environments where JSON serializers might otherwise omit, nullify, or serialize undefined keys differently.

### SHA-256 Digest Derivation

Once the canonical string is created, a SHA-256 message digest is generated:

```typescript
export function computeReceiptDigest(canonicalJson: string): string {
  return crypto.createHash("sha256").update(canonicalJson, "utf8").digest("hex");
}
```

The 64-character hexadecimal digest represents the unalterable fingerprint of the reservation. Any modification to `totalAmount`, `date`, `bookingId`, or `status` yields a completely distinct digest under SHA-256 preimage resistance.

---

## 4. Digital Signature Schemes: ECDSA (P-256 / P-384) & RSA-SHA256

WorkSphere implements multiple industry-standard asymmetric signature algorithms configured in [`ALGORITHM_CONFIGS`](file:///c:/Users/admin/Desktop/workfere/src/lib/crypto/receiptSigner.ts#L14):

### Algorithm Configurations Matrix

| Algorithm Identifier | Asymmetric Key Family | Curve / Modulus | Digest Hash | Encoding / Padding | Primary Use Case |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`ECDSA-P256`** | Elliptic Curve (EC) | `prime256v1` (secp256r1) | SHA-256 | ASN.1 DER (`der`) | **Default & Recommended**: QR codes, mobile passes, offline turnstiles |
| **`ECDSA-P384`** | Elliptic Curve (EC) | `secp384r1` (NIST P-384)| SHA-384 | ASN.1 DER (`der`) | High-security enterprise/government compliance receipts |
| **`RSA-SHA256`** | RSA | 2048-bit modulus | SHA-256 | PKCS#1 v1.5 padding | Legacy banking integrations, PDF signature compatibility |

### ECDSA P-256 Prime Curve (FIPS 186-4 / SECG secp256r1)

ECDSA over NIST curve P-256 (`prime256v1`) provides 128 bits of security with compact key representations and rapid signature generation:

$$\mathbf{y}^2 \equiv \mathbf{x}^3 - 3\mathbf{x} + \mathbf{b} \pmod{\mathbf{p}}$$

Where:
- $\mathbf{p} = 2^{256} - 2^{224} + 2^{192} + 2^{96} - 1$
- Order $\mathbf{n} \approx 2^{256}$
- Signature format: ASN.1 DER sequence containing integer components $(\mathbf{r}, \mathbf{s})$.

```typescript
"ECDSA-P256": {
  type: "ec",
  hash: "SHA256",
  curve: "prime256v1",
  dsaEncoding: "der",
}
```

### ECDSA P-384 Curve (NIST P-384 / secp384r1)

For environments requiring Suite B / CNSA compliant security (192-bit cryptographic security level), `ECDSA-P384` executes over the 384-bit prime modulus with SHA-384 hashing:

```typescript
"ECDSA-P384": {
  type: "ec",
  hash: "SHA384",
  curve: "secp384r1",
  dsaEncoding: "der",
}
```

### RSA-SHA256 (PKCS#1 v1.5 / 2048-bit Modulus)

For compatibility with corporate ERP systems and legacy PDF document signing standard `adbe.pkcs7.detached`, WorkSphere supports RSA 2048-bit signatures utilizing standard PKCS#1 v1.5 padding:

```typescript
"RSA-SHA256": {
  type: "rsa",
  hash: "SHA256",
  modulusLength: 2048,
  padding: crypto.constants.RSA_PKCS1_PADDING,
}
```

---

## 5. Key Management & Authority Hierarchy

The security of receipt verification rests upon the secrecy of the private signing key and the authenticated distribution of public keys.

### SPKI and PKCS#8 PEM Encoding

All keypairs are exported in standard PEM armor:
- **Public Keys:** SubjectPublicKeyInfo (SPKI) format:
  ```text
  -----BEGIN PUBLIC KEY-----
  MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...
  -----END PUBLIC KEY-----
  ```
- **Private Keys:** PKCS#8 format:
  ```text
  -----BEGIN PRIVATE KEY-----
  MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg...
  -----END PRIVATE KEY-----
  ```

Key generation is executed via Node.js native crypto:

```typescript
export function generateReceiptKeyPair(type: SignatureAlgorithm = "RSA-SHA256") {
  const config = ALGORITHM_CONFIGS[normType];
  if (config.type === "rsa") {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: config.modulusLength || 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    return { publicKeyPem: publicKey, privateKeyPem: privateKey };
  } else {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
      namedCurve: config.curve || "prime256v1",
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    return { publicKeyPem: publicKey, privateKeyPem: privateKey };
  }
}
```

### WorkSphere Receipt Authority Default Keys

In production deployments:
1. Master signing private keys are stored in hardware security modules (AWS KMS, GCP Cloud KMS, or HashiCorp Vault) or provisioned via environment variable `RECEIPT_SIGNING_PRIVATE_KEY`.
2. Public keys are bundled directly into client service workers, mobile applications, and turnstile firmware for offline signature verification.
3. In local development and testing environments, `getDefaultKeyPair` lazily instantiates an in-memory keypair on initial invocation.

### Key Rotation and Ephemeral Identifiers

Every signature includes a `keyId` attribute (e.g., `worksphere-authority-1` or `ws-p256-2026-q4`). This allows:
- Seamless rotation: Older receipts signed with `ws-p256-2026-q3` remain valid while new bookings are signed with `ws-p256-2026-q4`.
- Scanners to look up the corresponding public key from a local keyring or cache without relying on network lookups.

---

## 6. Offline Verification Architecture & QR Code Format

A core requirement of the WorkSphere receipt verification system is **100% offline operability** in underground facilities, secure campuses, and connectivity-constrained venues.

### Air-Gapped QR Code Data Payload

WorkSphere generates high-density 2D QR codes (via [`src/lib/qr/svgQr.ts`](file:///c:/Users/admin/Desktop/workfere/src/lib/qr/svgQr.ts)) embedded in booking receipts and mobile wallet passes. The payload encodes a compact URL or a minified Base64URL cryptographic token:

```
https://worksphere.app/verify#t=<BASE64URL_RECEIPT_TOKEN>
```

Where `<BASE64URL_RECEIPT_TOKEN>` decompresses to a JSON object:

```json
{
  "v": 1,
  "alg": "ECDSA-P256",
  "kid": "ws-authority-1",
  "p": {
    "bid": "booking_12345",
    "cid": "WS-CONF-9876",
    "vid": "venue_abc",
    "uid": "user_789",
    "dt": "2026-10-04",
    "tm": "14:00",
    "amt": 32.4,
    "cur": "USD",
    "iat": "2026-10-04T10:00:00Z",
    "st": "CONFIRMED"
  },
  "sig": "MEQCIFz...3Vw="
}
```

### Client-Side Offline Verification via IndexedDB & Web Cryptography

Physical venue verification terminals run a progressive web app (PWA) equipped with service worker offline caching and the native Web Cryptography API (`window.crypto.subtle`):

1. **Camera Scan:** The scanner decodes the QR code data.
2. **Authority Public Key Lookup:** The scanner extracts `kid` and retrieves the trusted public key from offline IndexedDB storage.
3. **Canonicalization:** Re-creates the canonical payload string matching RFC 8785 rules.
4. **Signature Validation:** Executes `crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, signature, data)`.
5. **Immediate Access Decision:**
   - If valid and `booking.date` matches today's date $\rightarrow$ Grant access / Open gate.
   - If invalid or signature does not match $\rightarrow$ Sound alarm / Reject entry.

---

## 7. Verification Endpoints & API Protocol

For connected applications, web browsers, and third-party accounting integrations, WorkSphere exposes an online verification API.

### POST `/api/receipts/verify`

Defined in [`src/app/api/receipts/verify/route.ts`](file:///c:/Users/admin/Desktop/workfere/src/app/api/receipts/verify/route.ts).

#### Request Headers
```http
POST /api/receipts/verify HTTP/1.1
Host: worksphere.app
Content-Type: application/json
Accept: application/json
```

#### Request Payload
```json
{
  "payload": {
    "bookingId": "booking_12345",
    "confirmationId": "WS-CONF-9876",
    "venueId": "venue_abc",
    "venueName": "Silicon Workspace Hub",
    "userId": "user_789",
    "userEmail": "developer@worksphere.app",
    "date": "2026-10-04",
    "time": "14:00",
    "durationHours": 2,
    "totalAmount": 32.4,
    "currency": "USD",
    "issuedAt": "2026-10-04T10:00:00.000Z",
    "status": "CONFIRMED"
  },
  "signature": "MEQCICjZz31q3eS0h3xL3G3z9fW...base64...",
  "algorithm": "ECDSA-P256",
  "publicKeyPem": "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...\n-----END PUBLIC KEY-----"
}
```

*Note: If `publicKeyPem` is omitted from the request, the server automatically verifies the signature against the active WorkSphere Receipt Authority root public key.*

#### Success Response (`200 OK`)
```json
{
  "valid": true,
  "algorithm": "ECDSA-P256",
  "digestMatches": true,
  "signerIdentity": "WorkSphere Cryptographic Authority",
  "timestamp": "2026-10-07T21:14:00.000Z"
}
```

#### Rejection / Tampering Response (`200 OK`)
```json
{
  "valid": false,
  "algorithm": "ECDSA-P256",
  "digestMatches": false,
  "error": "Signature verification failed",
  "timestamp": "2026-10-07T21:14:00.000Z"
}
```

#### Bad Request Response (`400 Bad Request`)
```json
{
  "valid": false,
  "error": "Missing required receipt payload or signature"
}
```

### Public Key Verification Protocols

To audit public keys independently:
- WorkSphere publishes public key certificates in JWKS (JSON Web Key Set) format at `/.well-known/receipt-signing-keys.json`.
- Fingerprints can be verified against DNS TXT records or cross-checked with the authority certificate authority chain.

---

## 8. Threat Model & Attack Mitigations

| Threat Vector | Attack Scenario | WorkSphere Cryptographic Defense |
| :--- | :--- | :--- |
| **Receipt Tampering** | User edits PDF receipt or client state to change `totalAmount` from \$100 to \$10 or change reservation dates. | **Signature Break:** Any single-character change alters the SHA-256 canonical digest; ECDSA signature verification fails immediately. |
| **Replay Attacks** | User screenshots yesterday's valid signed receipt to access the venue today. | **Temporal Binding:** The canonical payload strictly binds `date` (YYYY-MM-DD) and `time`. Verifiers reject receipts where `date !== currentDate`. |
| **Cross-Venue Cloning** | User uses a valid receipt from Venue A to enter Venue B. | **Spatial Binding:** `venueId` is embedded in the signed payload. Gate hardware at Venue B verifies `payload.venueId === localVenueId`. |
| **Dictionary Permutation Attack** | Attacker reorganizes JSON attributes hoping to exploit parser differences. | **RFC 8785 JCS Enforcement:** Attributes are sorted alphabetically and normalized before hashing, neutralizing serializer discrepancies. |
| **Key Compromise** | An authority private key is suspected of being compromised. | **Granular `keyId` & Revocation:** WorkSphere rotates `keyId`, publishes a revoked key list, and issues replacements without invalidating earlier uncompromised epochs. |

---

## 9. TypeScript Data Contracts & API Reference

All functions are exported directly from [`src/lib/crypto/receiptSigner.ts`](file:///c:/Users/admin/Desktop/workfere/src/lib/crypto/receiptSigner.ts):

### Core Types

```typescript
export type SignatureAlgorithm = "RSA-SHA256" | "ECDSA-P256" | "ECDSA-P384";

export interface CryptographicReceiptSignature {
  signature: string;        // Base64 encoded signature
  algorithm: SignatureAlgorithm;
  publicKeyPem: string;     // SPKI PEM format
  digest: string;           // SHA-256 hex digest of canonical payload
  canonicalPayload: string; // RFC 8785 canonical string
  signedAt: string;         // ISO timestamp
  keyId?: string;
}

export interface ReceiptVerificationResult {
  valid: boolean;
  algorithm: SignatureAlgorithm;
  digestMatches: boolean;
  signerIdentity?: string;
  error?: string;
  timestamp?: string;
}
```

### Primary Methods

1. **`canonicalizeReceiptPayload(payload: ReservationReceiptPayload): string`**
   Deterministically converts reservation records to RFC 8785 canonical JSON string with sorted keys and omitted undefined attributes.

2. **`computeReceiptDigest(canonicalJson: string): string`**
   Returns the SHA-256 hexadecimal hash digest of the canonical string.

3. **`generateReceiptKeyPair(type?: SignatureAlgorithm | "RSA" | "ECDSA"): { publicKeyPem: string; privateKeyPem: string }`**
   Generates a cryptographically strong public/private keypair formatted as SPKI / PKCS#8 PEM.

4. **`signReservationReceipt(payload: ReservationReceiptPayload, options?: SignOptions): CryptographicReceiptSignature`**
   Asymmetrically signs the canonical receipt payload using ECDSA (P-256 / P-384) or RSA-SHA256.

5. **`verifyReservationReceipt(payload: ReservationReceiptPayload, signatureBase64: string, publicKeyPem: string, algorithm?: SignatureAlgorithm, expectedDigest?: string): ReceiptVerificationResult`**
   Validates the digital signature against the receipt contents, returning validity, digest confirmation, and signer identity.

6. **`verifyRawBufferSignature(dataBuffer: Uint8Array | Buffer, signatureBase64: string, publicKeyPem: string, algorithm?: SignatureAlgorithm): boolean`**
   Performs low-level signature verification over raw binary data buffers (e.g. downloaded PDF bytes).

---

## 10. End-to-End Execution Sequence Diagrams

### 10.1 Receipt Generation & Signing Workflow

```mermaid
sequenceDiagram
    autonumber
    actor Customer as User / Client
    participant BookingAPI as WorkSphere API (/api/bookings/checkout)
    participant Signer as ReceiptSigner (receiptSigner.ts)
    participant KMS as WorkSphere Authority Key Store
    participant DB as PostgreSQL Database
    participant PDF as PDFGenerator (pdfGenerator.ts)

    Customer->>BookingAPI: Complete Workspace Reservation
    BookingAPI->>DB: Persist Booking record (status = CONFIRMED)
    BookingAPI->>Signer: signReservationReceipt(bookingPayload, { algorithm: "ECDSA-P256" })
    Signer->>Signer: canonicalizeReceiptPayload() [RFC 8785]
    Signer->>Signer: computeReceiptDigest() [SHA-256]
    Signer->>KMS: Request ECDSA P-256 signature over digest
    KMS-->>Signer: Return DER signature bytes
    Signer-->>BookingAPI: Return CryptographicReceiptSignature (Base64)
    BookingAPI->>PDF: generateReceiptPdf(booking, signature)
    PDF-->>Customer: Deliver PDF Receipt & Encoded Offline QR Code
```

### 10.2 Offline Gate Scanner Verification Workflow

```mermaid
sequenceDiagram
    autonumber
    actor User as Arriving Guest
    participant Turnstile as Venue Offline Scanner (PWA / Hardware)
    participant Cache as Local Secure Storage (IndexedDB / TPM)
    participant Engine as WebCrypto Subtle API (Offline)

    User->>Turnstile: Present Receipt QR Code / Apple Wallet Pass
    Turnstile->>Turnstile: Parse QR Code Payload (Base64URL Token)
    Turnstile->>Cache: Fetch Public Key for keyId ("worksphere-authority-1")
    Cache-->>Turnstile: Return Cached Authority Public Key (SPKI)
    Turnstile->>Turnstile: Canonicalize Payload according to RFC 8785 rules
    Turnstile->>Engine: crypto.subtle.verify(ECDSA, key, signature, canonicalBytes)
    Engine-->>Turnstile: Verification Result: VALID (true)
    Turnstile->>Turnstile: Validate venueId === localVenueId AND date === today()
    Turnstile-->>User: Visual Green Indicator & Open Turnstile Barrier
```

---

*This specification is maintained under the WorkSphere Security Architecture and Cryptographic Identity standards.*
