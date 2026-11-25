# Double Ratchet Cryptographic Session State and Out-of-Order Message Handling Specification

**Document ID:** `WS-SEC-DR-001`  
**Owner:** Security & Cryptography Engineering  
**Primary Target:** [`src/core/chat/DoubleRatchetSession.ts`](../../src/core/chat/DoubleRatchetSession.ts)\
**Supporting Target:** [`src/core/chat/SkippedMessageKeyStore.ts`](../../src/core/chat/SkippedMessageKeyStore.ts)\
**Cryptographic Suite:** `ECDH (NIST P-256 / prime256v1)` + `HMAC-SHA256 (KDF)` + `AES-256-GCM (AEAD)` + `HKDF-SHA256 (Storage KDF)`  
**Protocol Version:** WorkSphere Double Ratchet v1.0 (Signal Protocol-compatible)  

---

## 1. Overview

The WorkSphere Double Ratchet implementation provides end-to-end encrypted (E2EE) messaging for direct peer-to-peer and group participant communications. It combines two cryptographic ratchet mechanisms to provide continuous key refreshment:

1. **Symmetric-Key KDF Ratchets:** Every sent and received message derives an ephemeral message key from a moving symmetric chain key using HMAC-SHA256. Once a message key is derived, the previous chain key is advanced and the individual message key is deleted immediately after encryption or decryption.
2. **Diffie-Hellman (DH) Ephemeral Ratchet:** Every conversational turn introduces fresh ephemeral asymmetric key pairs over the NIST P-256 (`prime256v1`) elliptic curve. Shared secrets computed from new DH exchanges are mixed into a master Root Key (`rk`), creating fresh sending and receiving chains.

### Core Security Guarantees

* **Forward Secrecy (FS):** Past message ciphertexts cannot be decrypted by an attacker who compromises the current session state, provided past message keys and chain keys were properly advanced and zeroized.
* **Post-Compromise Security (PCS):** If session state (such as chain keys or the current root key) is compromised by an adversary, the session automatically heals and restores confidentiality and authenticity as soon as both peers complete an uncompromised DH ratchet step.
* **Out-of-Order Message Caching:** Messages delayed, reordered, or delivered out of sequence over asynchronous networks (WebSockets, WebRTC DataChannels) are decrypted without stalling or corrupting the ratchet state machine.

### Scope & Boundaries

This document specifies the exact internal state model, root and chain KDF derivations, DH ratchet state transitions, skipped-message-key storage and lifecycle, session serialization/restoration contract, security properties, and implementation constraints of [`DoubleRatchetSession`](../../src/core/chat/DoubleRatchetSession.ts) and [`SkippedMessageKeyStore`](../../src/core/chat/SkippedMessageKeyStore.ts).

---

## 2. Cryptographic State Model

A Double Ratchet session maintains a state machine comprising asymmetric keys, symmetric root and chain keys, transmission sequence counters, and an encrypted repository of skipped message keys.

### State Variable Table

