# End-to-End Encrypted (E2EE) WebCrypto Session Key Exchange Protocol

This specification defines how team chat clients establish, rotate, and verify end-to-end encrypted sessions in the browser using the Web Cryptography API (`crypto.subtle`) so message confidentiality and integrity hold even if transport TLS terminates at an edge proxy.

## 1. Key Generation & Session Derivation

* **Asymmetric Key Agreement (`ECDH` / `X25519`):** Generate key pairs via `crypto.subtle.generateKey` using `ECDH` or `X25519` with non-extractable private keys (`extractable: false`).
* **Session Derivation (`HKDF` / `PBKDF2`):** Derive 256-bit `AES-GCM` session keys from the shared secret via `HKDF` (`SHA-256`) with unique salt and domain-separated `info` labels; use `PBKDF2` (`SHA-256`) with high iteration counts and unique salts when deriving keys from passphrases.
* **Authenticated Encryption (`AES-GCM`):** Encrypt chat frames with `AES-GCM` and bind protocol metadata via `additionalData`.

## 2. Ephemeral Key Exchange Handshake

1. **Initiator Exchange:** Client A generates an ephemeral `ECDH`/`X25519` key pair, exports its public key with a fresh nonce and supported versions, and sends the handshake init message.
2. **Responder Exchange:** Client B generates its ephemeral key pair, selects the highest mutually supported protocol/cipher suite, and returns its ephemeral public key and nonce.
3. **Shared Secret & Confirmation:** Both peers derive the session key via `HKDF` over the handshake transcript and exchange a key-confirmation MAC before sending encrypted chat messages.

## 3. Forward Secrecy & Session Re-Keying

* **Forward Secrecy:** Ephemeral key pairs per session or ratchet step isolate past session keys from later compromise.
* **Session Re-Keying:** Rotate session keys on message count/time limits, room membership changes, or explicit re-key messages (`epoch + 1`), retiring prior keys after a short grace window.

## 4. Initialization Vector (IV) Uniqueness Rules

* **No `(Key, IV)` Reuse:** Never reuse an IV under the same `AES-GCM` key.
* **Fresh 12-Byte IV:** Generate a fresh 96-bit (12-byte) IV with `crypto.getRandomValues(new Uint8Array(12))` per payload and send it alongside the ciphertext.
* **Duplicate Rejection:** Reject missing, malformed, or previously observed IV/counter pairs.

## 5. Verification Against Downgrade & Replay Attacks

* **Downgrade Verification:** Include negotiated version/cipher identifiers in the `HKDF` context and `AES-GCM` `additionalData`; reject versions below the minimum supported floor.
* **Replay Verification:** Validate monotonic per-sender frame counters/nonces and freshness windows per `(roomId, senderId, epoch)`, rejecting duplicates or stale frames.
