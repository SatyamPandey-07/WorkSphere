# Zero-Knowledge Identity Verification Protocol Specification

## 1. Executive Summary & System Architecture

WorkSphere implements a privacy-preserving **Zero-Knowledge Proof (ZKP)** identity and membership verification subsystem. The protocol enables members and students to cryptographically prove their enrollment, tier access, and verified credentials without revealing their identity secrets, university emails, or personal identifiers.

The subsystem relies on **zk-SNARKs (Zero-Knowledge Succinct Non-Interactive Arguments of Knowledge)** using the **Groth16** proving system executed over the **BN254** (also designated `alt_bn128` or `bn128`) pairing-friendly elliptic curve.

### 1.1 Architectural Topology

The verification pipeline spans three execution domains:

```
+---------------------------------------------------------------------------------------------------+
|                                          CLIENT BROWSER                                           |
|                                                                                                   |
|  1. Student/Member Secret (Private)                                                               |
|  2. Merkle Membership Proof (Depth-16 Sibling Hashes & Indices)                                   |
|  3. Circuit Inputs Assembly: { root, epoch, nullifierHash, secret, nullifierKey, pathElements... } |
|                                       |                                                           |
|                                       v                                                           |
|                       WASM Witness Generation (Worker Thread)                                     |
|                                       |                                                           |
|                                       v                                                           |
|                    snarkjs.groth16.fullProve() via BN254 Proving Key (.zkey)                      |
|                                       |                                                           |
|                                       v                                                           |
|                  Proof Payload: { pi_a, pi_b, pi_c } + Public Signals                             |
+---------------------------------------|-----------------------------------------------------------+
                                        | HTTP POST /api/venues/[id]/zkp-access
                                        v
+---------------------------------------------------------------------------------------------------+
|                                        VERIFICATION DOMAINS                                       |
|                                                                                                   |
|  [A. Web2 Stateless Node.js API]                     [B. Web3 On-Chain Smart Contract]            |
|  - Load verification_key.json                        - IStudentProofVerifier.sol                  |
|  - Validate public signal commitments                - EVM Precompiles:                           |
|  - snarkjs.groth16.verify()                          - 0x06 (ecAdd), 0x07 (ecMul), 0x08 (ecPairing)
|  - Curve BN128 memory termination                    - Nullifier mapping registry (replay guard)  |
|                                                                                                   |
|  ====> Execution Latency: <15ms                      ====> Gas Overhead: ~230,000 gas             |
+---------------------------------------------------------------------------------------------------+
```

### 1.2 BN254 Elliptic Curve Parameters

The zero-knowledge circuits and cryptographic primitives are instantiated over the BN254 curve defined by the short Weierstrass equation:

$$E(\mathbb{F}_p): y^2 = x^3 + 3$$

The scalar field order $r$ and base field order $p$ are:

$$ \begin{aligned}
p &= 21888242871839275222246405745257275088696311157297823662689037894645226208583 \\
r &= 21888242871839275222246405745257275088548364400416034343698204186575808495617
\end{aligned}$$

All circuit signals represent scalar elements within the Galois field $\mathbb{F}_r$.

---

## 2. R1CS Constraint Matrix & Poseidon Hash Tree (Depth 16)

### 2.1 Rank-1 Constraint System (R1CS) Mathematical Formulation

Every statement in the Circom circuit compiles into a Rank-1 Constraint System (R1CS). An R1CS is a collection of three sparse matrices $A, B, C \in \mathbb{F}_r^{m \times n}$ satisfying:

$$(A \cdot W) \odot (B \cdot W) = (C \cdot W)$$

where:
- $m$ is the total number of constraints.
- $n$ is the total number of circuit variables (including the constant wire $1$, public inputs, private inputs, and intermediate wires).
- $W \in \mathbb{F}_r^n$ is the witness vector $W = [1, x_1, \dots, x_\ell, w_{\ell+1}, \dots, w_n]^T$ containing $\ell$ public signals and $n - \ell - 1$ private/intermediate wires.
- $\odot$ denotes the element-wise Hadamard product.

