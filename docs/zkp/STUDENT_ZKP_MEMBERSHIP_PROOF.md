# Zero-Knowledge Student Membership Proof Architecture

**Document Version:** 1.1.0
**Status:** Approved / Technical Reference & RFC
**Scope:** Browser proving, Groth16 circuits, Poseidon commitments, Merkle inclusion proofs, nullifier replay prevention, and verification engine
**Target Reference:** WorkSphere Issue #8011 (`StudentZkpProver.ts` architectural implementation specification)

---

## 1. Overview and Purpose

WorkSphere provides university students with discounted access to coworking spaces, private study pods, and campus-adjacent workspaces while preserving mathematical identity privacy. Traditional student verification models require users to upload student identification numbers, full legal names, academic transcripts, GPA metrics, or unencrypted university email addresses to commercial platforms. This introduces critical privacy risks, compliance liability, and potential tracking across independent physical venues.

To provide verifiable student eligibility with cryptographic zero-knowledge guarantees, WorkSphere implements Zero-Knowledge Succinct Non-Interactive Arguments of Knowledge (zk-SNARKs) using the **Groth16** proof system over the **BN254** (also known as `alt_bn128`) pairing-friendly elliptic curve.

The zero-knowledge membership architecture establishes the following compound statement:
1. **Enrollment**: The prover possesses a private identity secret credential whose leaf commitment is an enrolled leaf in an accredited university's cryptographic Merkle tree for a specific academic epoch (e.g., `2026`).
2. **Knowledge**: The prover demonstrates knowledge of the private witness satisfying the polynomial constraint system without revealing the secret credential or Merkle path.
3. **Double-Claim Prevention**: When using the access pass credential circuit, the prover generates an anonymized nullifier hash bound to their credential and the academic epoch, enabling verifiers to detect and prevent duplicate pass redemptions without linking redemptions to real-world identities.

---

## 2. Scope and Implementation Status

### 2.1 Resolution of `StudentZkpProver.ts`

WorkSphere Issue #8011 references `src/core/zkp/StudentZkpProver.ts`. In the actual codebase:

> [!IMPORTANT]
> The single file `src/core/zkp/StudentZkpProver.ts` **does not exist** in the repository. Instead, the student zero-knowledge membership proving and verification architecture is implemented across modular, specialized subsystems.

The table below maps each architectural responsibility to its actual implementation module:

| Architectural Responsibility | Source Module / File | Status | Notes |
| :--- | :--- | :--- | :--- |
| **Membership Circuit** | `circuits/student_membership.circom` | **Implemented** | 16-level Merkle tree membership proof; public signals: `[root, epoch]`. |
| **Access Pass Circuit** | `circuits/student_access_pass.circom` | **Implemented** | 16-level Merkle tree proof + nullifier derivation; public signals: `[root, epoch, nullifierHash]`. |
| **General Membership Verifier** | `circuits/membership_verifier.circom` | **Implemented** | 16-level paid-membership venue access circuit; public signals: `[root, epoch]`. |
| **Poseidon Primitives** | `src/lib/zkp/poseidon.ts` | **Implemented** | Pure BN254 scalar field Poseidon hash ($t=2, 3, 4$). |
| **Tree & Prover Engine** | `src/lib/zkp/studentMembership.ts` | **Implemented** | In-memory 16-depth tree (`StudentMembershipTree`), zero hashes, node derivation, `snarkjs` proving and verification. |
| **Web Worker Prover** | `src/workers/zkpWorker.ts` | **Implemented** | Dedicated browser Web Worker running `snarkjs.groth16.fullProve` with memory cleanup. |
| **Prover React Hook** | `src/hooks/useZkpStudentProof.ts` | **Implemented** | Prover orchestration, stage tracking, timeout handling ($15\text{s}$ / $30\text{s}$), and exponential retries. |
| **Client Proof Cache** | `src/lib/zkp/proofCache.ts` | **Implemented** | IndexedDB proof cache (`worksphere-zkp-proofs`) storing *generated proofs* (not proving keys), with LRU byte budget. |
| **Pass Claim Endpoint** | `src/app/api/user/claim-student-pass/route.ts` | **Implemented** | Off-chain verification, active university root check, atomic nullifier double-claim guard in PostgreSQL. |
| **Perk Verification Endpoint** | `src/app/api/user/verify-student/route.ts` | **Implemented** | Off-chain verification supporting single-signal, 2-signal, and 3-signal payloads with nullifier tracking. |
| **Multi-Tier Nullifier Ledger** | `src/lib/zkp/nullifierLedger.ts` | **Implemented** | Redis atomic `SET NX` guard with PostgreSQL unique index fallback for venue check-ins. |
| **On-Chain Verifier Contract** | N/A (EVM / Solidity) | **Not Implemented** | Proposed architecture; no Solidity verifier contract exists in the repository. |

