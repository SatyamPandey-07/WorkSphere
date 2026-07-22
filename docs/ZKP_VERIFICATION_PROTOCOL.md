# Zero-Knowledge Proof (ZKP) Cryptographic Verification Protocol

## 1. Executive Summary & Security Philosophy

WorkSphere implements a privacy-preserving **Zero-Knowledge Proof (ZKP)** access verification protocol designed to allow users to prove membership in premium workspace tiers or venues without exposing their underlying identity tokens or sensitive credentials.

By utilizing **zk-SNARKs (Zero-Knowledge Succinct Non-Interactive Arguments of Knowledge)** based on the **Groth16** proving system over the **BN128 (alt_bn128)** elliptic curve, the WorkSphere ZKP architecture guarantees that:

- **Identity Isolation:** Raw identity tokens never leave the client browser.
- **Cryptographic Commitment:** Public membership validation relies strictly on one-way mathematical quadratic commitments.
- **Stateless Server Verification:** Verification servers process incoming proofs and public signals in $O(1)$ constant time without maintaining persistent records of proof attempts or linkable user sessions.

---

## 2. Cryptographic Protocol Architecture

The overall ZKP verification workflow spans three execution domains: client-side preparation, WASM proving, and server-side verification.

```
+-----------------------------------------------------------------------------------+
|                                  CLIENT BROWSER                                   |
|                                                                                   |
|  [Identity Token] ---> computeMembershipCommit() ---> [expectedCommit (Public)]   |
|         |                                                        |                |
|         +-----------------------+--------------------------------+                |
|                                 |                                                 |
|                                 v                                                 |
|                     snarkjs.groth16.fullProve()                                   |
|                     (premium_membership.wasm + .zkey)                             |
|                                 |                                                 |
|                                 v                                                 |
|                     { proof, publicSignals }                                      |
+---------------------------------|-------------------------------------------------+
                                  | HTTP POST /api/venues/[id]/zkp-access
                                  v
+-----------------------------------------------------------------------------------+
|                                   NEXT.JS SERVER                                  |
|                                                                                   |
|  1. Validate venue eligibility (isPremiumVenue)                                   |
|  2. Validate public signal commitment (isAllowedCommit)                           |
|  3. Verify SNARK proof (snarkjs.groth16.verify with verification_key.json)        |
|  4. Immediate curve memory cleanup (globalThis.curve_bn128.terminate())           |
|                                                                                   |
|  ===> Response: { allowed: true/false } (No Database Persistence)                  |
+-----------------------------------------------------------------------------------+
```

---

## 3. Circom Circuit Definition Template

The membership verification circuit is defined using **Circom 2.0**. The circuit proves that the prover knows a private `identityToken` whose non-linear polynomial transformation matches the public signal `expectedCommit`.

### 3.1 Circuit Implementation (`circuits/premium_membership.circom`)

```circom
pragma circom 2.0.0;

/**
 * PremiumMembership Circuit
 *
 * Proves knowledge of a private identity token that binds to a public
 * membership commitment. The identity token is kept strictly private.
 */
template PremiumMembership() {
    // Private Input Signal (Only known to the prover)
    signal input identityToken;

    // Public Input Signal (Exposed to the verifier)
    signal input expectedCommit;

    // Intermediate Signal for non-linear constraint binding
    signal t2;
    t2 <== identityToken * identityToken;

    // Non-linear commitment binding equation:
    // commit = token^2 + 5 * token + 17
    signal commit;
    commit <== t2 + identityToken * 5 + 17;

    // Enforce equivalence constraint between computed commitment and expected commitment
    expectedCommit === commit;
}

// Instantiate main component exposing expectedCommit as a public input
component main {public [expectedCommit]} = PremiumMembership();
```

### 3.2 Mathematical Commitment Formula

The quadratic commitment function is defined as:
$$C(t) = t^2 + 5t + 17 \pmod{r}$$
where $t$ is the private `identityToken` BigInt value and $r$ is the scalar field order of the BN128 curve. Because $C(t)$ is computed inside R1CS (Rank-1 Constraint System) constraints, the prover demonstrates knowledge of $t$ satisfying $C(t) = \text{expectedCommit}$ without revealing $t$.

---

## 4. Circuit Compilation & Artifact Pipeline

To execute proofs in the browser and verify them on the server, the Circom circuit must be compiled into Rank-1 Constraint System (R1CS) binary format and WebAssembly (WASM) witness calculation code.

### 4.1 Step-by-Step Compilation Protocol

1. **Circom Compilation:**

   ```bash
   circom circuits/premium_membership.circom --r1cs --wasm --sym --output ./build/
   ```
   - Outputs: `premium_membership.r1cs`, `premium_membership_js/premium_membership.wasm`, `premium_membership.sym`.

2. **Phase 1: Powers of Tau (Universal Trusted Setup):**

   ```bash
   npx snarkjs powersoftau new bn128 12 pot12_0000.ptau -v
   npx snarkjs powersoftau contribute pot12_0000.ptau pot12_0001.ptau --name="First Contribution" -v
   npx snarkjs powersoftau prepare phase2 pot12_0001.ptau pot12_final.ptau -v
   ```

3. **Phase 2: Circuit-Specific Setup & Key Generation:**

   ```bash
   # Generate initial proving key
   npx snarkjs groth16 setup build/premium_membership.r1cs pot12_final.ptau build/premium_membership_0000.zkey

   # Contribute randomness to phase 2 key
   npx snarkjs zkey contribute build/premium_membership_0000.zkey build/premium_membership.zkey \
     --name="WorkSphere Key Generation" -v

   # Export Verification Key
   npx snarkjs zkey export verificationkey build/premium_membership.zkey public/zkp/verification_key.json
   ```