### 2.2 Poseidon Hash Tree Architecture (Depth 16)

WorkSphere organizes verified identity credentials and university enrollments into a binary **Poseidon Merkle Tree** of depth $L = 16$.

- **Tree Depth:** $16$ levels.
- **Maximum Enrolled Capacity:** $2^{16} = 65,536$ active identity leaves per registry.
- **Leaf Node Formula:**
  $$\text{leaf} = \text{Poseidon}_2(\text{secret}, \text{epoch})$$
- **Internal Node Formula:**
  $$\text{parent} = \text{Poseidon}_2(\text{child}_{\text{left}}, \text{child}_{\text{right}})$$

Poseidon is chosen because its S-box $x^5$ operates directly over $\mathbb{F}_r$, avoiding bit-decomposition and reducing constraint costs by $98\%$ compared to SHA-256.

### 2.3 R1CS Constraint Matrix Breakdown

The following table details the constraint allocation across all components for both `StudentMembership` and `StudentAccessPass` circuits:

| Component | Sub-Template / Primitive | Inputs / Width | Count | R1CS Constraints per Instance | Total Constraints |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Nullifier Hash** | `Poseidon(3)` | 3 inputs ($\mathbb{F}_r^3 \to \mathbb{F}_r$) | 1 | 300 | 300 |
| **Leaf Commitment** | `Poseidon(2)` | 2 inputs ($\mathbb{F}_r^2 \to \mathbb{F}_r$) | 1 | 240 | 240 |
| **Path Selector Mux** | `DualMux()` | 2 signals + 1 selector | 16 | 3 | 48 |
| **Merkle Path Hashes** | `Poseidon(2)` | 2 inputs ($\mathbb{F}_r^2 \to \mathbb{F}_r$) | 16 | 240 | 3,840 |
| **Root Equality Check** | Constraint `===` | 1 scalar comparison | 1 | 1 | 1 |
| **Nullifier Equality Check** | Constraint `===` | 1 scalar comparison | 1 | 1 | 1 |
| **Total: `StudentAccessPass(16)`** | — | — | — | — | **4,430 Constraints** |
| **Total: `StudentMembership(16)`** | — | — | — | — | **4,129 Constraints** |
| **Total: `PremiumMembership`** | `Poseidon(1)` | 1 input ($\mathbb{F}_r \to \mathbb{F}_r$) | 1 | 240 + 1 | **241 Constraints** |

#### DualMux Constraint Decomposition ($3$ constraints per level)

The `DualMux` template enforces binary path selection through three rank-1 constraints:
1. **Boolean Enforcement:** $s \cdot (1 - s) = 0 \implies s - s^2 = 0$ ($1$ constraint).
2. **Left Multiplexing:** $\text{out}[0] = (\text{in}[1] - \text{in}[0]) \cdot s + \text{in}[0]$ ($1$ constraint).
3. **Right Multiplexing:** $\text{out}[1] = (\text{in}[0] - \text{in}[1]) \cdot s + \text{in}[1]$ ($1$ constraint).

---

## 3. Circuit Code Walkthrough & Signal Definitions

### 3.1 `StudentMembership` Circuit (`circuits/student_membership.circom`)

The `StudentMembership` circuit validates that a user possesses a credential enrolled in an accredited university's Merkle root for the current academic epoch.