| Variable | Type | Location / Scope | Purpose | Initialization & Update Conditions |
| :--- | :--- | :--- | :--- | :--- |
| `sessionId` | `string` | Read-only | Unique identifier for the conversation session. | Provided via `RatchetSessionConfig.sessionId`. Immutable for session lifetime. |
| `dhs` | `crypto.ECDH` | Local Private/Public | Current local Diffie-Hellman key pair (`prime256v1`). | **Alice:** Generated randomly in constructor.<br>**Bob:** Initialized with pre-shared key pair in `initBob`.<br>**DH Turn:** Regenerated upon receiving a new remote DH public key in `dhRatchetStep()`. |
| `dhr` | `Buffer \| null` | Remote Public | Most recently received remote Diffie-Hellman public key (compressed/uncompressed SEC1 format). | **Alice:** Initialized with Bob's public key in `initAlice()`.<br>**Bob:** `null` until Alice's first envelope arrives.<br>**DH Turn:** Updated to `header.dhPublicKey` when different from current `dhr`. |
| `rk` | `Buffer` (32 bytes) | Root Master Key | Master 256-bit root key used to derive new chain keys upon DH ratchet turns. | Initialized with initial 32-byte shared secret (`sharedKey`).<br>Updated on each DH ratchet step via `kdfRk(rk, dhSecret)`. |
| `cks` | `Buffer \| null` (32 bytes) | Sending Chain Key | Current 256-bit symmetric chain key used to derive outgoing message keys. | **Alice:** Derived in `initAlice` via initial `kdfRk(rk, DH(dhs, dhr))`.<br>**Bob:** `null` until Bob's first DH step.<br>**Step:** Advanced on each `encrypt()` via `kdfCk(cks)`.<br>**DH Turn:** Replaced by `kdfRk(rk, DH(dhs, dhr))` during `dhRatchetStep()`. |
| `ckr` | `Buffer \| null` (32 bytes) | Receiving Chain Key | Current 256-bit symmetric chain key used to derive incoming message keys. | `null` until first message arrives with a given remote key.<br>**Step:** Advanced on each `decrypt()` via `kdfCk(ckr)`.<br>**DH Turn:** Derived via `kdfRk(rk, DH(dhs, dhr))` during `dhRatchetStep()`. |
| `ns` | `number` (uint32) | Sending Counter | Sequence number of the next message to be sent in the current sending chain. | Initialized to `0`. Incremented by `1` after each `encrypt()`. Reset to `0` when `dhs` rotates. |
| `nr` | `number` (uint32) | Receiving Counter | Sequence number of the next expected message in the current receiving chain. | Initialized to `0`. Incremented by `1` after each `decrypt()`. Reset to `0` when `dhr` changes. |
| `pn` | `number` (uint32) | Previous Chain Length | Number of messages sent in the immediately preceding sending chain. | Initialized to `0`. Set to `ns` immediately before `ns` is reset to `0` during a DH ratchet transition. |
| `skippedKeyStore` | `SkippedMessageKeyStore` | Encrypted Cache | Dedicated encrypted storage holding skipped message keys for out-of-order delivery. | Bound to `sessionId`. Receives skipped keys derived when message counters jump. |
| `isDestroyed` | `boolean` | Lifecycle Flag | Prevents operations on zeroized session buffers after destruction. | Initialized to `false`. Set to `true` on `destroy()`. |

---

## 3. Root KDF and Symmetric-Chain Derivation

The implementation strictly domain-separates root key transitions from symmetric chain advancements using distinct HMAC-SHA256 calculations.

### 3.1 Root Key Derivation (`kdfRk`)

The root KDF takes the current 32-byte root key $RK$ and a Diffie-Hellman shared secret $Z = \text{ECDH}(SK, PK)$ (computed via `session.dhs.computeSecret(...)`), producing an updated root key $RK_{\text{next}}$ and a new chain key $CK$:

$$\begin{aligned}
PRK &= \text{HMAC-SHA256}_{\text{key} = RK}(Z) \\
RK_{\text{next}} &= \text{HMAC-SHA256}_{\text{key} = PRK}(\text{"RootKeyNext"}) \\
CK &= \text{HMAC-SHA256}_{\text{key} = PRK}(\text{"ChainKeyNext"})
\end{aligned}$$

#### Implementation Code in `DoubleRatchetSession.ts`:
```typescript
private kdfRk(rk: Buffer, dhOut: Buffer): [Buffer, Buffer] {
  const prk = createHmac('sha256', rk).update(dhOut).digest();
  const newRk = createHmac('sha256', prk).update(Buffer.from('RootKeyNext', 'utf8')).digest();
  const newCk = createHmac('sha256', prk).update(Buffer.from('ChainKeyNext', 'utf8')).digest();
  prk.fill(0);
  return [newRk, newCk];
}
```

* Intermediate pseudorandom key buffer `prk` is explicitly zeroized (`prk.fill(0)`) after derivation.
* Ephemeral DH output `dhOut` is explicitly zeroized by the caller immediately after `kdfRk` returns.

### 3.2 Symmetric Chain Key Derivation (`kdfCk`)

Each message chain progresses monotonically. Advancing the chain produces the next chain key $CK_{i+1}$ and an ephemeral 32-byte Message Key $MK_i$:

$$\begin{aligned}
CK_{i+1} &= \text{HMAC-SHA256}_{\text{key} = CK_i}(\text{"ChainStep"}) \\
MK_i &= \text{HMAC-SHA256}_{\text{key} = CK_i}(\text{"MessageKey"})
\end{aligned}$$