---

## 3. Architecture at a Glance

The following diagram illustrates the complete zero-knowledge student membership verification lifecycle across client boundaries, Web Workers, network APIs, and persistent verification ledgers:

```mermaid
flowchart TD
    subgraph ClientPrivateContext["Client Private Context (Browser / Mobile)"]
        direction TB
        Cred["Student Credential Inputs<br/>â€¢ Secret (s)<br/>â€¢ Nullifier Key (k)<br/>â€¢ Epoch (e)<br/>â€¢ Sibling Path Elements [16]<br/>â€¢ Path Direction Indices [16]"]

        subgraph WorkerBoundary["Web Worker Boundary (zkpWorker.ts)"]
            WitnessGen["Witness Calculation<br/>(WASM: student_membership.wasm /<br/>student_access_pass.wasm)"]
            ProvingKey["Groth16 Proving Key<br/>(student_membership.zkey)"]
            Groth16Prover["snarkjs.groth16.fullProve()"]
            CleanMemory["terminateCurveBn128()<br/>Curve Worker & Memory Teardown"]
        end

        LocalCache[("IndexedDB Proof Cache<br/>(worksphere-zkp-proofs)<br/>Caches generated proofs, NOT proving keys")]
    end

    subgraph MathematicalRelations["Mathematical Relations Enforced by Circuit"]
        LeafHash["Leaf Commitment:<br/>C = Poseidon(secret, epoch)"]
        TreeClimb["Merkle Tree Traversal (16 Levels):<br/>DualMux + Poseidon(left, right) == Root"]
        NullifierGen["Nullifier Derivation (Access Pass):<br/>nullifierHash = Poseidon(secret, nullifierKey, epoch)"]
    end

    subgraph VerificationBoundary["Off-Chain Verification Boundary (Server & Ledgers)"]
        OffChainAPI["Next.js Verification APIs<br/>â€¢ /api/user/claim-student-pass<br/>â€¢ /api/user/verify-student"]
        RootRegistry["Active University Root Registry<br/>â€¢ isUniversityMerkleRootActive()<br/>â€¢ UniversityMerkleRoot Table"]
        VKeyJSON["Verification Key Artifacts<br/>(student_membership_vkey.json /<br/>verification_key.json)"]
        SnarkVerify["snarkjs.groth16.verify(vKey, publicSignals, proof)"]

        subgraph ReplayPreventionLedger["Replay Prevention & Nullifier Storage"]
            RedisLedger[("Redis Cache<br/>SET NX with Epoch Expiration")]
            PostgresLedger[("PostgreSQL Database<br/>â€¢ StudentPassNullifier<br/>â€¢ StudentClaimNullifier<br/>(Unique Constraint: [nullifierHash, epoch])")]
        end
    end

    subgraph ProposedOnChain["Proposed On-Chain Layer (Not Implemented)"]
        OnChainContract["StudentMembershipVerifier.sol<br/>Groth16 Pairing Check via AltBn128 Precompile (0x08)"]
    end

    %% Proving Workflow
    Cred -->|Private Witness| WitnessGen
    WitnessGen --> LeafHash
    LeafHash --> TreeClimb
    WitnessGen --> NullifierGen
    WitnessGen -->|Internal Witness| Groth16Prover
    ProvingKey --> Groth16Prover
    Groth16Prover --> CleanMemory
    Groth16Prover -->|Store Generated Proof| LocalCache

    %% Verification Workflow
    Groth16Prover -->|POST Payload: {proof, publicSignals}| OffChainAPI
    OffChainAPI -->|Validate Root & Epoch| RootRegistry
    OffChainAPI -->|Load Matching vKey| VKeyJSON
    VKeyJSON --> SnarkVerify
    OffChainAPI -->|Check & Record Nullifier| ReplayPreventionLedger
    RedisLedger -.->|Fallback on miss/unavailable| PostgresLedger

    %% Proposed Link
    Groth16Prover -.->|Proposed Calldata: A, B, C, signals| OnChainContract
```

