# Multi-Party Threshold Cryptography & WebAuthn Passkey Recovery Manual

This manual documents WorkSphere's **Shamir's Secret Sharing** 2-of-3 threshold cryptography implementation, **Web Crypto AES-GCM** share encryption, and automated **passkey account recovery** protocol. It provides the mathematical foundations, cryptographic primitives, and operational flows required to implement a secure, user-controlled key recovery system.

---

## Table of Contents

1. [Overview & Threat Model](#1-overview--threat-model)
2. [Shamir's Secret Sharing — Mathematical Foundations](#2-shamirs-secret-sharing--mathematical-foundations)
3. [2-of-3 Threshold Scheme — WorkSphere Implementation](#3-2-of-3-threshold-scheme--worksphere-implementation)
4. [Web Crypto AES-GCM Share Encryption](#4-web-crypto-aes-gcm-share-encryption)
5. [Passkey Account Recovery Protocol](#5-passkey-account-recovery-protocol)
6. [Recovery Sequence Flows](#6-recovery-sequence-flows)
7. [Security Properties & Guarantees](#7-security-properties--guarantees)
8. [Threat Analysis & Mitigations](#8-threat-analysis--mitigations)
9. [Implementation Checklist](#9-implementation-checklist)
10. [Browser & Platform Compatibility](#10-browser--platform-compatibility)

---

## 1. Overview & Threat Model

### Purpose

WorkSphere allows users to recover access to their encrypted workspaces when all registered passkeys are lost (device theft, factory reset, OS reinstall) by employing a **2-of-3 Shamir's Secret Sharing** scheme. The user's master recovery key is split into three shares: one held locally, one escrowed with a trusted contact, and one stored server-side (encrypted). Any **two shares** can reconstruct the key; no single share reveals any information about it.

### Core Principles

- **Information-Theoretic Security:** Shamir's Secret Sharing provides unconditional security — a single share yields zero information about the secret, regardless of computational power.
- **Threshold Recovery:** The 2-of-3 scheme tolerates the loss of one share while preventing any single party from recovering the secret alone.
- **Authenticated Encryption:** All shares are encrypted with AES-256-GCM before storage, providing confidentiality and integrity.
- **Passkey-Rooted Trust:** The recovery key is cryptographically bound to the user's WebAuthn credential identity, preventing cross-account recovery attacks.

### Threat Model

| Attacker | Capability | Mitigation |
|----------|-----------|------------|
| **Compromised server** | Read all server-stored shares | Share encrypted with user-derived key; server never sees plaintext |
| **Malicious trusted contact** | Refuses to cooperate or attempts to recover alone | 2-of-3 threshold; single share is information-theoretically useless |
| **Stolen device** | Extract local share from browser storage | Share encrypted with device-bound key; IndexedDB cleared on logout |
| **Network eavesdropper** | Observe recovery protocol traffic | All communication over TLS; shares transmitted only during recovery ceremony |
| **Brute-force attacker** | Attempt to guess the secret from one share | Shamir provides zero information from fewer than threshold shares |

---

## 2. Shamir's Secret Sharing — Mathematical Foundations

### 2.1 Polynomial Interpolation

Shamir's Secret Sharing is based on the fact that a polynomial of degree $t-1$ is uniquely determined by $t$ points. For a 2-of-3 scheme, we use a polynomial of degree 1 (a line):

$$
f(x) = s + a_1 \cdot x \pmod{p}
$$

Where:
- $s$ is the secret (the master recovery key)
- $a_1$ is a randomly chosen coefficient
- $p$ is a large prime ($p > s$ and $p > n$, where $n$ is the number of shares)

### 2.2 Share Generation

Given secret $s$ and random coefficient $a_1$, three shares are computed:

$$
\text{share}_i = f(i) = s + a_1 \cdot i \pmod{p}, \quad i \in \{1, 2, 3\}
$$

```text
Share computation (2-of-3):

  f(x) = s + a₁·x  (mod p)

  share₁ = f(1) = s + a₁·1  (mod p)
  share₂ = f(2) = s + a₁·2  (mod p)
  share₃ = f(3) = s + a₁·3  (mod p)
```

### 2.3 Secret Reconstruction (Lagrange Interpolation)

Given any two shares $(x_i, y_i)$ and $(x_j, y_j)$, the secret is recovered using Lagrange interpolation:

$$
s = f(0) = y_i \cdot \frac{-x_j}{x_i - x_j} + y_j \cdot \frac{-x_i}{x_j - x_i} \pmod{p}
$$

Or equivalently:

$$
s = \sum_{k \in \{i,j\}} y_k \prod_{l \neq k} \frac{-x_l}{x_k - x_l} \pmod{p}
$$

### 2.4 Worked Example

```text
Prime p = 233
Secret s = 172
Random coefficient a₁ = 89

Polynomial: f(x) = 172 + 89x  (mod 233)

Shares:
  share₁ = f(1) = 172 + 89·1 = 261 mod 233 = 28
  share₂ = f(2) = 172 + 89·2 = 350 mod 233 = 117
  share₃ = f(3) = 172 + 89·3 = 439 mod 233 = 206

Recovery using share₁ and share₂:
  s = 28 · (0 - 2)/(1 - 2) + 117 · (0 - 1)/(2 - 1)  (mod 233)
    = 28 · (-2)(-1) + 117 · (-1)(1)                    (mod 233)
    = 28 · 2 + 117 · (-1)                               (mod 233)
    = 56 - 117                                           (mod 233)
    = -61                                                (mod 233)
    = 172 ✓
```

### 2.5 Security Properties

| Property | Description | Mathematical Basis |
|----------|-------------|-------------------|
| **Perfect secrecy** | Fewer than $t$ shares reveal zero information about $s$ | Each missing share adds a uniformly random unknown |
| **Threshold** | Any $t$ shares suffice to reconstruct $s$ | Polynomial interpolation uniqueness |
| **Efficient** | Share generation and reconstruction are $O(n)$ and $O(t^2)$ | Lagrange basis evaluation |

---

## 3. 2-of-3 Threshold Scheme — WorkSphere Implementation

### 3.1 Share Distribution Model

```text
                    Master Recovery Key (s)
                              |
                    Shamir Split (t=2, n=3)
                              |
            +-----------------+-----------------+
            |                 |                 |
            v                 v                 v
     ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
     │  Share 1    │  │  Share 2    │  │  Share 3    │
     │  (User)     │  │  (Trusted   │  │  (Server)   │
     │             │  │   Contact)  │  │             │
     │  IndexedDB  │  │  Encrypted  │  │  Encrypted  │
     │  (device)   │  │  QR / USB   │  │  (cloud)    │
     └─────────────┘  └─────────────┘  └─────────────┘
```

### 3.2 Share Assignment

| Share | Holder | Storage | Access Condition |
|-------|--------|---------|-----------------|
| **Share 1** | User (device) | IndexedDB, encrypted with device-bound key | Available during active session |
| **Share 2** | Trusted contact | Printed QR code or USB drive | User requests recovery from contact |
| **Share 3** | WorkSphere server | Cloud storage, encrypted with user-derived key | User authenticates and requests recovery |

### 3.3 Secret Encoding

The master recovery key is a 256-bit value derived from the user's recovery passphrase via PBKDF2. It is encoded as a big-endian integer modulo a safe prime $p$:

| Parameter | Value | Source |
|-----------|-------|--------|
| Secret $s$ | 256-bit integer | PBKDF2-HMAC-SHA-256 derivation |
| Prime $p$ | 256-bit safe prime | Pre-generated, published in domain parameters |
| Coefficient $a_1$ | Random 256-bit integer | `crypto.getRandomValues()` |
| Share indices | $x \in \{1, 2, 3\}$ | Fixed assignment |

---

## 4. Web Crypto AES-GCM Share Encryption

Before storage or transmission, each share is encrypted using AES-256-GCM with a share-specific key derived via PBKDF2 from the user's recovery passphrase and a per-share salt.

### 4.1 Key Derivation for Share Encryption

```typescript
async function deriveShareKey(
  recoveryPassphrase: string,
  shareSalt: Uint8Array
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(recoveryPassphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: shareSalt,
      iterations: 600000,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}
```

### 4.2 Share Encryption

```typescript
interface EncryptedShare {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  salt: Uint8Array;
  authTag: Uint8Array;
}

async function encryptShare(
  share: Uint8Array,
  recoveryPassphrase: string
): Promise<EncryptedShare> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveShareKey(recoveryPassphrase, salt);

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
      tagLength: 128,
    },
    key,
    share
  );

  const buffer = new Uint8Array(ciphertext);
  const authTag = buffer.slice(-16);
  const encryptedData = buffer.slice(0, -16);

  return {
    ciphertext: encryptedData,
    iv: iv,
    salt: salt,
    authTag: authTag,
  };
}
```

### 4.3 Share Decryption

```typescript
async function decryptShare(
  encrypted: EncryptedShare,
  recoveryPassphrase: string
): Promise<Uint8Array> {
  const key = await deriveShareKey(recoveryPassphrase, encrypted.salt);

  const combined = new Uint8Array(
    encrypted.ciphertext.length + encrypted.authTag.length
  );
  combined.set(encrypted.ciphertext);
  combined.set(encrypted.authTag, encrypted.ciphertext.length);

  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: encrypted.iv,
      tagLength: 128,
    },
    key,
    combined
  );

  return new Uint8Array(decrypted);
}
```

### 4.4 Share Storage Schema

```typescript
interface StoredShare {
  id: string;
  shareIndex: number;           // 1, 2, or 3
  encryptedShare: EncryptedShare;
  createdAt: number;            // Unix timestamp (ms)
  algorithm: {
    name: "AES-GCM";
    keyLength: 256;
    tagLength: 128;
  };
  kdf: {
    name: "PBKDF2";
    hash: "SHA-256";
    iterations: 600000;
  };
  version: number;              // Schema version for migration
}
```

---

## 5. Passkey Account Recovery Protocol

### 5.1 Recovery Initiation

Recovery is triggered when a user cannot authenticate with any registered passkey. The protocol proceeds in three phases:

```text
Phase 1: Identity Verification
  User proves identity via email + recovery passphrase

Phase 2: Share Collection
  Collect 2 of 3 shares (any combination)

Phase 3: Secret Reconstruction & Re-keying
  Reconstruct master key, re-encrypt workspace keys,
  register new passkey
```

### 5.2 Recovery Passphrase

The recovery passphrase is a user-chosen string that serves as the encryption key for share storage. It is **not** the same as the master recovery key. The passphrase derives the share encryption key via PBKDF2; the master key is the Shamir secret.

```text
Recovery Passphrase (user-chosen)
         |
         v  PBKDF2-HMAC-SHA-256 (600k, per-share salt)
Share Encryption Key
         |
         v  AES-256-GCM
Encrypted Share
```

### 5.3 Share Collection Scenarios

| Scenario | Shares Used | User Action |
|----------|-------------|-------------|
| **Normal recovery** | Share 1 (local) + Share 3 (server) | Enter recovery passphrase; server provides Share 3 |
| **Device lost** | Share 2 (contact) + Share 3 (server) | Contact provides QR; enter passphrase; server provides Share 3 |
| **Server breach** | Share 1 (local) + Share 2 (contact) | Contact provides QR; enter passphrase |
| **Full rebuild** | Share 2 (contact) + Share 3 (server) | Contact provides QR; enter passphrase; server provides Share 3 |

### 5.4 Recovery Key Re-encryption

After reconstruction, the workspace Data Encryption Keys (DEKs) must be re-encrypted under a new master key, and new shares must be generated:

```typescript
interface RecoveryResult {
  masterKey: CryptoKey;
  newShares: Uint8Array[];
  reEncryptedDEKs: Map<string, EncryptedDEK>;
  newPasskeyCredentialId: string;
}
```

---

## 6. Recovery Sequence Flows

### 6.1 Full Recovery Sequence (Share 1 + Share 3)

```text
User                          Client                         Server
 |                              |                              |
 |-- Start Recovery ----------->|                              |
 |                              |-- Verify email ----------->   |
 |                              |<- Challenge token ---------   |
 |<-- Enter recovery pass -----  |                              |
 |                              |                              |
 |                              |-- Derive share key           |
 |                              |-- Decrypt Share 1 (local)    |
 |                              |                              |
 |                              |-- Request Share 3 --------->  |
 |                              |   (session token + email)    |
 |                              |<- Encrypted Share 3 -------  |
 |                              |                              |
 |                              |-- Decrypt Share 3            |
 |                              |-- Lagrange interpolation     |
 |                              |-- Recover master key (s)     |
 |                              |                              |
 |                              |-- Verify DEK integrity       |
 |                              |-- Generate new shares        |
 |                              |-- Re-encrypt DEKs            |
 |                              |                              |
 |                              |-- Store new Share 1 ------->  |
 |                              |-- Store new Share 3 ------->  |
 |                              |-- Send new Share 2 to contact|
 |                              |                              |
 |                              |-- Register new passkey       |
 |<- Session restored ---------  |<- Success -----------------  |
```

### 6.2 Recovery Sequence (Share 2 + Share 3)

```text
User              Contact              Client                    Server
 |                   |                   |                         |
 |-- Request QR ---->|                   |                         |
 |<- Share 2 (QR) -- |                   |                         |
 |                   |                   |                         |
 |-- Scan QR ------->|                   |                         |
 |                   |                   |-- Decode QR (Share 2)   |
 |<-- Enter pass ----|                   |                         |
 |                   |                   |-- Derive key, decrypt   |
 |                   |                   |                         |
 |                   |                   |-- Request Share 3 ----> |
 |                   |                   |<- Encrypted Share 3 --- |
 |                   |                   |                         |
 |                   |                   |-- Decrypt Share 3       |
 |                   |                   |-- Reconstruct (s)       |
 |                   |                   |-- Re-key + new shares   |
 |                   |                   |                         |
 |                   |                   |-- Store Share 1+3 --->  |
 |                   |                   |-- Store Share 3 ------> |
 |                   |<-- Send new QR -- |                         |
 |<- New Share 2 --- |                   |                         |
 |                   |                   |<- New passkey register  |
 |<-- Recovery done -|                   |<- Success ------------- |
```

### 6.3 Share QR Code Format

The trusted-contact share is encoded as a QR code for physical distribution:

```typescript
interface ShareQRPayload {
  version: 1;
  shareIndex: 2;
  encryptedData: string;    // Base64URL-encoded encrypted share
  iv: string;              // Base64URL-encoded IV
  salt: string;            // Base64URL-encoded salt
  authTag: string;         // Base64URL-encoded auth tag
  checksum: string;        // SHA-256 of encrypted data (first 8 bytes)
}
```

```json
{
  "version": 1,
  "shareIndex": 2,
  "encryptedData": "a8Fj2kL9...",
  "iv": "x7Bm3nPq...",
  "salt": "r5Ts8Ywz...",
  "authTag": "k2Wq9LmN...",
  "checksum": "aB3cD4eF"
}
```

---

## 7. Security Properties & Guarantees

### 7.1 Information-Theoretic Security

Shamir's Secret Sharing provides **perfect secrecy** — fewer than $t$ shares contain zero information about the secret $s$, regardless of the adversary's computational resources.

$$
P(s = v \mid \text{share}_1, \ldots, \text{share}_{t-1}) = P(s = v)
$$

This means even an adversary with unlimited computing power cannot extract any information about the secret from a single share.

### 7.2 Computational Security (Share Encryption)

The AES-256-GCM layer provides **computational security** for share storage:

| Layer | Security Model | Strength |
|-------|---------------|----------|
| Shamir share | Information-theoretic | Unlimited (unconditional) |
| AES-256-GCM encryption | Computational | $2^{256}$ key space |
| PBKDF2 key derivation | Computational | $600{,}000$ iterations |

### 7.3 Combined Security

Even if an attacker obtains both:
- One encrypted share from the server, **and**
- The recovery passphrase (e.g., via phishing)

They still cannot recover the secret unless they also possess a second share. The passphrase alone does not yield a share; the share alone does not yield the secret.

---

## 8. Threat Analysis & Mitigations

| Threat | Severity | Description | Mitigation |
|--------|----------|-------------|------------|
| **Single share compromise** | Low | Attacker obtains one encrypted share | Information-theoretically safe; single share reveals nothing |
| **Passphrase compromise** | High | Attacker learns user's recovery passphrase | Still needs a second share; AES-GCM tag prevents tampering |
| **Replay attack** | Medium | Re-use of old shares after re-keying | Each recovery generates fresh shares; old shares become invalid |
| **Man-in-the-middle** | High | Attacker intercepts share during recovery | TLS 1.3 transport; shares are encrypted end-to-end |
| **Trusted contact collusion** | Medium | Contact refuses to cooperate or loses share | 2-of-3 allows recovery with any other pair; user can re-key |
| **Server data breach** | High | Attacker reads all server-stored shares | Shares encrypted with user-derived key; server never sees plaintext |
| **IndexedDB theft** | Medium | XSS or physical device access extracts local share | Share encrypted with device-bound key; cleared on logout |
| **Brute-force passphrase** | Medium | Offline dictionary attack on PBKDF2-encrypted share | 600,000 PBKDF2 iterations + 128-bit salt makes this infeasible |

### 8.1 Re-keying Protocol

After any recovery event, all shares are invalidated and new shares are generated:

```typescript
async function reKeyAfterRecovery(
  masterKey: CryptoKey,
  recoveryPassphrase: string,
  shareDistribution: ShareDistribution
): Promise<ReKeyResult> {
  // 1. Generate new polynomial coefficient
  const a1 = crypto.getRandomValues(new Uint8Array(32));

  // 2. Generate 3 new shares
  const newShares = generateShares(masterKey, a1, 3);

  // 3. Encrypt each share with the recovery passphrase
  const encrypted = await Promise.all(
    newShares.map((share) => encryptShare(share, recoveryPassphrase))
  );

  // 4. Store Share 1 locally and Share 3 server-side
  await storeLocalShare(encrypted[0]);
  await storeServerShare(encrypted[2]);

  // 5. Send Share 2 to trusted contact
  await sendToTrustedContact(encrypted[1], shareDistribution);

  // 6. Invalidate old shares on server
  await invalidatePreviousShares();

  return { success: true, shareVersion: Date.now() };
}
```

---

## 9. Implementation Checklist

- [ ] Implement Shamir polynomial operations in `src/lib/crypto/shamir.ts` (share generation, Lagrange interpolation, prime field arithmetic).
- [ ] Implement share encryption/decryption in `src/lib/crypto/shareEncryption.ts` using Web Crypto AES-256-GCM.
- [ ] Create `src/lib/crypto/shareStorage.ts` for IndexedDB (local share) and server API (remote share) persistence.
- [ ] Create `src/app/api/recovery/route.ts` for share distribution and recovery ceremony endpoints.
- [ ] Implement recovery passphrase entry component at `src/components/recovery/RecoveryPassphraseInput.tsx`.
- [ ] Create QR code generation/scanning for trusted-contact share at `src/components/recovery/ShareQRCode.tsx`.
- [ ] Implement the recovery flow orchestrator in `src/lib/crypto/recoveryProtocol.ts`.
- [ ] Add re-keying logic after successful recovery (new shares, DEK re-encryption).
- [ ] Update `src/lib/webauthn.ts` to support post-recovery passkey registration.
- [ ] Add recovery-related documentation to `docs/THRESHOLD_CRYPTOGRAPHY_PASSKEY_RECOVERY.md` (this file).
- [ ] Update `TODO.md` to mark completed implementation items.

---

## 10. Browser & Platform Compatibility

### 10.1 Web Crypto API Support

| Feature | Chrome | Firefox | Safari | Edge | Notes |
|---------|--------|---------|--------|------|-------|
| `crypto.subtle.encrypt` (AES-GCM) | 37+ | 34+ | 11+ | 12+ | Full support |
| `crypto.subtle.deriveKey` (PBKDF2) | 37+ | 34+ | 11+ | 12+ | Full support |
| `crypto.getRandomValues()` | 11+ | 16+ | 6+ | 12+ | Full support |
| `IndexedDB` share storage | 24+ | 16+ | 10+ | 12+ | Full support |

### 10.2 Recovery Ceremony Requirements

| Requirement | Description | Fallback |
|-------------|-------------|----------|
| Web Crypto API | AES-GCM encryption/decryption | Cannot perform recovery; instruct user to use supported browser |
| IndexedDB | Local share storage | Fall back to server-only recovery (Share 2 + Share 3) |
| Camera API | QR code scanning for contact share | Manual Base64URL entry of share data |
| `crypto.subtle` (secure context) | All cryptographic operations | Must be served over HTTPS or localhost |

### 10.3 Platform-Specific Notes

| Platform | Notes |
|----------|-------|
| **iOS Safari** | Full Web Crypto support; IndexedDB may be purged under storage pressure; keep server share as primary fallback. |
| **Android Chrome** | Full support; test IndexedDB persistence across Chrome updates. |
| **Desktop browsers** | Full support; USB or printed QR for trusted-contact share. |
| **WebView / embedded** | `crypto.subtle` may be unavailable in insecure contexts; enforce HTTPS. |

---

## References

- [Shamir, A. (1979). How to Share a Secret. Communications of the ACM, 22(11), 612-613.](https://dl.acm.org/doi/10.1145/359168.359176)
- [NIST SP 800-38D: Recommendation for Block Cipher Modes of Operation (GCM)](https://csrc.nist.gov/publications/detail/sp/800-38d/final)
- [OWASP Cheat Sheet: Key Management](https://cheatsheetseries.owasp.org/cheatsheets/Key_Management_Cheat_Sheet.html)
- [Web Crypto API — W3C Recommendation](https://www.w3.org/TR/WebCryptoAPI/)
- [WebAuthn Level 3 — W3C Recommendation](https://www.w3.org/TR/webauthn-3/)
- [WorkSphere Cryptographic Security Architecture](./CRYPTOGRAPHIC_SECURITY_ARCHITECTURE.md)
- [WorkSphere WebAuthn Passkey Specification](./WEBAUTHN_PASSKEY_SPECIFICATION.md)