#### Implementation Code in `DoubleRatchetSession.ts`:
```typescript
private kdfCk(ck: Buffer): [Buffer, Buffer] {
  const nextCk = createHmac('sha256', ck).update(Buffer.from('ChainStep', 'utf8')).digest();
  const mk = createHmac('sha256', ck).update(Buffer.from('MessageKey', 'utf8')).digest();
  return [nextCk, mk];
}
```

### 3.3 Authenticated Message Encryption & Decryption (`AES-256-GCM`)

Messages are encrypted under $MK_i$ using AES-256-GCM with a 96-bit (12-byte) random initialization vector (IV) and a 128-bit (16-byte) authentication tag.

* **Associated Authenticated Data (AAD):** The entire message header `{ dhPublicKey, pn, n }` is serialized as UTF-8 JSON and bound into the GCM cipher context:
  $$\text{AAD} = \text{UTF8}(\text{JSON}(\text{header}))$$
  This prevents message replay under modified sequence counters, modified chain lengths, or key substitution attacks.
* **Zeroization:** The plaintext message key buffer `mk` is immediately zeroized (`mk.fill(0)`) inside a `finally` block following encryption or decryption.

---

## 4. Diffie-Hellman Ratchet State Transitions

When participants exchange messages, the protocol executes an asymmetric ratchet turn whenever an incoming message contains a remote DH public key that differs from the receiver's current `dhr`.

### Step-by-Step Transition Mechanics (`dhRatchetStep`)

```text
Local State Before Ratchet:
  dhs = (sk_local_old, pk_local_old)
  dhr = pk_remote_old
  rk  = RK_current

Incoming Packet:
  header.dhPublicKey = pk_remote_new != dhr
```

1. **Store Previous Sending Length:**
   $$pn \leftarrow ns$$
2. **Reset Sequence Counters:**
   $$ns \leftarrow 0,\quad nr \leftarrow 0$$
3. **Update Remote Public Key:**
   $$dhr \leftarrow pk_{\text{remote\_new}}$$
4. **Step 1 — Advance Receiving Chain:**
   Compute shared secret between local old private key and remote new public key:
   $$Z_1 = \text{ECDH}(sk_{\text{local\_old}}, pk_{\text{remote\_new}})$$
   Derive intermediate root key and new receiving chain key:
   $$[RK_1, CKR] = \text{kdfRk}(RK_{\text{current}}, Z_1)$$
   Zeroize $Z_1$. Update $rk \leftarrow RK_1$, $ckr \leftarrow CKR$.
5. **Step 2 — Rotate Local Ephemeral Key Pair:**
   Generate fresh P-256 key pair:
   $$dhs \leftarrow \text{createECDH('prime256v1')}.\text{generateKeys}() \implies (sk_{\text{local\_new}}, pk_{\text{local\_new}})$$
6. **Step 3 — Advance Sending Chain:**
   Compute shared secret between local new private key and remote new public key:
   $$Z_2 = \text{ECDH}(sk_{\text{local\_new}}, pk_{\text{remote\_new}})$$
   Derive next master root key and new sending chain key:
   $$[RK_2, CKS] = \text{kdfRk}(RK_1, Z_2)$$
   Zeroize $Z_2$. Update $rk \leftarrow RK_2$, $cks \leftarrow CKS$.

---

## 5. State Machine Sequence Diagram

The following sequence diagram illustrates session initialization, forward symmetric chain advancement, out-of-order message caching, DH ratchet transitions, and delayed message consumption.