---

## 4. Privacy Model and Membership Statement

### 4.1 What the Proof Establishes
The zero-knowledge membership proof mathematically proves that:
1. The prover knows a private identity secret $s \in \mathbb{F}_r$ enrolled at an accredited university.
2. The leaf commitment $C = \text{Poseidon}(s, \text{epoch})$ is included in a Merkle tree of depth 16 rooted at the public signal `root`.
3. The enrollment is valid for the academic epoch `epoch`.
4. (In the access pass circuit) The prover correctly derived the public `nullifierHash` $\eta = \text{Poseidon}(s, k, \text{epoch})$ using their private secret $s$ and private nullifier key $k$.

### 4.2 Confidentiality Guarantees
- **Absence of Sensitive Attributes**: Student ID, legal name, GPA, academic standing, and university email are completely absent from the circuit inputs, private witness, and public signals.
- **Anonymity Set**: The student's specific position in the university tree is masked by the private direction bits (`pathIndices`), making every enrolled student in the depth-16 tree ($2^{16} = 65,536$ capacity) indistinguishable.

### 4.3 Information Revealed Publicly
The proof reveals only:
- `root`: Identifies the issuing institution or campus registry.
- `epoch`: The active academic year/period (e.g., `2026`).
- `nullifierHash`: A deterministic pseudorandom field element bound to $(s, k, \text{epoch})$. It does not reveal identity or permit cross-epoch linkage, but enables detection of duplicate claims within the same epoch.

---

## 5. Public Inputs versus Private Witness

### 5.1 `circuits/student_membership.circom`
- **Circom Main Component**:
  ```circom
  component main {public [root, epoch]} = StudentMembership(16);
  ```
- **Signal Classification**:
  - **Public Inputs**:
    1. `root`: Active university Merkle root ($\mathbb{F}_r$).
    2. `epoch`: Academic year epoch ($\mathbb{F}_r$).
  - **Private Witness**:
    1. `secret`: Student identity secret ($\mathbb{F}_r$).
    2. `pathElements[16]`: Sibling hashes along the Merkle inclusion branch ($\mathbb{F}_r^{16}$).
    3. `pathIndices[16]`: Binary path direction selectors ($\{0, 1\}^{16}$).

### 5.2 `circuits/student_access_pass.circom`
- **Circom Main Component**:
  ```circom
  component main {public [root, epoch, nullifierHash]} = StudentAccessPass(16);
  ```
- **Signal Classification**:
  - **Public Inputs**:
    1. `root`: Active university Merkle root ($\mathbb{F}_r$).
    2. `epoch`: Academic year epoch ($\mathbb{F}_r$).
    3. `nullifierHash`: Unique pass nullifier hash ($\mathbb{F}_r$).
  - **Private Witness**:
    1. `secret`: Student credential secret ($\mathbb{F}_r$).
    2. `nullifierKey`: User nullifier derivation secret ($\mathbb{F}_r$).
    3. `pathElements[16]`: Merkle sibling hashes ($\mathbb{F}_r^{16}$).
    4. `pathIndices[16]`: Binary path direction selectors ($\{0, 1\}^{16}$).

### 5.3 `circuits/membership_verifier.circom`
- **Circom Main Component**:
  ```circom
  component main {public [root, epoch]} = MembershipVerifier(16);
  ```
- **Signal Classification**:
  - **Public Inputs**:
    1. `root`: Active membership Merkle root ($\mathbb{F}_r$).
    2. `epoch`: Membership epoch timestamp / period start ($\mathbb{F}_r$).
  - **Private Witness**:
    1. `identitySecret`: Private member identity secret ($\mathbb{F}_r$).
    2. `pathElements[16]`: Merkle sibling hashes ($\mathbb{F}_r^{16}$).
    3. `pathIndices[16]`: Binary path direction selectors ($\{0, 1\}^{16}$).

---

## 6. Poseidon Commitment Construction

WorkSphere implements Poseidon hashing over the BN254 scalar field in `src/lib/zkp/poseidon.ts`, designed to match `circomlib/circuits/poseidon.circom` exactly.

