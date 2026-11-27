# End-to-End Encrypted (E2EE) WebCrypto Session Key Exchange Protocol

Expands the E2EE WebCrypto specification with the threat model, `ECDH` + `HKDF` key derivation, 96-bit `AES-GCM` IV rotation, key rotation triggers, and replay protections.

## 1. Threat Model

* **Network & Relay Adversary:** Treats transport links, proxies, and chat relays as untrusted against passive interception, tampering, MITM substitution, downgrade, and replay.
* **Endpoint Boundary:** Assumes client runtimes are trusted within session scope while keeping private keys non-extractable (`extractable: false`).

## 2. ECDH Key Generation & HKDF Session Derivation

* Generate `ECDH` key pairs via `crypto.subtle.generateKey` with non-extractable private keys.
* Derive 256-bit `AES-GCM` session keys from the shared secret using `HKDF` (`SHA-256`) with unique session salt and domain-separated `info`.
* Bind session/frame metadata (`protocolVersion`, `roomId`, `senderId`, `epoch`, `counter`) via `AES-GCM` `additionalData`.

## 3. AES-GCM 96-Bit IV Rotation

* Use 96-bit (12-byte) IVs with `AES-GCM` and never reuse an `(AES-GCM Key, IV)` pair.
* Generate fresh 12-byte IVs via `crypto.getRandomValues` per frame and rotate session keys before IV/message thresholds are reached.
* Reject missing, malformed, or duplicate IV/counter frames.

## 4. Key Rotation Triggers

* **Message Count:** Rotate session key (`epoch + 1`) once a frame-count threshold is reached.
* **Time Interval:** Rotate keys periodically (e.g., every 15 minutes) or on key max-age expiry.
* **Membership Changes:** Re-key immediately when room members join, leave, or change roles.
* **Peer Re-Key / Epoch Reset:** Support explicit re-key frames and grace-window retirement of prior keys.

## 5. Replay Protections

* Include a monotonic per-sender `counter` and `epoch` authenticated by `AES-GCM`.
* Enforce a per-`(roomId, senderId, epoch)` sliding anti-replay window and reject duplicate or out-of-window counters.