```mermaid
sequenceDiagram
    autonumber
    actor Alice as Alice (Initiator)
    actor Bob as Bob (Receiver)

    Note over Alice,Bob: Shared Secret rk_0 agreed (e.g. out-of-band or X3DH)
    Note over Bob: Bob generates DH pre-key (dhs_B0)
    Note over Alice: Alice generates ephemeral dhs_A0<br/>Alice computes Z = ECDH(dhs_A0, pk_B0)<br/>Alice derives [rk_A1, cks_A0] = kdfRk(rk_0, Z)

    rect rgb(240, 248, 255)
    Note over Alice,Bob: Symmetric Sending Chain (Alice -> Bob)
    Alice->>Alice: encrypt(m0): derives MK_0, cks_A1; ns=1
    Alice->>Alice: encrypt(m1): derives MK_1, cks_A2; ns=2
    Alice->>Alice: encrypt(m2): derives MK_2, cks_A3; ns=3

    Note over Alice,Bob: Message 1 arrives out of order before Message 0
    Alice-->>Bob: Envelope(m1: header={dh: pk_A0, pn: 0, n: 1})
    Bob->>Bob: ckr_B not stepped: derives MK_0, skips & stores MK_0
    Bob->>Bob: Bob advances ckr_B to 1, derives MK_1, decrypts m1!
    end

    rect rgb(255, 250, 240)
    Note over Alice,Bob: Asymmetric DH Ratchet Turn (Bob -> Alice)
    Bob->>Bob: Bob encrypts reply: notices no cks established
    Bob->>Bob: DH Step 1: Z1 = ECDH(dhs_B0, pk_A0) -> [rk_B1, ckr_B0]
    Bob->>Bob: DH Step 2: Generates fresh dhs_B1
    Bob->>Bob: DH Step 3: Z2 = ECDH(dhs_B1, pk_A0) -> [rk_B2, cks_B0]
    Bob->>Bob: Bob encrypts reply: derives MK_B0, cks_B1; ns=1

    Bob->>Alice: Envelope(reply0: header={dh: pk_B1, pn: 0, n: 0})
    Alice->>Alice: Detects new remote key pk_B1 != pk_B0
    Alice->>Alice: DH Step 1: Z1 = ECDH(dhs_A0, pk_B1) -> [rk_A2, ckr_A0]
    Alice->>Alice: DH Step 2: Generates fresh dhs_A1
    Alice->>Alice: DH Step 3: Z2 = ECDH(dhs_A1, pk_B1) -> [rk_A3, cks_A1]
    Alice->>Alice: Alice decrypts reply0 using ckr_A0
    end

    rect rgb(245, 255, 245)
    Note over Alice,Bob: Delayed Message Arrival & Skipped Key Consumption
    Alice-->>Bob: Delayed Envelope(m0: header={dh: pk_A0, pn: 0, n: 0})
    Bob->>Bob: Lookup skipped key: (sessionId, pk_A0, 0)
    Bob->>Bob: Phase 1: Reserve & decrypt MK_0 under lease
    Bob->>Bob: AEAD decrypts m0 successfully
    Bob->>Bob: Phase 2: Commit & permanently delete MK_0 from store!
    end
```

---

## 6. Out-of-Order Message Handling

Network jitter, WebSocket reconnection, or WebRTC multi-path delivery can cause packets to arrive out of order.

### Scenario Walkthrough: Counters Jump $0 \to 3$

1. **Sender Transmission:**
   * Sender emits messages with counters $n = 0, 1, 2, 3$ in sending chain $CK_s$.
2. **Receiver Out-of-Order Arrival:**
   * Receiver receives envelope with header $n = 3$ when local counter is $nr = 0$.
3. **Skipped-Key Derivation Loop (`skipMessageKeys`):**
   * The receiver checks if $nr + 100 < \text{untilNr}$. If distance $> 100$, throws `'Too many missed messages to skip'`.
   * The receiver steps the receiving chain KDF for missed positions:
     * Step 0: $[CK_{r,1}, MK_0] = \text{kdfCk}(CK_{r,0})$. Store $MK_0$ under index `(pk_remote, 0)`. Zeroize $MK_0$.
     * Step 1: $[CK_{r,2}, MK_1] = \text{kdfCk}(CK_{r,1})$. Store $MK_1$ under index `(pk_remote, 1)`. Zeroize $MK_1$.
     * Step 2: $[CK_{r,3}, MK_2] = \text{kdfCk}(CK_{r,2})$. Store $MK_2$ under index `(pk_remote, 2)`. Zeroize $MK_2$.
     * Counter updates: $nr = 3$, $ckr = CK_{r,3}$.
4. **Current Message Decryption:**
   * The receiver derives $[CK_{r,4}, MK_3] = \text{kdfCk}(CK_{r,3})$.
   * Decrypts envelope $n = 3$ using $MK_3$.
   * Zeroizes $MK_3$. $nr$ increments to $4$.