### 6.1 Field Arithmetic and Permutation Parameters
- **Field Modulus**:
  $$p = 21888242871839275222246405745257275088548364400416034343698204186575808495617$$
- **S-Box**: $\alpha = 5$, computed as $x^5 \pmod p$.
- **Rounds**:
  - Full rounds ($R_F$): $8$ (4 at start, 4 at end).
  - Partial rounds ($R_P$):
    - $t = 2$ (1 input): $56$ rounds
    - $t = 3$ (2 inputs): $57$ rounds
    - $t = 4$ (3 inputs): $56$ rounds
- **Round Constants & MDS Matrix**: Derived lazily via the Grain LFSR stream cipher using the reference Poseidon parameter generator.

### 6.2 Commitment Formulae
1. **Leaf Commitment**:
   $$C = \text{Poseidon}_2([s, e])$$
   - `inputs[0]` = `secret` ($s$)
   - `inputs[1]` = `epoch` ($e$)
2. **Internal Merkle Node**:
   $$\text{Parent} = \text{Poseidon}_2([\text{Left}, \text{Right}])$$
   - `inputs[0]` = `Left` child hash
   - `inputs[1]` = `Right` child hash
3. **Nullifier Hash** (in `student_access_pass.circom`):
   $$\eta = \text{Poseidon}_3([s, k, e])$$
   - `inputs[0]` = `secret` ($s$)
   - `inputs[1]` = `nullifierKey` ($k$)
   - `inputs[2]` = `epoch` ($e$)

---

## 7. Merkle Tree and Inclusion Proof

### 7.1 Tree Construction
- **Depth**: Fixed at 16 levels (`TREE_DEPTH = 16`).
- **Capacity**: $2^{16} = 65,536$ enrolled student leaves per tree.
- **Empty Subtree Hashes**:
  $$\text{zeroHashes}[0] = 0n$$
  $$\text{zeroHashes}[i] = \text{Poseidon}_2([\text{zeroHashes}[i-1], \text{zeroHashes}[i-1]]) \quad \text{for } i \in [1, 16]$$

### 7.2 Merkle Path Representation
- `pathElements`: Array of 16 sibling hashes ($\text{sibling}_0, \dots, \text{sibling}_{15}$).
- `pathIndices`: Array of 16 binary selectors ($0$ indicates the current node is the left child; $1$ indicates the current node is the right child).

### 7.3 Circuit Constraints
In both `student_membership.circom` and `student_access_pass.circom`, tree traversal is constrained via `DualMux`:
```circom
template DualMux() {
    signal input in[2];
    signal input s;
    signal output out[2];

    s * (1 - s) === 0; // Constrains s to {0, 1}
    out[0] <== (in[1] - in[0]) * s + in[0];
    out[1] <== (in[0] - in[1]) * s + in[1];
}
```
For level $i \in [0, 15]$:
$$\text{mux}[i].\text{in}[0] \leftarrow \text{currentHash}[i]$$
$$\text{mux}[i].\text{in}[1] \leftarrow \text{pathElements}[i]$$
$$\text{mux}[i].s \leftarrow \text{pathIndices}[i]$$
$$\text{currentHash}[i+1] \leftarrow \text{Poseidon}_2([\text{mux}[i].\text{out}[0], \text{mux}[i].\text{out}[1]])$$
Enforcing final root equivalence:
$$\text{root} === \text{currentHash}[16]$$

---

## 8. Nullifier Derivation and Replay Protection

### 8.1 Nullifier Derivation Formula
$$\eta = \text{Poseidon}_3([s, k, e])$$
- **Derivation**: Computes a single scalar field element from the student's secret $s$, nullifier key $k$, and academic epoch $e$.
- **Privacy Boundary**: Revealing $\eta$ does not reveal $s$ or $k$. Changing $e$ produces an uncorrelated nullifier value, preventing tracking across different academic years. However, multiple redemptions within the *same* epoch produce identical nullifier values.

### 8.2 Enforcement Mechanisms
WorkSphere enforces replay protection through two independent verification layers:

1. **Redis Atomic Lock (`src/lib/zkp/nullifierLedger.ts`)**:
   - Key: `worksphere:zkp:venue-checkin-nullifier:<epoch>:<nullifierHash>`.
   - Executed via atomic `redis.set(key, venueId, { nx: true, ex: secondsUntilEpochEnds })`.
   - If Redis returns `null`, the claim is classified as `duplicate`.