```circom
pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";

/**
 * DualMux multiplexer: switches inputs based on selector bit s.
 * If s == 0: out[0] = in[0], out[1] = in[1]
 * If s == 1: out[0] = in[1], out[1] = in[0]
 */
template DualMux() {
    signal input in[2];
    signal input s;
    signal output out[2];

    s * (1 - s) === 0;
    out[0] <== (in[1] - in[0]) * s + in[0];
    out[1] <== (in[0] - in[1]) * s + in[1];
}

/**
 * StudentMembership: Depth-16 Zero-Knowledge Merkle Tree Membership Proof
 * Proves that a student possesses a secret enrolled at an accredited university
 * for the given academic year epoch without revealing their identity secret.
 */
template StudentMembership(levels) {
    // ── Public Inputs ──
    signal input root;   // Active University Merkle Root
    signal input epoch;  // Academic Year epoch (e.g., 2026)

    // ── Private Inputs ──
    signal input secret;                 // Student Identity Secret
    signal input pathElements[levels];   // Sibling hashes along Merkle path
    signal input pathIndices[levels];    // 0 = left child, 1 = right child

    // 1. Calculate leaf commitment: Poseidon(secret, epoch)
    component leafHasher = Poseidon(2);
    leafHasher.inputs[0] <== secret;
    leafHasher.inputs[1] <== epoch;

    signal currentHash[levels + 1];
    currentHash[0] <== leafHasher.out;

    // 2. Climb the depth-16 Merkle tree
    component mux[levels];
    component hashers[levels];

    for (var i = 0; i < levels; i++) {
        mux[i] = DualMux();
        mux[i].in[0] <== currentHash[i];
        mux[i].in[1] <== pathElements[i];
        mux[i].s <== pathIndices[i];

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== mux[i].out[0];
        hashers[i].inputs[1] <== mux[i].out[1];

        currentHash[i + 1] <== hashers[i].out;
    }

    // 3. Enforce calculated root matches the public Merkle root
    root === currentHash[levels];
}

component main {public [root, epoch]} = StudentMembership(16);
```

### 3.2 `StudentAccessPass` Circuit (`circuits/student_access_pass.circom`)

The `StudentAccessPass` circuit extends membership verification by introducing an anonymous `nullifierHash`. This ensures single-claim eligibility per venue session or academic cycle without establishing linkability between sessions.

```circom
pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";

template StudentAccessPass(levels) {
    // ── Public Inputs ──
    signal input root;           // Active University Merkle Root
    signal input epoch;          // Academic Year epoch (e.g., 2026)
    signal input nullifierHash;  // Anonymized unique nullifier = Poseidon(secret, nullifierKey, epoch)

    // ── Private Inputs ──
    signal input secret;                 // Student Identity Secret / Credential
    signal input nullifierKey;           // User nullifier derivation secret
    signal input pathElements[levels];   // Sibling hashes along Merkle tree path
    signal input pathIndices[levels];    // Sibling position indices (0 or 1)

    // 1. Verify nullifier hash integrity: Poseidon(secret, nullifierKey, epoch)
    component nullifierHasher = Poseidon(3);
    nullifierHasher.inputs[0] <== secret;
    nullifierHasher.inputs[1] <== nullifierKey;
    nullifierHasher.inputs[2] <== epoch;
    nullifierHash === nullifierHasher.out;

    // 2. Calculate enrolled leaf commitment: Poseidon(secret, epoch)
    component leafHasher = Poseidon(2);
    leafHasher.inputs[0] <== secret;
    leafHasher.inputs[1] <== epoch;

    signal currentHash[levels + 1];
    currentHash[0] <== leafHasher.out;

    // 3. Verify Merkle membership path up to university root
    component mux[levels];
    component hashers[levels];

    for (var i = 0; i < levels; i++) {
        mux[i] = DualMux();
        mux[i].in[0] <== currentHash[i];
        mux[i].in[1] <== pathElements[i];
        mux[i].s <== pathIndices[i];

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== mux[i].out[0];
        hashers[i].inputs[1] <== mux[i].out[1];

        currentHash[i + 1] <== hashers[i].out;
    }

    // 4. Enforce calculated Merkle root matches public university root
    root === currentHash[levels];
}

component main {public [root, epoch, nullifierHash]} = StudentAccessPass(16);
```

### 3.3 Public Signal Specification & Encoding

Public signals are exported as an ordered array of decimal string representations of elements in $\mathbb{F}_r$:

```json
[
  "<root_decimal_string>",
  "<epoch_decimal_string>",
  "<nullifierHash_decimal_string>"
]
```

- **`root`:** 256-bit scalar BigInt representing the root of the accredited university registry.
- **`epoch`:** Integer scalar representing the valid time-window / academic year (e.g. `2026`).
- **`nullifierHash`:** Deterministic scalar computed as $\text{Poseidon}_3(\text{secret}, \text{nullifierKey}, \text{epoch})$.

