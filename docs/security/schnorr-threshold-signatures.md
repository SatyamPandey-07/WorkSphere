# Cryptographic Specification: Schnorr Threshold & Multi-Signature Aggregation

> **Document Target:** `docs/security/schnorr-threshold-signatures.md`  
> **Source Target:** [`src/core/crypto/SchnorrThresholdAggregator.ts`](../../src/core/crypto/SchnorrThresholdAggregator.ts)  
> **Test Target:** [`src/__tests__/crypto/SchnorrThresholdAggregator.test.ts`](../../src/__tests__/crypto/SchnorrThresholdAggregator.test.ts)  
> **Related Implementations:** [`src/core/crypto/ThresholdSchnorrMuSig.ts`](../../src/core/crypto/ThresholdSchnorrMuSig.ts), [`src/core/crypto/ThresholdSignatureScheme.ts`](../../src/core/crypto/ThresholdSignatureScheme.ts)  
> **Status:** Production Cryptographic Specification  
> **Issue Reference:** WorkSphere Issue #10106 (closing #10106)

---

## 1. Overview and Architecture

In WorkSphere's decentralized workspace coordination and escrow system, multi-party operations—including escrow settlement, high-value asset transfers, dispute arbitrations, and multi-tenant access control—rely on threshold Schnorr signatures and MuSig2 multi-party signature aggregation.

The `SchnorrThresholdAggregator` provides:

1. **Rogue-Key Resistant Key Aggregation (MuSig2 / BIP 327):** Aggregates participant public keys into a collective group key $P_{\text{agg}}$ using deterministic, domain-separated key coefficients $c_i = H(L \parallel P_i)$.
2. **Two-Round Nonce Exchange:** Uses dual-nonce pairs $(R_{i,1}, R_{i,2})$ per participant to foil Wagner's generalized birthday paradox attacks while enabling two-round signing.
3. **Rigorous Curve & Input Validation:** Strict validation of coordinates on the **secp256k1** elliptic curve, verifying $y^2 = x^3 + 7 \pmod p$, coordinate range checks, and non-infinity guarantees.
4. **Duplicate & Race Condition Protection:** Rejection of duplicate or conflicting nonce commitments and concurrent partial signature submissions for the same signer index/identifier.
5. **Attributable Partial Signature Verification & Batch Verification:** Verification of individual partial signatures prior to aggregation, paired with randomized multi-scalar batch verification for high throughput.
6. **BIP 340 64-Byte Standard Signatures:** Emits standard 64-byte Schnorr signatures $(R_x \parallel s)$ verifying against $P_{\text{agg}}$ indistinguishable from single-signer signatures on-chain.

---

## 2. Mathematical Foundations on secp256k1

### 2.1 Curve Parameters

The aggregator operates over the Koblitz curve **secp256k1**, defined over the prime field $\mathbb{F}_p$ by the short Weierstrass equation:

$$y^2 = x^3 + 7 \pmod p$$

The standardized domain parameters are:

- **Base Field Modulus ($p$):**
  $$p = 2^{256} - 2^{32} - 977 = \text{0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F}$$
- **Group Order ($n$):**
  $$n = \text{0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141}$$
- **Generator Point ($G$):**
  $$G = (G_x, G_y)$$
  $$ \begin{aligned}
  G_x &= \text{0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798} \\
  G_y &= \text{0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8}
  \end{aligned}$$
  $$
- **Cofactor ($h$):** $h = 1$
- **Identity Element ($\mathcal{O}$):** Point at infinity, represented as $\{ x: 0n, y: 0n \}$.

### 2.2 Point Arithmetic & Validation

All point operations strictly follow affine coordinate arithmetic:

- **Point Addition ($P_1 + P_2$):**
  If $P_1 = \mathcal{O}$, return $P_2$. If $P_2 = \mathcal{O}$, return $P_1$.  
  If $x_1 = x_2$ and $y_1 \neq y_2$, return $\mathcal{O}$.  
  If $P_1 = P_2$ (doubling), $\lambda = \frac{3x_1^2}{2y_1} \pmod p$.  
  If $P_1 \neq P_2$ (addition), $\lambda = \frac{y_2 - y_1}{x_2 - x_1} \pmod p$.  
  $x_3 = \lambda^2 - x_1 - x_2 \pmod p$, $y_3 = \lambda(x_1 - x_3) - y_1 \pmod p$.