2. **PostgreSQL Unique Constraints (`prisma/schema.prisma`)**:
   - `StudentPassNullifier` (used in `/api/user/claim-student-pass`):
     ```prisma
     model StudentPassNullifier {
       id            String   @id @default(cuid())
       nullifierHash String
       epoch         Int
       createdAt     DateTime @default(now())

       @@unique([nullifierHash, epoch])
     }
     ```
   - In `/api/user/claim-student-pass`, `prisma.studentPassNullifier.findFirst` checks for existing claims. If found, returns HTTP 409 (`NULLIFIER_ALREADY_CLAIMED`).
   - Insertion and user status update (`isVerifiedStudent: true`) execute inside an atomic `prisma.$transaction`.
   - In `/api/user/verify-student`, `prisma.studentClaimNullifier` catches duplicate insertions via error code `P2002` and returns HTTP 409 (`NULLIFIER_ALREADY_SPENT`).

---

## 9. Groth16 Circuit Architecture and Verification

### 9.1 Verification Pairing Equation
Groth16 proofs consist of elements $\pi_A \in \mathbb{G}_1$, $\pi_B \in \mathbb{G}_2$, and $\pi_C \in \mathbb{G}_1$ on the BN254 curve.

The standard Groth16 verification equation is:
$$e(\pi_A, \pi_B) = e(\alpha, \beta) \cdot e\left(\sum_{i=0}^{\ell} x_i \cdot \text{IC}_i, \gamma\right) \cdot e(\pi_C, \delta)$$

Where:
- $e: \mathbb{G}_1 \times \mathbb{G}_2 \to \mathbb{G}_T$ is the optimal Ate pairing on BN254.
- $\alpha \in \mathbb{G}_1, \beta \in \mathbb{G}_2, \gamma \in \mathbb{G}_2, \delta \in \mathbb{G}_2$, and $\text{IC} \in \mathbb{G}_1^{\ell+1}$ are fixed verification key parameters.
- $x_0 = 1$ is the constant term.
- $x_1, \dots, x_\ell$ are the public inputs in exact signal order:
  - For `student_membership.circom` ($\ell = 2$):
    - $x_1 = \text{root}$
    - $x_2 = \text{epoch}$
  - For `student_access_pass.circom` ($\ell = 3$):
    - $x_1 = \text{root}$
    - $x_2 = \text{epoch}$
    - $x_3 = \text{nullifierHash}$

---

## 10. Witness and Proof Generation Lifecycle

1. **Input Preparation**:
   - `useZkpStudentProof` formats `secret`, `epoch`, `root`, `pathElements`, and `pathIndices` into decimal strings.
2. **Worker Dispatch**:
   - Message posted to Web Worker: `{ type: "prove-student", secret, epoch, root, pathElements, pathIndices }`.
3. **Witness & Proof Execution**:
   - Worker runs `snarkjs.groth16.fullProve` using `/zkp/student_membership.wasm` and `/zkp/student_membership.zkey`.
4. **Timeout Enforcement**:
   - Bound by `withTimeout` ($30\text{ seconds}$ in worker, $15\text{ seconds}$ default in hook).
5. **Memory Teardown**:
   - On completion, cancellation, or error, `terminateCurveBn128()` terminates `globalThis.curve_bn128` to release memory.

---

## 11. Web Worker Protocol

In `src/workers/zkpWorker.ts`:
- **Inbound Messages**:
  - `prove-student` / `prove_student`: Initiates student membership proof generation.
  - `verify` / `verify-student`: Executes browser-side Groth16 verification against `/zkp/student_membership_vkey.json`.
  - `cancel`: Increments generation counter to invalidate active proving runs.
  - `terminate` / `abort`: Releases curve instance and calls `self.close()`.
- **Outbound Messages**:
  - `{ type: "progress", stage: "generating" }`
  - `{ type: "success", proof, publicSignals }`
  - `{ type: "verify_result", isValid }`
  - `{ type: "error", error, code, isOom, isTimeout }`

---

## 12. Proving Key Loading versus Proof Caching