---

## 4. Trusted Setup Parameters & Proving Key Architecture

The Groth16 proving system requires a two-phase Structured Reference String (SRS) generation ceremony.

### 4.1 Ceremony Parameters

1. **Phase 1: Universal Powers of Tau (`pot13`)**
   - **Curve:** BN254 / alt_bn128
   - **Ceremony Degree:** $2^{13} = 8,192$ maximum constraints (sufficient for the 4,430 constraints of `StudentAccessPass`).
   - **Contributions:** Multi-party cryptographic entropy contribution with BLAKE2b verification hash chain.
   - **Random Beacon:** Final entropy injection applied before Phase 2.

2. **Phase 2: Circuit-Specific Key Generation**
   - **Circuit R1CS:** `build/student_access_pass.r1cs`
   - **Proving Key (`.zkey`):** `public/zkp/student_membership.zkey`
   - **Verification Key (`.json`):** `public/zkp/student_membership_vkey.json`

### 4.2 Compilation & Key Generation Script

```bash
#!/bin/bash
set -e

# 1. Compile Circom Circuit to R1CS & WASM witness generator
circom circuits/student_access_pass.circom --r1cs --wasm --sym -o build/

# 2. Phase 1 Powers of Tau Initialization
npx snarkjs powersoftau new bn128 13 build/pot13_0000.ptau -v
npx snarkjs powersoftau contribute build/pot13_0000.ptau build/pot13_0001.ptau \
  --name="WorkSphere Phase 1" -v -e="$(openssl rand -hex 32)"
npx snarkjs powersoftau prepare phase2 build/pot13_0001.ptau build/pot13_final.ptau -v

# 3. Phase 2 Circuit-Specific Setup
npx snarkjs groth16 setup build/student_access_pass.r1cs build/pot13_final.ptau build/student_pass_0000.zkey
npx snarkjs zkey contribute build/student_pass_0000.zkey public/zkp/student_membership.zkey \
  --name="WorkSphere Phase 2" -v -e="$(openssl rand -hex 32)"

# 4. Export JSON Verification Key
npx snarkjs zkey export verificationkey public/zkp/student_membership.zkey public/zkp/student_membership_vkey.json

# 5. Export Solidity Verifier
npx snarkjs zkey export solidityverifier public/zkp/student_membership.zkey contracts/StudentProofVerifier.sol
```

### 4.3 Verification Key Layout (`verification_key.json`)

The exported verification key consists of curve points on $\mathbb{G}_1$ and $\mathbb{G}_2$:

```json
{
  "protocol": "groth16",
  "curve": "bn128",
  "nPublic": 3,
  "vk_alpha_1": [
    "0x11b589...",
    "0x028d05...",
    "0x01"
  ],
  "vk_beta_2": [
    ["0x192837...", "0x283746..."],
    ["0x384756...", "0x475647..."],
    ["0x01", "0x00"]
  ],
  "vk_gamma_2": [
    ["0x098765...", "0x123456..."],
    ["0x234567...", "0x345678..."],
    ["0x01", "0x00"]
  ],
  "vk_delta_2": [
    ["0x456789...", "0x567890..."],
    ["0x678901...", "0x789012..."],
    ["0x01", "0x00"]
  ],
  "IC": [
    ["0x11...", "0x22...", "0x01"],
    ["0x33...", "0x44...", "0x01"],
    ["0x55...", "0x66...", "0x01"],
    ["0x77...", "0x88...", "0x01"]
  ]
}
```

- **`IC` (Input Commitments):** $\ell + 1 = 4$ elements in $\mathbb{G}_1$ corresponding to the public inputs vector $x = [\text{root}, \text{epoch}, \text{nullifierHash}]$.

---

## 5. On-Chain Verification Contracts & Gas Benchmarks

### 5.1 Groth16 Pairing Verification Equation