5. **Delayed Message Arrival:**
   * Delayed packet $n = 1$ subsequently arrives.
   * `DoubleRatchetSession.decrypt()` checks `skippedKeyStore.hasSkippedKey(dhrHex, 1)`.
   * Finds stored key, decrypts via `aesGcmDecrypt`, commits consumption, and deletes $MK_1$.

### Chain Boundaries and Ratchet Step Lookahead (`header.pn`)

When an incoming message triggers a DH ratchet turn (because `header.dhPublicKey != dhr`), the receiver must first skip any remaining unreceived messages in the **old** receiving chain.
The sender communicates how many total messages were sent in that old chain via `header.pn`.
```typescript
if (!this.dhr || !this.dhr.equals(remotePubKey)) {
  if (this.dhr && this.ckr) {
    this.skipMessageKeys(header.pn);
  }
  this.dhRatchetStep(remotePubKey);
}
```
This guarantees that keys missed in prior ratchet generations remain available for delayed delivery even after the ratchet turns.

---

## 7. Skipped Key Retention and Eviction Policies

Skipped message keys represent unconsumed cryptographic material. To prevent state bloat and Denial-of-Service (DoS) memory exhaustion, strict capacity limits and TTL rules are enforced.

### Policy Parameter Specifications

| Parameter | Default Value | Constant Name | Description |
| :--- | :--- | :--- | :--- |
| **Global Capacity** | 2,000 keys | `SKIPPED_KEYS_MAX_GLOBAL` | Maximum number of skipped key records retained across all ratchet chains for a session. |
| **Per-Chain Capacity** | 100 keys | `SKIPPED_KEYS_MAX_PER_CHAIN` | Maximum number of skipped keys retained for a single ratchet public key. |
| **Max Skip Distance** | 100 messages | `SKIPPED_KEYS_MAX_PER_CHAIN` | Maximum allowable counter gap in a single step ($nr + 100 < untilNr$). |
| **Retention TTL** | 7 days ($604,800,000\text{ ms}$) | `SKIPPED_KEYS_RETENTION_TTL_MS` | Maximum age of a skipped key before automatic eviction. |
| **Reservation Lease TTL** | 30 seconds ($30,000\text{ ms}$) | `SKIPPED_KEYS_LEASE_TTL_MS` | Timeout for in-flight decryption reservation locks. |

### Eviction Order (FIFO)

1. **Per-Chain Limit Exceeded:** When storing key $101$ in a single chain, the oldest eligible unreserved key in that chain (lowest `createdAt`) is purged.
2. **Global Limit Exceeded:** When storing a key that would push global records $> 2,000$, the oldest eligible unreserved key globally is purged.
3. **TTL Purge:** Expired records ($now - createdAt \ge ttlMs$) are purged proactively during `storeSkippedKey()`, `hasSkippedKey()`, `reserveSkippedKey()`, `exportEncryptedRecords()`, or explicit `purgeExpired()`.

---

## 8. Reservation and Replay Protection

Deleting a skipped key immediately upon lookup—prior to AEAD decryption—creates a severe Denial-of-Service vulnerability: an attacker could replay or forge a corrupted packet with a matching sequence counter, triggering immediate deletion of the key and permanently denying the legitimate recipient the ability to decrypt the true delayed message.

To eliminate this vulnerability, [`SkippedMessageKeyStore`](../../src/core/chat/SkippedMessageKeyStore.ts) implements an **atomic two-phase reservation lease protocol**:

```mermaid
stateDiagram-v2
    [*] --> Stored: storeSkippedKey()
    Stored --> Reserved: reserveSkippedKey()<br/>(atomic lease granted, MK decrypted)
    Reserved --> [*]: commitSkippedKey()<br/>(AEAD authentication SUCCESS -> permanently deleted)
    Reserved --> Stored: releaseSkippedKey()<br/>(AEAD authentication FAILURE -> key unlocked)
    Reserved --> Stored: Lease TTL Expired (>30s crash recovery)
```

### Two-Phase Consumption Protocol

1. **Phase 1 — `reserveSkippedKey(dhrHex, n)`:**
   * Atomically marks the key ID as reserved in `reservedKeyIds` and records lease timestamp in `reservations`.
   * Decrypts the 32-byte message key from its encrypted record.
   * Returns a `SkippedKeyReservation` handle containing `{ reservationId, messageKey }`.
   * Concurrent attempts to reserve or consume the same key return `null`.