> [!IMPORTANT]
> **Proving Keys are NOT Cached in IndexedDB**: Proving keys (`.zkey`) and WASM binaries (`.wasm`) are static HTTP assets loaded from `/zkp/*` over the network or browser HTTP cache. They are not stored in IndexedDB.

### Actual Caching Behavior:
- **What is cached in IndexedDB (`src/lib/zkp/proofCache.ts`)**:
  - Only **generated proof outputs** (`proof`, `publicSignals`) are stored in `worksphere-zkp-proofs`.
  - Entries are keyed by `${scope}:${commitment}` (e.g., `student-discount:<commitment>`).
  - Storing a proof allows repeat verification requests to bypass the 1â€“3 second proving process.
  - Entries expire after 24 hours (`DEFAULT_MAX_AGE_MS`), become stale after 12 hours (`DEFAULT_FRESH_MS`), and are subject to a 50 MB aggregate byte limit with LRU eviction.

---

## 13. Off-Chain Verification Details

### 13.1 Pass Claim Endpoint (`/api/user/claim-student-pass`)
1. **Auth Guard**: Rejects unauthenticated callers with HTTP 401.
2. **Signal Extraction**:
   - `root = publicSignals[0]`
   - `epoch = Number(publicSignals[1]) || 2026`
   - `nullifierHash = publicSignals[2]` (or explicit parameter).
3. **Replay Check**: Queries `prisma.studentPassNullifier.findFirst({ where: { nullifierHash, epoch } })`. Rejects with HTTP 409 if already claimed.
4. **Active University Root Check**: Calls `isUniversityMerkleRootActive(root, epoch)`. Rejects with HTTP 400 if root is not active.
5. **Key Resolution**: Loads `student_access_pass_vkey.json` if present; falls back to `student_membership_vkey.json` or `verification_key.json`.
6. **Public Signals Length Check**: Validates `publicSignals.length === vKey.nPublic`.
7. **Groth16 Verify**: Calls `snarkjs.groth16.verify(vKey, publicSignals, proof)`.
8. **Atomic Commit**: Records nullifier in `StudentPassNullifier` and sets `isVerifiedStudent: true` on user.

### 13.2 Perk Verification Endpoint (`/api/user/verify-student`)
- Supports batch verification and single-proof verification.
- Validates active university Merkle root.
- Checks `StudentClaimNullifier` for double-spending.
- Executes `snarkjs.groth16.verify` against the appropriate verification key.
- Updates user status and persists nullifier record.

---

## 14. On-Chain Verification

### Current Status: Proposed / Not Implemented
There is no Solidity verifier contract deployed in the repository.

### Proposed Architecture for Future Deployment
- **Contract**: `StudentMembershipVerifier.sol` using standard Groth16 verification via the EVM `alt_bn128Pairing` precompile (`0x08`).
- **Calldata Interface**:
  ```solidity
  function verifyProof(
      uint256[2] memory a,
      uint256[2][2] memory b,
      uint256[2] memory c,
      uint256[3] memory input // [root, epoch, nullifierHash]
  ) public view returns (bool r);
  ```
- **Nullifier Storage**: Mapping `mapping(bytes32 => bool) public spentNullifiers;` to guard against on-chain replay.

---

## 15. Security Considerations and Audit Findings

| Security Dimension | Classification | Detailed Technical Analysis |
| :--- | :--- | :--- |
| **Private Witness Confidentiality** | **Implemented & Verified** | Witness inputs (`secret`, `nullifierKey`, `pathElements`, `pathIndices`) remain strictly on the client/worker thread. |
| **Public Signal Tampering** | **Implemented & Verified** | Public signals are cryptographically bound in the pairing check. Any alteration causes Groth16 verification to fail. |
| **Poseidon Security** | **External Trust Assumption** | Relies on the algebraic and collision-resistance properties of Poseidon over the BN254 scalar field. |
| **Nullifier Replay Prevention** | **Implemented & Verified** | Enforced off-chain via Redis `SET NX` locks and PostgreSQL unique compound constraints (`[nullifierHash, epoch]`). |
| **Active University Root Integrity** | **Implemented & Verified** | Verifiers require roots to match active entries in the database registry or configured defaults (`DEFAULT_ACTIVE_CAMPUS_ROOTS`). |
| **Trusted Setup Ceremony** | **External Trust Assumption (Dev Artifacts)** | Repository scripts (`compile-membership-zkp.sh`, `compile-zkp.sh`) perform local single-contribution setups for development. Production deployments require a verified multi-party computation (MPC) ceremony. |
| **Artifact Freshness & Integrity** | **Partially Implemented** | `src/lib/zkp/artifactFreshness.ts` verifies checksum consistency for premium circuit artifacts. Proving keys served over HTTP lack Subresource Integrity (SRI) hashes. |
| **Web Worker Isolation Limitations** | **External Trust Assumption** | Worker isolation prevents main-thread DOM interference, but a compromised client host can still intercept memory. |