- **Scalar Multiplication ($k \cdot P$):** Executed using standard double-and-add binary ladder algorithm.
- **Curve Point Validation (`validatePoint`):**
  Before any public key or nonce point is accepted, the aggregator checks:
  1. Coordinate types are non-negative `bigint`.
  2. Range: $0 \le x < p$ and $0 \le y < p$.
  3. On-curve condition: $y^2 \equiv x^3 + 7 \pmod p$.
  4. Point at infinity: rejected unless `allowInfinity` is explicitly enabled.

---

## 3. Protocol Flow & Sequence Diagram

The signing process is split into two distinct rounds with strict session state transitions:
`INIT` $\to$ `NONCES_EXCHANGED` $\to$ `PARTIALS_COLLECTED` $\to$ `FINALIZED` (or `ABORTED`).

```mermaid
sequenceDiagram
    autonumber
    actor Alice as Participant 1 (Alice)
    actor Bob as Participant 2 (Bob)
    participant Coord as SchnorrThresholdAggregator
    actor Verifier as Verifier / Smart Contract

    Note over Alice,Coord: Phase 0: Session Setup & Key Aggregation
    Coord->>Coord: Compute L = SHA256(P_1 || ... || P_n)
    Coord->>Coord: Derive c_i = SHA256(L || P_i) mod n
    Coord->>Coord: P_agg = sum(c_i * P_i)
    Coord->>Coord: State = INIT

    Note over Alice,Coord: Round 1: Nonce Exchange
    Alice->>Alice: Generate r1, r2 in Zn; R1 = r1*G, R2 = r2*G
    Bob->>Bob: Generate r1, r2 in Zn; R1 = r1*G, R2 = r2*G
    Alice->>Coord: submitNonces(sessionId, {R1, R2})
    Coord->>Coord: validatePoint(R1), validatePoint(R2)
    Coord->>Coord: Check duplicate / conflicting nonce
    Bob->>Coord: submitNonces(sessionId, {R1, R2})
    Coord->>Coord: validatePoint(R1), validatePoint(R2)
    Coord->>Coord: All nonces received -> compute b = H(P_agg || R1_agg || R2_agg || m)
    Coord->>Coord: Compute R_agg = sum(R_i,1 + b * R_i,2)
    Coord->>Coord: State = NONCES_EXCHANGED

    Note over Alice,Coord: Round 2: Partial Signature Collection
    Coord->>Alice: Broadcast R_agg, b
    Coord->>Bob: Broadcast R_agg, b
    Alice->>Alice: e = H(BIP0340/challenge || R_agg.x || P_agg.x || m)
    Alice->>Alice: s_alice = (r1 + b*r2 + e * c_alice * x_alice) mod n
    Bob->>Bob: s_bob = (r1 + b*r2 + e * c_bob * x_bob) mod n
    Alice->>Coord: submitPartialSignature(sessionId, 'alice', s_alice)
    Coord->>Coord: Check inFlightSubmissions & duplicate share
    Coord->>Coord: verifyPartialSignature(s_alice * G == R_alice + e * c_alice * P_alice)
    Bob->>Coord: submitPartialSignature(sessionId, 'bob', s_bob)
    Coord->>Coord: verifyPartialSignature(s_bob * G == R_bob + e * c_bob * P_bob)
    Coord->>Coord: Threshold satisfied with strictly unique signers
    Coord->>Coord: State = PARTIALS_COLLECTED

    Note over Coord,Verifier: Phase 3: Final Aggregation & Verification
    Coord->>Coord: s_total = sum(s_i) mod n
    Coord->>Coord: signature = [R_agg.x (32B) || s_total (32B)]
    Coord->>Coord: State = FINALIZED
    Coord->>Verifier: verifyAggregatedSignature(message, signature, P_agg)
    Verifier->>Verifier: Check s * G == R + e * P_agg
    Verifier-->>Coord: VALID
```