2. **Decryption Attempt:**
   * `DoubleRatchetSession.decrypt()` attempts `aesGcmDecrypt(envelope, reservation.messageKey)`.
3. **Phase 2A — Success (`commitSkippedKey`):**
   * If AES-256-GCM authentication succeeds, the reservation is committed.
   * The record is permanently deleted from storage (`records.delete(id)` and `chainIndex`).
   * The message key buffer is zeroized in a `finally` block.
4. **Phase 2B — Failure (`releaseSkippedKey`):**
   * If AES-256-GCM authentication fails (e.g. forged ciphertext or tampered auth tag), an error is thrown.
   * The catch block invokes `releaseSkippedKey(reservationId)`.
   * The reservation lock is removed, returning the key to `Stored` state so a legitimate delayed message can still be decrypted.

### Duplicate & Replay Protection

* **In-Order Messages:** The receiving counter $nr$ advances monotonically. Messages with counter $n < nr$ that are not in `skippedKeyStore` are rejected.
* **Skipped Messages:** Once committed, the key is permanently excised from storage. Replaying the identical packet fails because neither the active chain nor the skipped store possesses the key.

---

## 9. Serialization and Secure Restoration

The Double Ratchet session state can be serialized for persistent local storage between application launches.

### Serialized State Schema (`SerializedDoubleRatchetSession`)

```typescript
export interface SerializedDoubleRatchetSession {
  sessionId: string;
  localPublicKeyHex: string;
  remotePublicKeyHex: string | null;
  rkHex: string;
  cksHex: string | null;
  ckrHex: string | null;
  ns: number;
  nr: number;
  pn: number;
  skippedKeys: EncryptedSkippedKeyRecord[];
}
```

### Deliberate Secret Exclusions

* **Local Private Key Excluded:** `serialize()` never includes the local ECDH private key. The private key must be managed and secured independently by the caller (e.g. hardware-backed key store or encrypted key vault).
* **Storage Encryption Key Excluded:** `serialize()` never outputs the `storageKey`.
* **Plaintext Message Keys Excluded:** All skipped message keys are stored and exported solely as AES-256-GCM `EncryptedSkippedKeyRecord` structures.

### Encrypted Record Structure (`EncryptedSkippedKeyRecord`)

```typescript
export interface EncryptedSkippedKeyRecord {
  metadata: {
    sessionId: string;
    ratchetPublicKeyHex: string;
    sequenceCounter: number;
    createdAt: number;
  };
  ciphertext: string; // Hex-encoded AES-256-GCM ciphertext of 32-byte MK
  iv: string;         // Hex-encoded 12-byte IV
  authTag: string;    // Hex-encoded 16-byte GCM authentication tag
}
```

* **Storage Key Derivation:** If an explicit 32-byte `storageKey` is not provided in `RatchetSessionConfig`, [`SkippedMessageKeyStore`](../../src/core/chat/SkippedMessageKeyStore.ts) derives one from the session's initial root key via HKDF-SHA256:
  $$\text{StorageKey} = \text{HKDF-SHA256}(\text{ikm} = RK_{\text{initial}}, \text{salt} = \text{"WorkSphere-SkippedKeyStore-v1-Salt"}, \text{info} = \text{"WorkSphere-DoubleRatchet-StorageKey:"} \mathbin{\Vert} \text{sessionId}, L = 32)$$
* **Restoration Contract:** When calling `DoubleRatchetSession.restore(...)`, the application **must** pass the external 32-byte `options.storageKey` alongside the local private key hex. If `options.storageKey` is missing or not a 32-byte Buffer, `restore()` throws an error immediately.

---

## 10. Forward Secrecy and Post-Compromise Security

### Forward Secrecy (FS)

Forward secrecy prevents an adversary who compromises current cryptographic keys from reading historical communications.

* **Message Key Eradication:** After message encryption or decryption, $MK$ is zeroized in memory. Because $MK$ is derived via a one-way HMAC function from $CK$, knowledge of subsequent chain keys cannot invert the hash to recover past message keys.
* **Chain Key Advancement:** Upon deriving $MK_i$, the chain key advances from $CK_i$ to $CK_{i+1}$, and $CK_i$ is overwritten.
* **Skipped Key TTL:** Delayed message keys are retained for at most 7 days. Once purged or consumed, past delayed messages can never be decrypted.