---

## 16. Failure Modes and Operational Limitations

1. **Client Out-of-Memory (OOM)**:
   - Groth16 proof generation in WebAssembly requires substantial memory.
   - Low-end mobile devices may fail with OOM errors; `zkpWorker.ts` classifies these and informs the UI.
2. **Prover Timeouts**:
   - Proof generation takes 1â€“3 seconds on standard desktop hardware, but can exceed 15â€“30 seconds on restricted mobile CPUs. Handled via timeout aborts and retries.
3. **Artifact Availability**:
   - `public/zkp/student_membership.zkey` and `student_membership_vkey.json` exist, but `student_access_pass_vkey.json` is not pre-compiled in `public/zkp/`. The server falls back to `student_membership_vkey.json` or `verification_key.json`.
4. **Stale Roots**:
   - If university roots are rotated upon new student enrollment, proofs generated against prior roots will fail unless a historical root grace period is supported.

---

## 17. Relevant Source Files and Tests

### Circuit Definitions
- `circuits/student_membership.circom`
- `circuits/student_access_pass.circom`
- `circuits/membership_verifier.circom`

### Implementation Modules
- `src/lib/zkp/studentMembership.ts`
- `src/lib/zkp/poseidon.ts`
- `src/lib/zkp/nullifierLedger.ts`
- `src/lib/zkp/proofCache.ts`
- `src/workers/zkpWorker.ts`
- `src/hooks/useZkpStudentProof.ts`
- `src/app/api/user/claim-student-pass/route.ts`
- `src/app/api/user/verify-student/route.ts`

### Relevant Test Suites
- `src/__tests__/zkp/studentMembershipProof.test.ts`
- `src/__tests__/zkp/studentAccessPass.test.ts`
- `src/__tests__/zkp/verifyNullifier.test.ts`
- `src/__tests__/workers/zkpWorker.timeout.test.ts`
- `src/__tests__/hooks/useZkpStudentProof.test.ts`
- `src/__tests__/lib/zkpProofCache.test.ts`

---

## 18. End-to-End Proving and Verification Workflow

```
[University Registrar / Campus Node]
       â”‚
       â”‚ 1. Issues student secret s and publishes Merkle Root R for epoch e
       â–¼
[Student Client (Browser / PWA)]
       â”‚
       â”‚ 2. Initiates pass claim in UI (StudentDiscountVerification.tsx)
       â”‚ 3. Generates Merkle path [p_0..p_15] and pathIndices [i_0..i_15]
       â”‚ 4. Offloads to Web Worker (zkpWorker.ts)
       â”‚ 5. Computes Groth16 proof Ï€ via snarkjs.groth16.fullProve()
       â”‚ 6. Terminates BN128 curve worker to free WASM memory
       â”‚ 7. Caches generated proof in IndexedDB (proofCache.ts)
       â–¼
[Off-Chain Verifier (/api/user/claim-student-pass)]
       â”‚
       â”‚ 8. Receives POST { proof, publicSignals: [root, epoch, nullifierHash] }
       â”‚ 9. Confirms root is active in university registry (isUniversityMerkleRootActive)
       â”‚ 10. Verifies nullifierHash has not been claimed for this epoch
       â”‚ 11. Loads verification key (student_membership_vkey.json)
       â”‚ 12. Executes snarkjs.groth16.verify(vKey, publicSignals, proof)
       â”‚ 13. Commits transaction: records nullifierHash and sets isVerifiedStudent = true
       â–¼
[Verification Completed]
       â”‚
       â”‚ 14. Returns HTTP 200 { verified: true, tier: "STUDENT_DISCOUNT" }
       â”‚ 15. UI displays verified student discount pass badge
```
