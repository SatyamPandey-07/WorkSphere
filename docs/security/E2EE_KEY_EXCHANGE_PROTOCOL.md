# End-to-End Encryption (E2EE) & Key Exchange Protocol Specification

**Document ID:** `WS-SEC-E2EE-004`  
**Owner:** Security & Cryptography Engineering  
**Applies To:** Nomad Team Room Chat (`party/server.ts`, `src/lib/crypto/e2eeRoomSession.ts`, `/api/auth/passkey/*`)  
**Cryptographic Suite:** `ECDH-P256` + `HKDF-SHA256` + `AES-256-GCM` + `SPKI-SHA256-PINNING`  

---

## 1. Executive Summary & Architectural Scope

WorkSphere's nomad team rooms (War Rooms, Focus Rooms, and collaborative venue channels) transmit messages over PartyKit WebSockets and WebRTC DataChannels. Because coworking spaces and public cafes frequently operate over untrusted Wi-Fi networks—and because relay infrastructure should never have plaintext visibility into proprietary engineering discussions, NDA documents, or shared credentials—all room traffic is protected by a zero-knowledge **End-to-End Encryption (E2EE)** protocol implemented exclusively via the browser's native **Web Crypto API (`window.crypto.subtle`)**.

### Cryptographic Primitives Summary

| Layer | Primitive / Standard | Parameters | Purpose |
| :--- | :--- | :--- | :--- |
| **Key Agreement** | ECDH (`NIST P-256` / `secp256r1`) | Ephemeral per-session keypairs (`extractable: false` for private key) | Diffie-Hellman shared secret establishment with forward secrecy |
| **Key Derivation** | `HKDF-SHA256` (RFC 5869) | 256-bit random session salt + domain-separated `info` context | Derives independent `AES-GCM` encryption keys and MAC binding keys |
| **Authenticated Encryption** | `AES-256-GCM` (NIST SP 800-38D) | 256-bit key, 96-bit random/monotonic IV, 128-bit authentication tag, AAD | Confidentiality, ciphertext integrity, and metadata authenticity |
| **Identity & Key Pinning** | `SPKI SHA-256` Pinning + `ECDSA P-256` / WebAuthn Passkeys | Base64URL-encoded SHA-256 digest of X.509 SubjectPublicKeyInfo (`spki`) | Prevents active Man-in-the-Middle (MitM) key substitution on untrusted relays |

---

## 2. Cryptographic Key Hierarchy & SPKI Pinning

Every participant maintains two distinct key tiers:

1. **Long-Term Identity Keypair (`IK`):**
   * Backed by WebAuthn/Passkey credentials (`/api/auth/passkey/*`) or a non-extractable `ECDSA P-256` key stored in IndexedDB (`WebCrypto` key handle).
   * Exported in **X.509 SubjectPublicKeyInfo (`spki`)** DER format.
   * Its fingerprint is computed as:
     $$\text{Pin}_{\text{SPKI}} = \text{Base64URL}\big(\text{SHA-256}(\text{DER}(\text{SPKI}_{\text{IK}}))\big)$$
2. **Ephemeral Session Keypair (`EK`):**
   * Generated fresh per room join (`crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])`).
   * Signed by the sender's Long-Term Identity Key (`IK`) together with the room identifier and expiration timestamp before broadcast over the PartyKit relay.
   * Destroyed in memory immediately upon room exit or epoch rotation.

### SPKI Key Pinning Verification Rules

* **Trust-On-First-Use (TOFU) + Directory Attestation:** On first peer encounter in a room, the client fetches the peer's attested `spkiPin` from `/api/auth/passkey/directory` (or verifies an out-of-band QR safety number) and persists `{ userId, spkiPin, firstSeenAt }` in local IndexedDB (`WorkSphereKeyring`).
* **Pin Mismatch Hard Fail:** If a peer presents an ephemeral key signed by an `SPKI` whose SHA-256 digest differs from the pinned value, the client **immediately halts key derivation**, drops incoming frames from that `senderId`, and displays a critical security warning banner (`KEY_PIN_MISMATCH`).

---

## 3. Formal Protocol Flowchart

### 3.1 Ephemeral Key Agreement, HKDF Derivation & SPKI Verification

```text
┌─────────────────────────┐          ┌─────────────────────────┐          ┌─────────────────────────┐
│    Peer A (Initiator)   │          │   PartyKit / WebRTC     │          │    Peer B (Responder)   │
│   Web Crypto Subtle     │          │    Untrusted Relay      │          │   Web Crypto Subtle     │
└────────────┬────────────┘          └────────────┬────────────┘          └────────────┬────────────┘
             │                                    │                                    │
   1. Generate Ephemeral ECDH P-256               │                          1. Generate Ephemeral ECDH P-256
      (EK_A_priv, EK_A_pub)                       │                             (EK_B_priv, EK_B_pub)
   2. Export SPKI(IK_A_pub) & EK_A_pub            │                          2. Export SPKI(IK_B_pub) & EK_B_pub
   3. Sign handshake transcript with IK_A_priv    │                          3. Sign handshake transcript with IK_B_priv
      sig_A = Sign(IK_A_priv, roomId||EK_A_pub||ts)                             sig_B = Sign(IK_B_priv, roomId||EK_B_pub||ts)
             │                                    │                                    │
             ├─────── HELLO { EK_A_pub, ─────────►├─────── HELLO { EK_A_pub, ─────────►│
             │        SPKI_A, sig_A, ts }         │        SPKI_A, sig_A, ts }         │
             │                                    │                                    │
             │                                    │                          4. Compute SHA-256(SPKI_A)
             │                                    │                             Verify == Pinned SPKI_A
             │                                    │                          5. Verify ECDSA sig_A using SPKI_A
             │                                    │                             & check |now - ts| <= 30s
             │                                    │                                    │
             │◄────── HELLO_ACK { EK_B_pub, ──────┤◄────── HELLO_ACK { EK_B_pub, ──────┤
             │        SPKI_B, sig_B, salt_AB, ts }│        SPKI_B, sig_B, salt_AB, ts }│
             │                                    │                                    │
   4. Compute SHA-256(SPKI_B)                     │                                    │
      Verify == Pinned SPKI_B                     │                                    │
   5. Verify ECDSA sig_B using SPKI_B             │                                    │
      & check |now - ts| <= 30s                   │                                    │
             │                                    │                                    │
   6. Z = ECDH(EK_A_priv, EK_B_pub) [256 bits]    │                          6. Z = ECDH(EK_B_priv, EK_A_pub) [256 bits]
   7. PRK = HKDF-Extract(salt_AB, Z)              │                          7. PRK = HKDF-Extract(salt_AB, Z)
   8. K_enc = HKDF-Expand(PRK, info, 256 bits)    │                          8. K_enc = HKDF-Expand(PRK, info, 256 bits)
      info = "WorkSphere-E2EE-v1|" + roomId       │                             info = "WorkSphere-E2EE-v1|" + roomId
             + "|" + sort(pinA, pinB)             │                                  + "|" + sort(pinA, pinB)
             │                                    │                                    │