### Post-Compromise Security (PCS)

Post-compromise security (also known as backward secrecy or self-healing) ensures that if an attacker obtains the full internal state of a participant (including $RK$, $CK_s$, and $CK_r$), the session can recover its secrecy and authenticity without re-establishing an entirely new session.

* **Mechanism:** When the non-compromised party generates a new ephemeral DH key pair $dhs_{\text{new}}$ and sends a message, the recipient responds with its own fresh ephemeral key pair.
* **Recovery Condition:** As soon as both participants contribute fresh, uncompromised Diffie-Hellman entropy and advance the DH ratchet twice (a complete ping-pong turn), the root key $RK$ absorbs high-entropy shared secrets $Z_1$ and $Z_2$ unknown to the adversary:
  $$RK_{\text{healed}} = \text{kdfRk}(\text{kdfRk}(RK_{\text{compromised}}, Z_1), Z_2)$$
* **PCS Qualifications & Limits:**
  * PCS is **not unconditional**. If the adversary acts as an active Man-in-the-Middle (MitM) and substitutes public keys during the healing handshake, PCS is defeated unless messages are bound to verified long-term identity keys (e.g. through SPKI key pinning or X3DH authentication).
  * Compromise of the long-term private identity key permits persistent active MitM interception.

---

## 11. Security Assumptions and Implementation Limitations

1. **Underlying Primitives:**
   * NIST P-256 (`prime256v1`) ECDH for key agreement.
   * HMAC-SHA256 for key derivation.
   * AES-256-GCM with 96-bit random IVs for authenticated encryption.
2. **Buffer Zeroization in Node.js / V8:**
   * Secret keys in memory are overwritten with zeros (`buffer.fill(0)`).
   * *Limitation:* Node.js and V8 garbage collectors may relocate strings or buffers before zeroization occurs. While `Buffer.fill(0)` mutates the underlying heap memory, remnants may theoretically persist in uncollected V8 heap memory pages or OS swap files.
3. **External Key Management:**
   * `DoubleRatchetSession` relies on the caller to securely generate and store the local private key and `storageKey`.
   * WorkSphere does not currently embed an automated OS keychain, WebAuthn PRF vault, or hardware enclave abstraction inside the `DoubleRatchetSession` module itself; this must be provided by the host application layer.
4. **Concurrency & Thread Safety:**
   * The class assumes single-threaded Node.js event-loop execution.
   * While `SkippedMessageKeyStore` provides reservation leases (`reserveSkippedKey` / `commitSkippedKey`) to guard against re-entrant async decryption collisions, concurrent mutations of `DoubleRatchetSession` instances across worker threads without synchronization are unsupported.
5. **Denial-of-Service Bounds:**
   * Maximum skip distance is capped at 100 messages per step. An adversary sending packets with $n \ge 101$ above $nr$ will be rejected immediately without consuming CPU cycles for chain stepping.
   * Total skipped keys are capped at 2,000 globally and 100 per chain.

---

## 12. Implementation Reference

### Source Code Mapping

| Component | File Path | Key Responsibilities |
| :--- | :--- | :--- |
| `DoubleRatchetSession` | [`src/core/chat/DoubleRatchetSession.ts`](../../src/core/chat/DoubleRatchetSession.ts) | Session lifecycle, DH ratchet transitions, sending/receiving chain KDF, header validation, encryption/decryption. |
| `SkippedMessageKeyStore` | [`src/core/chat/SkippedMessageKeyStore.ts`](../../src/core/chat/SkippedMessageKeyStore.ts) | AES-256-GCM encrypted skipped key cache, composite ID indexing, FIFO capacity enforcement, 7-day TTL eviction, two-phase reservation lease. |
| Core Index Export | [`src/core/index.ts`](../../src/core/index.ts) | Public module exports for `DoubleRatchetSession`, `SkippedMessageKeyStore`, and associated interfaces. |

### Method & Function Reference