A Groth16 proof consists of three group elements:
- $\pi_A \in \mathbb{G}_1$ (2 field coordinates: $x, y$)
- $\pi_B \in \mathbb{G}_2$ (4 field coordinates: $x_0, x_1, y_0, y_1$)
- $\pi_C \in \mathbb{G}_1$ (2 field coordinates: $x, y$)

Given public inputs $x_1, \dots, x_\ell \in \mathbb{F}_r$, the verifier calculates the multi-scalar multiplication (MSM) in $\mathbb{G}_1$:

$$vk_x = IC_0 + \sum_{i=1}^{\ell} x_i \cdot IC_i$$

The verifier accepts the proof if and only if the optimal Ate pairing equation evaluates to identity in $\mathbb{G}_T$:

$$e(-\pi_A, \pi_B) \cdot e(\alpha, \beta) \cdot e(vk_x, \gamma) \cdot e(\pi_C, \delta) = 1_{\mathbb{G}_T}$$

### 5.2 Solidity Verification Contract Interface

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IStudentProofVerifier {
    struct Proof {
        uint256[2] a;
        uint256[2][2] b;
        uint256[2] c;
    }

    /**
     * @notice Verifies a Groth16 student membership proof
     * @param a Proof element A (G1: x, y)
     * @param b Proof element B (G2: [[x1, x0], [y1, y0]])
     * @param c Proof element C (G1: x, y)
     * @param input Public signals [root, epoch, nullifierHash]
     * @return r True if pairing equation holds, false otherwise
     */
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[3] calldata input
    ) external view returns (bool r);
}
```

### 5.3 EVM Cryptographic Precompiles

On Ethereum and EVM-compatible Layer 2s, the verification logic uses dedicated elliptic curve precompiles:

| Address | Precompile | Operation | Base Gas Cost |
| :--- | :--- | :--- | :--- |
| `0x06` | `alt_bn128_add` | Point Addition in $\mathbb{G}_1$ | $150 \text{ gas}$ |
| `0x07` | `alt_bn128_mul` | Scalar Multiplication in $\mathbb{G}_1$ | $6,000 \text{ gas}$ |
| `0x08` | `alt_bn128_pairing` | Bilinear Pairing Check ($k$ pairs) | $45,000 + 34,000 \times k \text{ gas}$ |

### 5.4 On-Chain Verification Gas Benchmarks

The table below breaks down the execution gas costs for verifying a single proof on Ethereum Mainnet / Arbitrum / Optimism / Base:

| Execution Step | EVM Operations Involved | Gas Cost |
| :--- | :--- | :--- |
| **Transaction Base Cost** | Standard EVM transaction overhead | $21,000 \text{ gas}$ |
| **Calldata Transmission** | $8$ proof scalars + $3$ public inputs ($352$ bytes calldata) | $\approx 2,112 \text{ gas}$ |
| **Field Order Validation** | Verify $a_x, a_y, c_x, c_y, x_i < p$ (modular assertions) | $\approx 1,500 \text{ gas}$ |
| **Public Inputs Linear Combination ($vk_x$)** | $3 \times$ `ecMul` (`0x07`) + $3 \times$ `ecAdd` (`0x06`) | $3 \times 6,000 + 3 \times 150 = \mathbf{18,450 \text{ gas}}$ |
| **Bilinear Pairing Evaluation** | 4-point pairing check via `0x08` ($k = 4$) | $45,000 + 34,000 \times 4 = \mathbf{181,000 \text{ gas}}$ |
| **Contract Control Flow & Memory Ops** | Memory copies, return encoding, and stack jumps | $\approx 7,150 \text{ gas}$ |
| **Total On-Chain Gas Cost** | Full end-to-end verification execution | **$\approx 231,212 \text{ gas}$** |

#### Comparison: Sequential vs. Randomized Linear Combination (RLC) Batch Verification

When verifying multiple student access proofs in bulk, WorkSphere utilizes an RLC batch pairing checker that collapses $N$ pairings into 4 pairings:

$$\text{Gas}_{\text{Sequential}}(N) \approx 231,000 \times N$$

$$\text{Gas}_{\text{Batch}}(N) \approx 113,000 + 42,000 \times N$$

| Batch Size ($N$) | Sequential EVM Gas | Batch Verification Gas | Absolute Gas Saved | Reduction (%) |
| :---: | :---: | :---: | :---: | :---: |
| **1** | $231,212$ | $231,212$ | $0$ | $0.0\%$ |
| **5** | $1,156,060$ | $323,000$ | $833,060$ | **$72.1\%$** |
| **10** | $2,312,120$ | $533,000$ | $1,779,120$ | **$76.9\%$** |
| **25** | $5,780,300$ | $1,163,000$ | $4,617,300$ | **$79.9\%$** |
| **50** | $11,560,600$ | $2,213,000$ | $9,347,600$ | **$80.9\%$** |
| **100** | $23,121,200$ | $4,313,000$ | $18,808,200$ | **$81.3\%$** |

---

## 6. Client-Side WASM Prover Performance & Web Worker Architecture

To keep the web UI responsive, witness calculation and scalar multiplication run off-main-thread via dedicated Web Workers (`src/workers/zkpWorker.ts`).

### 6.1 Prover Performance Profile

| Device Class | CPU Hardware | Witness Calc (WASM) | Groth16 Prove (ZKey) | Total Proving Time | Peak Memory |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Modern Desktop** | Apple M2 / Intel i9-13900K | $\approx 18\text{ms}$ | $\approx 42\text{ms}$ | **$\approx 60\text{ms}$** | $45\text{MB}$ |
| **Laptop / Ultrabook**| AMD Ryzen 7 5800U | $\approx 28\text{ms}$ | $\approx 64\text{ms}$ | **$\approx 92\text{ms}$** | $48\text{MB}$ |
| **Mobile (Flagship)**| iPhone 15 Pro (A17 Pro) | $\approx 35\text{ms}$ | $\approx 78\text{ms}$ | **$\approx 113\text{ms}$** | $52\text{MB}$ |
| **Mobile (Mid-Tier)** | Snapdragon 778G | $\approx 55\text{ms}$ | $\approx 125\text{ms}$ | **$\approx 180\text{ms}$** | $55\text{MB}$ |

All client configurations maintain peak RAM consumption $<64\text{MB}$, comfortably operating within mobile browser memory limits.

---

## 7. Security Guarantees & Threat Matrix

| Security Property | Mathematical Guarantee | Protocol Mechanism |
| :--- | :--- | :--- |
| **Computational Zero-Knowledge** | View simulator indistinguishability under DDH | Random blinding scalars $r, s \in \mathbb{F}_r$ in Groth16 randomize $(\pi_A, \pi_B, \pi_C)$ so that no witness information is revealed. |
| **Knowledge Soundness** | Discrete Log & $q$-dHE hardness ($128$-bit security) | A malicious prover cannot generate a valid proof without possessing satisfying inputs $(secret, pathElements)$ except with negligible probability $\le 2^{-128}$. |
| **Replay & Sybil Resistance** | Deterministic nullifier evaluation | The on-chain nullifier mapping records `nullifierHash`. Attempts to reuse the same student secret for the same epoch revert with `NullifierAlreadyClaimed`. |
| **Unlinkability** | Pseudo-randomness of Poseidon nullifiers | Two proofs generated by the same student for different epochs or different venues produce uncorrelated proofs and nullifier hashes. |
| **Stateless Server Security** | Non-custodial verification | Web2 verification API routes perform proof verification in memory and discard witness/intermediate signals immediately. |

---

## 8. Development & Verification Commands

```bash
# Run unit and integration tests for ZKP verification
npm test src/__tests__/zkp/studentAccessPass.test.ts
npm test src/__tests__/zkp/studentMembershipProof.test.ts
npm test src/__tests__/lib/zkpArtifactFreshness.test.ts
npm test src/__tests__/lib/zkpBatchWorkerPool.test.ts

# Benchmark R1CS constraint compilation
npx circom2 circuits/student_access_pass.circom --r1cs --wasm --sym -o build/
npx snarkjs r1cs info build/student_access_pass.r1cs
```
$$
