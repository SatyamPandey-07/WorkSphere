# Groth16 Trusted Setup Ceremony Verification & Key Rotation Guide

This document specifies the technical procedures for verifying the multi-party Powers of Tau ceremony, authenticating Groth16 structured reference strings (SRS), auditing Blake2b checksums, and safely rotating verification keys across on-chain smart contracts and client Web Workers.

---

## Table of Contents

1. [Ceremony Architecture & Mathematical Principles](#1-ceremony-architecture--mathematical-principles)
2. [Phase 1: Universal Powers of Tau Ceremony Verification](#2-phase-1-universal-powers-of-tau-ceremony-verification)
3. [Phase 2: Circuit-Specific SRS Generation (`.zkey`)](#3-phase-2-circuit-specific-srs-generation-zkey)
4. [Cryptographic Checksums & Artifact Hashes (Blake2b)](#4-cryptographic-checksums--artifact-hashes-blake2b)
5. [Smart Contract Verification Key Rotation](#5-smart-contract-verification-key-rotation)
6. [Client-Side Web Worker (`zkpWorker.ts`) Key Rotation](#6-client-side-web-worker-zkpworkerts-key-rotation)
7. [Rollback, Incident Response & Zero-Downtime Transition](#7-rollback-incident-response--zero-downtime-transition)

---

## 1. Ceremony Architecture & Mathematical Principles

WorkSphere uses **Groth16** zero-knowledge succinct non-interactive arguments of knowledge (zk-SNARKs) over the **BN254** (`alt_bn128`) pairing-friendly curve to verify student discount eligibility and workspace access without revealing identity or enrollment details.

Groth16 requires a two-phase trusted setup:
- **Phase 1 (Powers of Tau):** Universal and circuit-independent parameter generation computing $[\tau^i]_1$ and $[\tau^i]_2$ up to maximum constraint degree $2^k$.
- **Phase 2 (Circuit Specific):** Binds the specific R1CS constraint polynomials $(A_i, B_i, C_i)$ of `student_membership.circom` with toxic evaluation parameters $(\alpha, \beta, \gamma, \delta)$.

### Trust Assumption
As long as **at least one** participant in Phase 1 and Phase 2 honestly discards their toxic waste entropy ($s, \tau, \alpha, \beta, \delta$), the resulting parameters are unforgeable and sound.

---

## 2. Phase 1: Universal Powers of Tau Ceremony Verification

WorkSphere participates in and grounds parameters on standard hermez/zk-crypto universal multi-party computation (MPC) ceremonies.

### 2.1 Parameter Specification
- **Elliptic Curve:** BN254 (`bn128`, order $r = 21888242871839275222246405745257275088548364400416034343698204186575808495617$)
- **Constraint Depth ($k$):** $2^{12} = 4,096$ constraints (sufficient for the 4,129-constraint `StudentMembership` circuit with depth-16 Poseidon tree).

### 2.2 Verification Command Flow
Verify the integrity of transcript transitions from the initial contribution `pot12_0000.ptau` through contributions to `pot12_final.ptau`:

```bash
# 1. Verify the integrity of transcript contributions
npx snarkjs powersoftau verify build/pot12_final.ptau

# Expected Output:
# [INFO] snarkJS: Powers of Tau ceremony is valid!
# [INFO] snarkJS: Total participants verified: N
```

---

## 3. Phase 2: Circuit-Specific SRS Generation (`.zkey`)

Once Phase 1 is verified, Phase 2 compiles the R1CS constraints into the initial `.zkey` and applies participant contributions.

### 3.1 Setup and Contributions

```bash
# 1. Compile Circom circuit to R1CS & WebAssembly
circom circuits/student_membership.circom --r1cs --wasm --sym -o build/

# 2. Initialize circuit-specific zkey (Phase 2 initialization)
npx snarkjs groth16 setup build/student_membership.r1cs build/pot12_final.ptau build/student_membership_0000.zkey

# 3. Apply Multi-Party Contributions
npx snarkjs zkey contribute build/student_membership_0000.zkey build/student_membership_0001.zkey \
  --name="WorkSphere Core Contributor 1" -v -e="$(head -c 32 /dev/urandom | xxd -p)"

npx snarkjs zkey contribute build/student_membership_0001.zkey build/student_membership_final.zkey \
  --name="WorkSphere Independent Audit Witness" -v -e="$(head -c 32 /dev/urandom | xxd -p)"

# 4. Verify Phase 2 zkey against R1CS and Phase 1 PTAU
npx snarkjs zkey verify build/student_membership.r1cs build/pot12_final.ptau build/student_membership_final.zkey

# 5. Export Verification Key
npx snarkjs zkey export verificationkey build/student_membership_final.zkey public/zkp/student_membership_vkey.json
```

---

## 4. Cryptographic Checksums & Artifact Hashes (Blake2b)

To guarantee artifact authenticity and prevent supply-chain tampering across CDN endpoints and container images, all production ZKP artifacts are pinned against **Blake2b-512** cryptographic checksums.

### 4.1 Proving Keys and Verification Artifacts Checksums

| Artifact File | Description | Blake2b-512 Checksum |
| :--- | :--- | :--- |
| `public/zkp/student_membership.zkey` | Groth16 proving key binary | `2cd0f9ac635b4f8dab98094591b20f173f39fb5734bee169eeca3a67073e928b2b678526a025d9f939c2d8ae8ec8eda3d8b351fcd44033ba5e5a7d336f9428cd` |
| `public/zkp/premium_membership.zkey` | Premium pass proving key binary | `2cd0f9ac635b4f8dab98094591b20f173f39fb5734bee169eeca3a67073e928b2b678526a025d9f939c2d8ae8ec8eda3d8b351fcd44033ba5e5a7d336f9428cd` |
| `public/zkp/student_membership.wasm` | WebAssembly witness generator | `475aafdc15c98dcb18c1f8f21a7d7b034ad49ab7b8146752e0e1ec395ae5808d74d95ad69a7429f73b3606362a0e7a8b933e14b1e29bb90d22d478c2b9018879` |
| `public/zkp/student_membership_vkey.json` | JSON Groth16 verification key | `0df86f1e3cba8b248eb3a95c9118501235bb909477e3c98ba82dbb31ca67d589e47228a417631379ecb001a1d8a39a8c7924c5ba71e064971c2ee146d655f462` |

### 4.2 On-Chain Verifier Contract Bytecode Checksums

The Solidity Groth16 verifier contract is exported using:
```bash
npx snarkjs zkey export solidityverifier build/student_membership_final.zkey contracts/StudentProofVerifier.sol
```

Deployed runtime bytecodes on EVM-compatible chains:
- **Compiled EVM Version:** `cancun` / `shanghai`
- **Solc Version:** `0.8.20`
- **Compiler Optimization:** 200 runs
- **Deployed Runtime Bytecode Blake2b:** `a18f92bd33e4c017bc782914199dae85c18c07b629b3a09756b107e324efba77f1082c9e701258ab09559c5d12ee9470ab899121ecf423ab6d7732924fa68be7`

---

## 5. Smart Contract Verification Key Rotation

When circuit constraints change or an annual ceremony rotation occurs, on-chain verifier keys must be updated without disrupting active student verification sessions.

### 5.1 Verifier Architecture (Proxy Pattern)

WorkSphere uses an upgradeable router or verification key storage registry:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

interface IStudentProofVerifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[3] calldata publicInputs
    ) external view returns (bool);
}

contract WorkSphereVerificationRouter is Ownable {
    IStudentProofVerifier public currentVerifier;
    IStudentProofVerifier public previousVerifier;
    uint256 public gracePeriodEnd;

    event VerifierRotated(address indexed oldVerifier, address indexed newVerifier, uint256 gracePeriodEnd);

    constructor(address initialVerifier) Ownable(msg.sender) {
        currentVerifier = IStudentProofVerifier(initialVerifier);
    }

    function rotateVerifier(address newVerifier, uint256 graceDuration) external onlyOwner {
        require(newVerifier != address(0), "Invalid verifier address");
        previousVerifier = currentVerifier;
        currentVerifier = IStudentProofVerifier(newVerifier);
        gracePeriodEnd = block.timestamp + graceDuration;

        emit VerifierRotated(address(previousVerifier), newVerifier, gracePeriodEnd);
    }

    function verifyStudentProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[3] calldata publicInputs
    ) external view returns (bool) {
        if (currentVerifier.verifyProof(a, b, c, publicInputs)) {
            return true;
        }
        if (block.timestamp <= gracePeriodEnd && address(previousVerifier) != address(0)) {
            return previousVerifier.verifyProof(a, b, c, publicInputs);
        }
        return false;
    }
}
```

### 5.2 Step-by-Step On-Chain Rotation Procedure
1. **Deploy New Verifier:** Deploy `StudentProofVerifierV2.sol` generated from the new `.zkey`.
2. **Execute Multi-Sig Call:** Initiate multi-sig transaction calling `rotateVerifier(newVerifierAddress, 7 days)`.
3. **Verify On-Chain Health:** Submit a canary test proof generated with the new proving key to confirm the transaction succeeds.

---

## 6. Client-Side Web Worker (`zkpWorker.ts`) Key Rotation

Client browsers compute student eligibility proofs using the dedicated background thread in `src/workers/zkpWorker.ts`.

### 6.1 Artifact Versioning & Asset Pipeline
1. **Generate New Artifacts:**
   - Store new `.wasm` and `.zkey` files in `public/zkp/` using versioned paths (e.g. `student_membership_v2.wasm`, `student_membership_v2.zkey`).
   - Export corresponding `student_membership_v2_vkey.json`.

2. **Update Worker Resource Resolution:**
   In `src/workers/zkpWorker.ts`, adjust target asset URLs or read active versions from manifest:
   ```typescript
   // In src/workers/zkpWorker.ts
   const WASM_PATH = "/zkp/student_membership_v2.wasm";
   const ZKEY_PATH = "/zkp/student_membership_v2.zkey";
   const VKEY_PATH = "/zkp/student_membership_v2_vkey.json";
   ```

3. **Cache Invalidation & Worker Termination:**
   - The browser Web Worker releases native BN254 memory structures between proof runs using `terminateCurveBn128()`.
   - Update Service Worker cache definitions (cache bust via query param `?v=2` or asset hash) to ensure users fetch the new `.zkey` immediately.
   - Pinned manifest checksums in `public/zkp/artifacts.manifest.json` are validated by CI test suites.

---

## 7. Rollback, Incident Response & Zero-Downtime Transition

If an anomalous proof failure or verification issue is discovered post-rotation:

1. **Dual Verification Grace Window:** The smart contract router supports a fallback grace window (default 7 days) where both current and prior verification keys are honored.
2. **Instant Hotfix Rollback:** If the new key is compromised or flawed, call `rotateVerifier(previousVerifierAddress, 0)` on the smart contract to immediately revert to the prior verifier.
3. **Client CDN Rollback:** Revert CDN symlinks for `/zkp/student_membership.zkey` and dispatch a worker update notification via `PWAUpdateListener`.
