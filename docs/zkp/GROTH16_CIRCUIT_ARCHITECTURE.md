# Groth16 Circuit Architecture for Privacy-Preserving Student Discounts

## 1. Overview & Privacy Model

WorkSphere verifies student discount eligibility using zero-knowledge proofs (ZKPs) so users can prove membership in an approved academic domain without disclosing their email address prefix (local-part) or personal identifier to the verifier or smart contract.

* **Private inputs (witness):** `emailPrefix`, `emailDomain`, `salt`, `merklePathElements[]`, `merklePathIndices[]`, `currentTimestamp`.
* **Public signals (ordered):** `[merkleRoot, domainHash, expirationTimestamp]`.
* **Privacy guarantee:** The verifier learns only that the prover holds a valid preimage belonging to an approved domain in `merkleRoot` whose `domainHash` matches the claimed academic domain and whose eligibility has not passed `expirationTimestamp`.

---

## 2. Circom R1CS Constraint System

A Groth16 circuit compiles into a **Rank-1 Constraint System (R1CS)** over the scalar field $\mathbb{F}_r$:

$$
(A \cdot w) \circ (B \cdot w) = (C \cdot w)
$$

where:
* $w \in \mathbb{F}_r^m$ is the witness vector combining `1` (constant wire), public inputs/outputs, private inputs, and intermediate signals.
* $A, B, C \in \mathbb{F}_r^{n \times m}$ are constraint matrices for $n$ R1CS constraints and $m$ signals.
* $\circ$ denotes element-wise Hadamard product modulo $r$.

### Constraint Breakdown for Academic Domain Verification

1. **Boolean & bit-width enforcement:** Every selector bit $s_i \in \{0, 1\}$ and range-checked signal is constrained via quadratic checks $s_i \cdot (1 - s_i) = 0$ so bit decomposition cannot be forged across field wrap-around.
2. **Domain binding & hash commitment:** Constrain `domainHash` as a deterministic hash (e.g., Poseidon over $\mathbb{F}_r$) of the canonicalized `emailDomain` field elements, independent of `emailPrefix`, so revealing `domainHash` leaks nothing about the user's local address.
3. **Approved domain Merkle inclusion:** For each tree level $k \in [0, d - 1]$, enforce directional path selection (`pathIndices[k] \in \{0, 1\}`) and hash sibling pairs up to `merkleRoot`, binding the prover's domain leaf to the approved academic registry root.
4. **Expiration & validity window:** Enforce `expirationTimestamp > currentTimestamp` (via bounded comparator / `LessThan` gadgets) so expired student credentials cannot generate valid discount proofs.

---

## 3. BN254 (`alt_bn128`) Pairing Arithmetic & Trusted Setup Phases

Groth16 verification in WorkSphere targets the **BN254** (`alt_bn128`) pairing-friendly elliptic curve:

* **Base & scalar fields:** Operations run over prime field $\mathbb{F}_p$ ($p \approx 254$ bits) for curve points $E(\mathbb{F}_p)$, $\mathbb{F}_{p^2}$ extension tower for $\mathbb{G}_2$, and scalar field $\mathbb{F}_r$ for witness arithmetic and circuit constraints.
* **Bilinear pairing check:** A Groth16 proof $\pi = (A, B, C) \in \mathbb{G}_1 \times \mathbb{G}_2 \times \mathbb{G}_1$ with public input linear combination $\text{vk}_x \in \mathbb{G}_1$ verifies via:

$$
e(A, B) = e(\alpha, \beta) \cdot e(\text{vk}_x, \gamma) \cdot e(C, \delta)
$$

* **Phase 1 (Powers of Tau — circuit-independent):** Generates universal structured reference string (SRS) powers of $\tau$ in $\mathbb{G}_1$ and $\mathbb{G}_2$ across multi-party contributions so that as long as at least one participant destroys their toxic waste, the ceremony remains sound.
* **Phase 2 (Circuit-specific `zkey` setup):** Compiles the student discount `.r1cs` against the chosen Phase 1 `.ptau` power, samples circuit-specific toxic waste $(\alpha, \beta, \gamma, \delta)$, and records multi-party contributions before exporting the proving key (`.zkey`) and verification key (`verification_key.json`).

---

## 4. Client-Side Witness Generation in Web Workers (SnarkJS)

To keep the UI responsive during proof synthesis:

* **Off-main-thread execution:** `zkpWorker` loads `.wasm` and `.zkey` artifacts in a dedicated Web Worker and runs `snarkjs.groth16.fullProve(input, wasmPath, zkeyPath)` without blocking rendering or input events.
* **Memory & buffer hygiene:** Allocate sufficient initial WebAssembly memory pages on constrained devices, catch `RangeError` / `WebAssembly.RuntimeError` memory limits gracefully, and clear/zero temporary witness buffers immediately after synthesis.

---

## 5. Smart Contract & API Verification Endpoint

Both on-chain verifiers and backend API routes must validate the proof **and** all three public signals before granting a student discount:

1. **Allowed `merkleRoot` check:** Confirm `publicSignals[0]` (`merkleRoot`) matches a current or recently rotated governance-approved academic domain root.
2. **Expected `domainHash` check:** Verify `publicSignals[1]` (`domainHash`) is non-zero and corresponds to an eligible academic domain policy.
3. **Freshness / `expirationTimestamp` check:** Verify `publicSignals[2]` (`expirationTimestamp`) is greater than the current server/block timestamp (`nowSeconds`) and within maximum allowed discount validity duration.
4. **Groth16 pairing verification:** Run `groth16.verify(vKey, [merkleRoot, domainHash, expirationTimestamp], proof)` and reject any proof with mismatched signal length or invalid curve coordinates.

---

## 6. Performance Benchmarks (Mobile vs. Desktop)

| Environment | Witness + Proof Synthesis | Client Verification | Peak Memory Footprint | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Desktop (modern multi-core, Chrome/Edge)** | ~1.2s – 3.5s | ~15ms – 40ms | ~180 MB – 320 MB | Fast WASM + multi-threaded worker execution |
| **Mid/Low-end Mobile (Web Worker)** | ~4.5s – 12.0s | ~40ms – 110ms | ~120 MB – 260 MB (bounded) | Requires Wasm memory headroom & OOM guard on low-RAM phones |

---

## 7. Vulnerability Assessment & Mitigations

* **Proof malleability:** In standard Groth16, a valid proof $(A, B, C)$ can be randomized by scaling/inverting elements with a random scalar $r \in \mathbb{F}_r^\times$ unless bound to context. Mitigate by tying discount redemption / nullifier / order context to the transaction or application session so a re-randomized proof cannot be replayed across different accounts or orders.
* **Under-constrained signals:** Missing constraints on intermediate wires or boolean flags allow a malicious prover to supply witness values that satisfy some equations while leaving public/private relationships unconstrained. Mitigate with explicit `<==` / `===` constraints, bit-enforcement checks, and `circom --inspect` / witness constraint audits.
* **Stale or future-manipulated `expirationTimestamp`:** If the verifier trusts a client-supplied timestamp without checking against server/chain time or enforcing a max TTL bound, expired discounts could be accepted. Always enforce `expirationTimestamp > currentTime` on the verifier side.
* **Unpinned or outdated `merkleRoot`:** Accepting arbitrary `merkleRoot` values in `publicSignals` allows forged roots. Pin allowed roots in contract state or backend config with a bounded grace window during root updates.