---

## 4. Cryptographic Mechanics

### 4.1 MuSig2 Key Aggregation

To prevent **rogue-key attacks** (where an attacker crafts $P_n = P_{\text{adv}} - \sum_{i=1}^{n-1} P_i$ to cancel others' keys), each participant key is scaled by a hash coefficient:

1. **Multiset Key Hash:**
   $$L = \mathcal{H}_{\text{keyagg\_list}}(P_1 \parallel P_2 \parallel \dots \parallel P_n)$$
2. **Participant Scaling Factor:**
   $$c_i = \mathcal{H}_{\text{keyagg\_coef}}(L \parallel P_i) \pmod n$$
3. **Aggregated Public Key:**
   $$P_{\text{agg}} = \sum_{i=1}^{n} c_i \cdot P_i$$

### 4.2 Two-Round Nonce Protocol

In MuSig2, each participant samples two secret nonces $r_{i,1}, r_{i,2} \xleftarrow{\$} \mathbb{Z}_n$ and reveals commitments:

$$R_{i,1} = r_{i,1} \cdot G, \quad R_{i,2} = r_{i,2} \cdot G$$

The coordinator aggregates nonces and binds them via factor $b$:

$$b = \mathcal{H}_{\text{nonce\_bind}}(P_{\text{agg}} \parallel \vec{R}_1 \parallel \vec{R}_2 \parallel m) \pmod n$$

The effective participant nonce commitment is:

$$R_i = R_{i,1} + b \cdot R_{i,2}$$

The aggregate group commitment is:

$$R = \sum_{i=1}^{n} R_i$$

If $R_y$ is not a quadratic residue (or odd in BIP 340 conventions), the nonces and private shares are appropriately negated.

### 4.3 Partial Signature Generation & Verification

The Fiat-Shamir challenge is computed according to BIP 340:

$$e = \mathcal{H}_{\text{BIP0340/challenge}}(R_x \parallel P_{\text{agg}, x} \parallel m) \pmod n$$

Each participant computes their partial signature:

$$s_i = r_{i,1} + b \cdot r_{i,2} + e \cdot c_i \cdot x_i \pmod n$$

The coordinator verifies each partial signature before inclusion:

$$s_i \cdot G \stackrel{?}{=} R_i + (e \cdot c_i \pmod n) \cdot P_i$$

### 4.4 Randomized Multi-Scalar Batch Verification

To verify $m$ partial signatures simultaneously in $O(1)$ group multiscalar exponentiations:

1. Sample random independent weights $z_i \xleftarrow{\$} [1, 2^{128}]$.
2. Verify:
   $$\left( \sum_{i=1}^m z_i s_i \right) \cdot G \stackrel{?}{=} \sum_{i=1}^m z_i \cdot \left( R_i + e \cdot c_i \cdot P_i \right)$$
3. If batch verification fails, fallback to individual verification to isolate the exact malicious participant ID.

---

## 5. Security & Threat Mitigation Matrix

| Threat / Attack Vector                    | Severity | Vulnerability Mechanism                                                              | Mitigation in WorkSphere                                                                                                     |
| :---------------------------------------- | :------- | :----------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------- |
| **Rogue-Key (Key Cancellation)**          | Critical | Attacker sets $P_k = P^* - \sum P_i$ to sign unilaterally.                           | MuSig2 key coefficients $c_i = H(L \parallel P_i)$ ensure linear independence of public keys.                                |
| **Wagner Generalized Birthday Attack**    | High     | Concurrent signing sessions allow linear relations across single nonces.             | Two-round dual nonce commitments $(R_1, R_2)$ with dynamic binding factor $b$.                                               |
| **Nonce Reuse (Private Key Leak)**        | Critical | Using identical $(r_1, r_2)$ across different messages reveals $x_i$.                | CSPRNG random generation; once committed, nonces cannot be re-used or updated.                                               |
| **Duplicate Nonce Overwrite**             | High     | Re-submitting nonces overwrites state in `INIT`.                                     | Idempotent duplicate check: identical rejected as duplicate, differing rejected as conflicting duplicate.                    |
| **Concurrent Race Condition in Partials** | High     | Concurrent async `submitPartialSignature` calls bypass validation and inflate count. | In-flight submission locks (`inFlightSubmissions`) + strict uniqueness check on `session.partialSignatures`.                 |
| **Premature Threshold Fulfillment**       | High     | Duplicate shares from one signer fulfill $t$-of-$n$ count.                           | Threshold requires strictly distinct participant keys in `session.partialSignatures`.                                        |
| **Invalid Curve Point / Small Subgroup**  | High     | Off-curve coordinates cause point multiplication leakage or invalid math.            | Explicit `validatePoint`: checks non-negative bigint, range $[0, p-1]$, on-curve $y^2 = x^3 + 7 \pmod p$.                    |
| **Session State Injection / Mutation**    | Medium   | Calling methods in improper session states.                                          | State machine enforces sequential transitions: `INIT` $\to$ `NONCES_EXCHANGED` $\to$ `PARTIALS_COLLECTED` $\to$ `FINALIZED`. |
| **Memory Exhaustion (DoS)**               | Medium   | Incomplete sessions linger indefinitely.                                             | Automatic 5-minute TTL eviction via background cleanup timer (`cleanupExpiredSessions`).                                     |

---

## 6. Error Handling & Validation Reference

| Operation                | Condition                                       | Thrown Error Message                                                            | Session State Effect                           |
| :----------------------- | :---------------------------------------------- | :------------------------------------------------------------------------------ | :--------------------------------------------- |
| `createSession`          | Empty participants list                         | `"Cannot create session with empty participants list."`                         | No session created                             |
| `createSession`          | Invalid threshold ($t < 1$ or $t > n$)          | `"Invalid threshold <t>: must be an integer between 1 and <n>."`                | No session created                             |
| `submitNonces`           | Nonce point not on secp256k1 curve              | `"Invalid secp256k1 point for participant <id> nonce R<1/2>"`                   | Nonce rejected; session remains in `INIT`      |
| `submitNonces`           | Identical duplicate nonce submission            | `"Duplicate nonce commitment rejected for participant <id>."`                   | Existing nonce preserved; state remains `INIT` |
| `submitNonces`           | Conflicting duplicate nonce submission          | `"Conflicting duplicate nonce commitment rejected for participant <id>."`       | Existing nonce preserved; state remains `INIT` |
| `submitPartialSignature` | Wrong session state ($\neq$ `NONCES_EXCHANGED`) | `"Cannot submit partial signature in state <state>."`                           | Submission rejected                            |
| `submitPartialSignature` | Duplicate partial signature for same signer     | `"Duplicate partial signature rejected from participant <id>."`                 | Rejected; accepted share preserved             |
| `submitPartialSignature` | In-flight concurrent submission for same signer | `"Duplicate partial signature rejected from participant <id>."`                 | Rejected immediately                           |
| `submitPartialSignature` | Cryptographically invalid / corrupted share     | `"Malicious or invalid partial signature rejected from participant <id>."`      | Share rejected; not counted toward threshold   |
| `aggregateSignature`     | State $\neq$ `PARTIALS_COLLECTED`               | `"Cannot aggregate in state <state>. All partial signatures must be verified."` | Aggregation halted                             |

---

## 7. Implementation Compliance & Verification

- **Unit & Concurrency Tests:** [`src/__tests__/crypto/SchnorrThresholdAggregator.test.ts`](../../src/__tests__/crypto/SchnorrThresholdAggregator.test.ts)
  - Validates curve primitives (point doubling, addition, scalar multiplication).
  - Verifies MuSig2 deterministic rogue-key resistant key aggregation.
  - Verifies two-round nonce exchange and challenge computation.
  - Verifies rejection of off-curve points, invalid scalars, and infinity.
  - Verifies duplicate/conflicting nonce rejection and session state preservation.
  - Verifies concurrent duplicate partial signature rejection and strict distinct signer threshold fulfillment.
  - Verifies end-to-end BIP 340 64-byte signature aggregation and verification.
