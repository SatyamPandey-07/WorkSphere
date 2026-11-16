# Zero-Knowledge Proof (Groth16) Architecture & Key Rotation Runbook

**Owner:** Security & Cryptography Engineering  
**Applies To:** `circuits/membership_verifier.circom`, `src/lib/crypto/zkNullifierVerifier.ts`, `/api/zkp/membership/verify`, `/api/auth/zkp/nomad-proof`, `/api/zkp/deepwork`  
**Proof System:** Groth16 over BN128 (`alt_bn128`) via Circom 2.x & SnarkJS  

---

## 1. Overview & Security Guarantees

WorkSphere uses **Groth16 Zero-Knowledge Succinct Non-Interactive Arguments of Knowledge (zk-SNARKs)** so users can prove eligibility—such as verified university student discounts, nomad coworking membership tiers, or deep-work session proofs—without revealing their underlying identity, student ID, wallet address, or Clerk user record.

### Core Cryptographic Properties

| Property | Mechanism in WorkSphere |
| :--- | :--- |
| **Zero-Knowledge (Privacy)** | Private witness inputs (`identitySecret`, `identityNullifier`, Merkle inclusion path siblings) remain strictly inside the client browser's WASM prover (`public/zkp/*.wasm`). |
| **Succinctness** | Constant-size proofs (3 elliptic curve points: $\pi_A \in \mathbb{G}_1$, $\pi_B \in \mathbb{G}_2$, $\pi_C \in \mathbb{G}_1$, ~256 bytes JSON) verified in under 15 ms on Vercel Serverless Functions. |
| **Soundness** | Bound to a multi-party Phase 2 trusted setup ceremony (`*.zkey` + `verification_key.json`). Forging a proof without a valid witness is computationally infeasible under the q-PKE / discrete logarithm assumptions on BN128. |
| **Replay Protection** | Deterministic Poseidon nullifier hash $H(\text{identityNullifier}, \text{externalNullifier})$ persisted in PostgreSQL (`ZkNullifier`) via atomic `ON CONFLICT DO NOTHING` (`src/lib/crypto/zkNullifierVerifier.ts`). |

---

## 2. End-to-End Architecture

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                         CLIENT BROWSER (WASM)                           │
│                                                                         │
│  Private Inputs (Witness):              Public Inputs:                  │
│  • identitySecret                       • merkleRoot                    │
│  • identityNullifier                    • externalNullifier (epoch/tier)│
│  • pathElements[], pathIndices[]        • membershipTier                │
│                 │                                      │                │
│                 ▼                                      ▼                │
│      ┌────────────────────────────────────────────────────┐             │
│      │  membership_verifier.wasm + circuit_final.zkey     │             │
│      │             (snarkjs.groth16.fullProve)            │             │
│      └────────────────────────────────────────────────────┘             │
│                                 │                                       │
│                    { proof, publicSignals, keyVersion }                 │
└─────────────────────────────────┼───────────────────────────────────────┘
                                  │ HTTPS POST
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                VERCEL SERVERLESS VERIFIER (/api/zkp/*)                  │
│                                                                         │
│  1. Schema & Key Version Check  ──► Load verification_key.<version>.json│
│  2. Public Signal Bounds Check  ──► Validate BN128 prime field modulus   │
│  3. Root Freshness Check        ──► Confirm merkleRoot in active window │
│  4. Groth16 Pairing Check       ──► snarkjs.groth16.verify(vk, pub, π)  │
│  5. Atomic Nullifier Burn       ──► PostgreSQL INSERT ... ON CONFLICT   │
│                                     DO NOTHING (Replay Prevention)      │
│  6. Credential / Discount Mint  ──► Issue signed offline passcard / perk│
└─────────────────────────────────────────────────────────────────────────┘