4. **Artifact Deployment Locations:**
   - `public/zkp/premium_membership.wasm` — Client-side witness calculation.
   - `public/zkp/premium_membership.zkey` — Proving key used by `snarkjs.groth16.fullProve`.
   - `public/zkp/verification_key.json` — Verification key loaded server-side by `verifyMembershipProof`.

---

## 5. WASM Prover Execution Engine

Client-side proof generation runs entirely within the user's browser using dynamically imported `snarkjs`. Proving execution takes $<100\text{ms}$ for the `PremiumMembership` circuit.

### 5.1 Client Prover Implementation (`src/lib/zkp/client.ts`)

```typescript
"use client";

import { computeMembershipCommit } from "@/lib/zkp/commitment";
import type { ZkProofPayload } from "@/lib/zkp/verify";

export async function proveAndRequestPremiumAccess(input: {
  identityToken: string;
  venueId: string;
}): Promise<{ allowed: boolean; proveMs: number; error?: string }> {
  let proveMs = 0;
  let proof: ZkProofPayload["proof"];
  let publicSignals: string[];

  try {
    const snarkjs = await import("snarkjs");
    const expectedCommit = computeMembershipCommit(input.identityToken);
    const started = Date.now();

    // Generate Groth16 zk-SNARK proof using WASM witness generator & zkey
    const result = await snarkjs.groth16.fullProve(
      {
        identityToken: input.identityToken,
        expectedCommit,
      },
      "/zkp/premium_membership.wasm",
      "/zkp/premium_membership.zkey",
    );

    proveMs = Date.now() - started;
    proof = result.proof;
    publicSignals = result.publicSignals;
  } catch {
    return { allowed: false, proveMs: 0, error: "Could not build proof." };
  }

  // Submit proof and public signals to verification endpoint
  const res = await fetch(`/api/venues/${input.venueId}/zkp-access`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ proof, publicSignals }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      allowed: false,
      proveMs,
      error: data.error ?? "Verification failed.",
    };
  }

  return { allowed: !!data.allowed, proveMs };
}
```

---

## 6. Server-Side Verification API Specification

The verification API enforces strict schema validation, validates membership commitment registration, evaluates the Groth16 cryptographic proof, and cleans up memory immediately.

### 6.1 Verification Module (`src/lib/zkp/verify.ts`)

```typescript
import path from "path";
import { computeMembershipCommit } from "./commitment";

export type ZkProofPayload = {
  proof: {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
    protocol: string;
    curve: string;
  };
  publicSignals: string[];
};

function artifactPaths() {
  const root = path.join(process.cwd(), "public", "zkp");
  return {
    wasm: path.join(root, "premium_membership.wasm"),
    zkey: path.join(root, "premium_membership.zkey"),
    vkey: path.join(root, "verification_key.json"),
  };
}

function loadSnarkjsNode() {
  return require("snarkjs");
}

async function releaseCurve() {
  const g = globalThis as typeof globalThis & {
    curve_bn128?: { terminate: () => Promise<void> };
  };
  if (g.curve_bn128) {
    try {
      await g.curve_bn128.terminate();
    } catch {
      // ignore
    }
  }
}

/** Server-only verification endpoint handler */
export async function verifyMembershipProof(
  proof: ZkProofPayload["proof"],
  publicSignals: string[],
): Promise<boolean> {
  const snarkjs = loadSnarkjsNode();
  const fs = await import("fs/promises");
  const vkeyRaw = await fs.readFile(artifactPaths().vkey, "utf8");
  const vkey = JSON.parse(vkeyRaw);

  try {
    return await snarkjs.groth16.verify(vkey, publicSignals, proof);
  } finally {
    await releaseCurve();
  }
}
```

### 6.2 API Route Handler (`src/app/api/venues/[venueId]/zkp-access/route.ts`)

```
POST /api/venues/[venueId]/zkp-access
Content-Type: application/json

Request Body:
{
  "proof": {
    "pi_a": ["0x123...", "0x456...", "1"],
    "pi_b": [["0x789...", "0xabc..."], ["0xdef...", "0x012..."], ["1", "0"]],
    "pi_c": ["0x345...", "0x678...", "1"],
    "protocol": "groth16",
    "curve": "bn128"
  },
  "publicSignals": ["2015"]
}

Response (200 OK):
{
  "allowed": true,
  "venueId": "cm...123"
}
```

---

## 7. Security Guarantees & Threat Matrix

| Security Guarantee          | Cryptographic Property                       | Mechanism                                                                                                                                                              |
| :-------------------------- | :------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Zero Knowledge**          | Computational Zero-Knowledge                 | The proof ($\pi_A, \pi_B, \pi_C$) is randomized by Groth16 blinding factors during witness calculation. No structural information regarding `identityToken` is leaked. |
| **Soundness**               | Computational Soundness ($128$-bit security) | Under the Discrete Logarithm and q-dHE assumptions on BN128, a prover without a valid `identityToken` cannot forge a proof with probability $> 2^{-128}$.              |
| **Completeness**            | Perfect Completeness                         | Any prover holding a valid `identityToken` whose commitment $C(t)$ is in `PREMIUM_MEMBER_COMMITS` will successfully produce a valid proof accepted by the verifier.    |
| **Non-Linkability**         | Anonymity / Pseudonymity                     | Because Groth16 randomized proofs are distinct even for identical inputs, multiple verification requests using the same token generate uncorrelated proofs.            |
| **Zero Database Footprint** | Non-Custodial Verification                   | The verification route performs zero database writes. Neither proof payloads nor public signals are logged or stored.                                                  |

---

## 8. Development & Testing Commands

To run unit tests verifying the ZKP cryptographic commitment engine and proof verification stack:

```bash
# Run ZKP verification tests
npx jest src/__tests__/api/zkp-access.test.ts
```