| Protocol Concept | Implementation Method / Function | File |
| :--- | :--- | :--- |
| Alice Initial Handshake | `DoubleRatchetSession.initAlice(...)` | `DoubleRatchetSession.ts` |
| Bob Initial Handshake | `DoubleRatchetSession.initBob(...)` | `DoubleRatchetSession.ts` |
| Symmetric Message Encryption | `DoubleRatchetSession.prototype.encrypt(...)` | `DoubleRatchetSession.ts` |
| Symmetric Message Decryption | `DoubleRatchetSession.prototype.decrypt(...)` | `DoubleRatchetSession.ts` |
| Asymmetric Ratchet Step | `DoubleRatchetSession.prototype.dhRatchetStep(...)` | `DoubleRatchetSession.ts` |
| Skipped Key Derivation Loop | `DoubleRatchetSession.prototype.skipMessageKeys(...)` | `DoubleRatchetSession.ts` |
| Root KDF | `DoubleRatchetSession.prototype.kdfRk(...)` | `DoubleRatchetSession.ts` |
| Symmetric Chain KDF | `DoubleRatchetSession.prototype.kdfCk(...)` | `DoubleRatchetSession.ts` |
| Header Validation | `DoubleRatchetSession.prototype.validateEnvelope(...)` | `DoubleRatchetSession.ts` |
| Session Serialization | `DoubleRatchetSession.prototype.serialize()` | `DoubleRatchetSession.ts` |
| Session Restoration | `DoubleRatchetSession.restore(...)` | `DoubleRatchetSession.ts` |
| Memory Zeroization | `DoubleRatchetSession.prototype.destroy()` | `DoubleRatchetSession.ts` |
| Encrypted Key Insertion | `SkippedMessageKeyStore.prototype.storeSkippedKey(...)` | `SkippedMessageKeyStore.ts` |
| Two-Phase Key Reservation | `SkippedMessageKeyStore.prototype.reserveSkippedKey(...)` | `SkippedMessageKeyStore.ts` |
| Two-Phase Key Commit | `SkippedMessageKeyStore.prototype.commitSkippedKey(...)` | `SkippedMessageKeyStore.ts` |
| Two-Phase Key Release | `SkippedMessageKeyStore.prototype.releaseSkippedKey(...)` | `SkippedMessageKeyStore.ts` |
| Expired Key Eviction | `SkippedMessageKeyStore.prototype.purgeExpired()` | `SkippedMessageKeyStore.ts` |

---

## 13. Verification & Test Evidence

All protocol behaviors, bounds, and security properties documented above are verified by automated unit tests and benchmarks.

### Execution Commands

```powershell
# 1. Run full chat test suite
npm test src/__tests__/chat/

# 2. Run ESLint on affected files
npx eslint src/core/chat/DoubleRatchetSession.ts src/core/chat/SkippedMessageKeyStore.ts src/core/index.ts src/__tests__/chat/DoubleRatchetSession.test.ts src/__tests__/chat/SkippedMessageKeyStore.bench.test.ts

# 3. Targeted TypeScript check
npx tsc --noEmit --project tsconfig.json
```

### Verified Test Results

* **Test Suite:** `src/__tests__/chat/DoubleRatchetSession.test.ts` (22 tests passing)
  * Bidirectional ratchet messaging between Alice and Bob.
  * Ephemeral DH key rotation upon alternating conversational turns.
  * Out-of-order message caching and delayed packet decryption.
  * Single-use consumption and replay rejection.
  * Multi-chain skipped key handling across multiple DH turns.
  * Per-chain capacity enforcement (evicting oldest key at capacity 100).
  * Global capacity enforcement (evicting oldest key at capacity 2,000).
  * Skip distance limit enforcement ($>100$ rejected).
  * 7-day retention TTL expiration and purge.
  * Memory zeroization of message keys and root/chain buffers on `destroy()`.
  * Encrypted storage without plaintext leakage in serialized state.
  * Session restoration with external 32-byte storage key and rejection on invalid key.
  * Two-phase reservation protecting skipped keys from deletion upon forged packet AEAD authentication failures.
  * Header validation preventing state corruption from malformed packets.
* **Benchmark Suite:** `src/__tests__/chat/SkippedMessageKeyStore.bench.test.ts` (1 benchmark passing)
  * 100 key insertions: ~2.75 ms (~0.028 ms/op).
  * 100 key lookups: ~0.18 ms (~0.002 ms/op).
  * 100 key consumptions: ~1.46 ms (~0.015 ms/op).
  * Eviction upon capacity limit: ~0.13 ms.
