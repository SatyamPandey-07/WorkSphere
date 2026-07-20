# End-to-End Cryptographic Security & Zero-Knowledge Storage Architecture

## 1. Overview & Threat Model

WorkSphere implements a **Zero-Knowledge (ZK) End-to-End Encryption (E2EE)** architecture. All sensitive data—including user content, files, and workspace metadata—is encrypted on the client side using the **Web Crypto API** before leaving the client environment. 

### Core Principles
* **Zero-Knowledge:** The server acts strictly as an untrusted key-value / blob store. Server administrators, databases, and third-party infrastructure providers cannot decrypt or inspect user payload data.
* **Non-Extractable Keys:** Cryptographic keys are maintained in memory during active sessions or sealed inside client-side storage (`IndexedDB`) using hardware-backed isolation where available.
* **Authenticated Encryption:** All data at rest and in transit utilizes Authenticated Encryption with Associated Data (**AEAD**) to prevent tampering and ciphertext malleability attacks.

---

## 2. Key Derivation & Cryptographic Primitives

WorkSphere relies on standard Web Crypto API primitives to ensure native browser performance and audited security bounds.

### 2.1 Key Derivation Function (PBKDF2)
When deriving master encryption keys from a user password/passphrase, WorkSphere utilizes **PBKDF2-HMAC-SHA-256**.

| Parameter | Standard Value | Justification |
| :--- | :--- | :--- |
| **Algorithm** | `PBKDF2` | Broad native browser support via Web Crypto API |
| **Hash Function** | `SHA-256` | Provides 256-bit security margin |
| **Salt Length** | `128 bits` (16 bytes) | Cryptographically secure random salt generated via `crypto.getRandomValues()` |
| **Iterations** | `600,000` | Exceeds OWASP recommendations for client-side derivation without causing browser UI thread lag |
| **Derived Key Bit Length** | `256 bits` | Matched to AES-256 key size |

```javascript
// Derivation Implementation Example
async function deriveMasterKey(password, salt) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt, // Uint8Array of 16 bytes
      iterations: 600000,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false, // Non-extractable key
    ['encrypt', 'decrypt']
  );
}
```
 ## 3. AES-GCM 256-Bit Web Crypto Implementation
Data payload protection uses AES-256-GCM (Galois/Counter Mode), providing confidentiality and built-in integrity authentication.

## 3.1 Initialization Vector (IV) Standards
IV Bit Length: 96 bits (12 bytes). Standard length recommended by NIST SP 800-38D for optimal GCM security and performance.

Generation: Generated fresh for every single encryption operation using crypto.getRandomValues().

Nonce Reuse Policy: Zero Tolerance. Reusing an IV with the same key under AES-GCM completely destroys authentication security and risks full plaintext recovery.

```JavaScript
// Encryption Pattern
async function encryptPayload(data, key) {
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV
  
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv,
      tagLength: 128 // 128-bit authentication tag
    },
    key,
    enc.encode(JSON.stringify(data))
  );

  return {
    ciphertext: new Uint8Array(ciphertext),
    iv: iv
  };
}
```
## 4. Key Lifecycle & IndexedDB Storage Management
Cryptographic keys must be persisted locally across user navigation without exposing raw secret material to potential Cross-Site Scripting (XSS) vectors.

## 4.1 Storage Architecture
Key Generation: Master keys and Workspace Data Encryption Keys (DEKs) are generated as non-extractable CryptoKey objects (extractable: false).

IndexedDB Persistence: Structured clone algorithms permit storing CryptoKey objects directly into IndexedDB.

Key Hierarchy & Wrapping:

Key Encryption Key (KEK): Derived via PBKDF2 from user credentials.

Data Encryption Keys (DEKs): Per-workspace or per-resource symmetric AES-GCM keys wrapped using the KEK before server synchronization.

+-------------------------------------------------------+
|                   User Passphrase                     |
+-------------------------------------------------------+
                           |
                           v  (PBKDF2-HMAC-SHA-256 / 600k iter)
+-------------------------------------------------------+
|              Key Encryption Key (KEK)                 |
+-------------------------------------------------------+
                           |
            +--------------+--------------+
            |                             |
            v                             v
+-----------------------+     +-----------------------+
|  DEK 1 (Workspace A)  |     |  DEK 2 (Workspace B)  |
+-----------------------+     +-----------------------+
            |                             |
            v (AES-256-GCM)               v (AES-256-GCM)
+-----------------------+     +-----------------------+
|  Encrypted Payload A  |     |  Encrypted Payload B  |
+-----------------------+     +-----------------------+

## 4.2 Key Protection & Purge Rules
Session Teardown: Upon logout, the local IndexedDB key vault store is explicitly cleared using indexedDB.deleteDatabase() or transaction purges.

In-Memory Retention: Unwrapped keys in memory are scoped to web worker / context instances and marked for immediate garbage collection on session terminate.

## 5. Threat Vectors & Mitigation Analysis

| Threat Vector | Severity | Attack Description | Mitigation Strategy |
| :--- | :---: | :--- | :--- |
| **Server Compromise / Data Leakage** | `High` | Adversary gains full access to database and object storage infrastructure. | **Zero-Knowledge Architecture.** Server only stores AEAD ciphertexts, IVs, and salts. Plaintext data cannot be decrypted without client-held keys. |
| **Cross-Site Scripting (XSS)** | `Critical` | Malicious scripts injected into the web app attempt to extract cryptographic keys. | Keys in `IndexedDB` are stored with `extractable: false`. Browser prevents exporting raw key material via `crypto.subtle.exportKey()`. Enforce strict CSP headers. |
| **AES-GCM Nonce Reuse** | `Critical` | Reusing the same Initialization Vector (IV) with a key exposes XORed plaintexts and degrades AEAD authentication. | Enforce cryptographically secure 96-bit random IV generation per payload (`crypto.getRandomValues`). Rotate keys prior to $2^{32}$ encryption operations. |
| **Chosen-Ciphertext Attack (CCA)** | `High` | Attacker tampers with stored ciphertext payload to manipulate application behavior. | Built-in AES-GCM 128-bit authentication tag verification occurs during decryption. Any tampered payload is rejected before parsing. |
| **Brute-Force / Dictionary Attacks** | `Medium` | Offline attempts to crack user passphrases using specialized hardware (GPUs/ASICs). | High-iteration PBKDF2-HMAC-SHA-256 (600,000 rounds) paired with unique 128-bit per-user salts exponentially increases compute cost for offline attacks. |
