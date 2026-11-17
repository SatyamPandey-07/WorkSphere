# Student Passcard Groth16 Circuit: Formal Relation, Soundness, and Benchmarks

- **Related issue:** [#7771](https://github.com/SatyamPandey-07/WorkSphere/issues/7771)
- **Source circuit:** [`circuits/student_access_pass.circom`](../../circuits/student_access_pass.circom)
- **Companion circuits:** `student_membership.circom` and `membership_verifier.circom`
- **Status:** Source-level formalization. The student passcard circuit does not currently have a matching checked-in WASM/zkey/verification-key artifact set or a benchmark result in this repository.

## 1. What the circuit actually proves

The student passcard source circuit is `StudentAccessPass(16)`. Its public inputs are:

[
x=(root, epoch, nullifierHash)
]

Its private witness is:

[
w=(secret, nullifierKey, pathElements[16], pathIndices[16]).
]

The circuit checks that:

1. the private secret and public epoch form a leaf commitment;
2. the leaf is included in the binary Poseidon Merkle tree whose public root is `root`;
3. every Merkle-path direction selector is a bit; and
4. the public nullifier is correctly derived from the private secret, nullifier key, and epoch.

The circuit does **not** receive a university signature, public signing key, signed credential, venue identifier, or range-proof witness. Therefore it does not itself prove signature validity, real-world student status, age/range predicates, or venue-specific authorization. Those are separate enrollment, registry, and application-policy responsibilities.

## 2. Constraint system

Let (H_2) denote the configured Circomlib Poseidon two-input permutation and (H_3) its three-input form. The source circuit imposes the following relation.

### 2.1 Leaf commitment

[
L=H_2(secret,epoch).
]

The epoch is included in the leaf. A root constructed for one epoch will not normally contain the same secret's leaf under another epoch.

### 2.2 Boolean path selectors

For each level (iin{0,ldots,15}):

[
s_i(1-s_i)=0.
]

Over the circuit field, this restricts (s_i) to (0) or (1). The `DualMux` component orders the current node and sibling according to this bit:

[
(a_i,b_i)=
egin{cases}
(h_i,p_i),&s_i=0\
(p_i,h_i),&s_i=1.
end{cases}
]

Then:

[
h_{i+1}=H_2(a_i,b_i),qquad h_0=L.
]

After 16 levels, the final equality is:

[
h_{16}=root.
]

### 2.3 Nullifier derivation

[
nullifierHash=H_3(secret,nullifierKey,epoch).
]

The nullifier is deterministic for a particular witness and epoch. This circuit emits the value; uniqueness of redemption requires the application or verifier to persist and reject a previously redeemed nullifier. The circuit alone does not maintain a spent-nullifier database.

### 2.4 Field and range constraints

Circom signals are field elements in the selected scalar field. The source explicitly constrains the 16 path selectors to bits. It does not add a bit-decomposition/range constraint for `epoch`, `secret`, or `nullifierKey`. Any application-level requirement that an epoch be a bounded timestamp/year must be validated outside this circuit or added as an explicit circuit constraint.

## 3. Completeness argument

Assume the registrar has built the Merkle root from the intended leaf commitment and the student has the corresponding sibling path.

- The leaf component evaluates (H_2(secret,epoch)).
- Each path selector is a valid bit, so `DualMux` selects the sibling ordering used by the tree.
- Each level hashes the same ordered child pair as the tree construction.
- By induction on the 16 levels, (h_i) equals the tree node at height (i) on the witness path.
- Therefore (h_{16}=root), and the nullifier component evaluates (H_3(secret,nullifierKey,epoch)).

A correct witness therefore satisfies every constraint in the relation and can be used by the Groth16 prover.

## 4. Soundness statement and assumptions

The statement proved by an accepted Groth16 proof is limited to knowledge of field elements and a 16-level path satisfying the circuit relation for the supplied public values.

Under the standard knowledge-soundness assumptions of Groth16 for the configured curve and a correctly generated proving/verification key, an adversary who produces an accepting proof is assumed to know a witness satisfying those constraints, except with negligible probability. Given a trusted root and collision/second-preimage resistance of the Poseidon construction for the relevant domain, the Merkle path binds the witness leaf to a committed leaf below that root.

**This does not prove that a university signature was valid.** The circuit contains no signature-verification relation. To make the stronger claim “only a student with a valid university signature can prove,” the enrollment service must verify the issuer's signature before inserting a commitment into the trusted root, or the circuit must be extended to verify a signature itself. The trust boundary and issuer-key rotation policy must be documented and tested.

Likewise, the circuit does not enforce a date range or age range merely because `epoch` is public. A verifier must reject inactive roots/epochs and enforce application policy. A proof is only as trustworthy as the root-publication and verification-key distribution process.

### 4.1 Trusted setup

The repository's `scripts/compile-membership-zkp.sh` builds **`membership_verifier.circom`**, not `student_access_pass.circom`. It performs a local Powers of Tau ceremony and a local Groth16 contribution. That is not evidence of a public multi-party trusted setup for the student passcard circuit. Do not reuse its generated keys for a different circuit or describe the ceremony as independently audited.

A student passcard deployment needs its own compiled R1CS/WASM/zkey/verification key, a reproducible source-to-artifact manifest, and an independently reviewed contribution ceremony. The checked-in `public/zkp/membership_verifier.manifest.json` identifies the *membership_verifier* circuit and must not be presented as the student-pass manifest.

## 5. Circuit variants in this repository

| Source file | Public inputs | Private witness | Nullifier in circuit? | Matching build artifacts in `public/zkp`? |
|---|---|---|---|---|
| `student_access_pass.circom` | `root, epoch, nullifierHash` | `secret, nullifierKey, pathElements, pathIndices` | Yes | No matching named artifact set verified |
| `student_membership.circom` | `root, epoch` | `secret, pathElements, pathIndices` | No | A file named `student_membership.*` exists, but its provenance must be checked before associating it with this source |
| `membership_verifier.circom` | `root, epoch` | `identitySecret, pathElements, pathIndices` | No | Yes; manifest identifies `membership_verifier.circom` |

The separate `src/lib/zkp/verify.ts` currently loads the `premium_membership` WASM, zkey, and verification key. It is not a verifier for `student_access_pass.circom`. These variants must not be interchanged.

## 6. Benchmark protocol

No trustworthy Node or browser-WASM measurements for `student_access_pass.circom` were found in the repository, and there is no matching compiled artifact set to execute. The result table is intentionally left unmeasured rather than populated with estimates.

| Runtime | Prove time | Verify time | Peak memory | Result |
|---|---:|---:|---:|---|
| Node.js | Not measured | Not measured | Not measured | Student-pass artifacts/witness fixture required |
| Browser WASM worker | Not measured | Not measured | Not measured | Student-pass artifacts and browser worker harness required |

### 6.1 Reproducible Node measurement

After compiling the exact circuit and generating a valid witness fixture, run the following from the repository root:

```bash
npx circom2 circuits/student_access_pass.circom \
  --r1cs --wasm --sym -l node_modules -o circuits/build

# Complete a reviewed Powers-of-Tau and Groth16 setup for the R1CS,
# then export a verification key. Do not use keys from another circuit.

STUDENT_ACCESS_PASS_WASM=circuits/build/student_access_pass_js/student_access_pass.wasm \
STUDENT_ACCESS_PASS_ZKEY=circuits/build/student_access_pass_final.zkey \
STUDENT_ACCESS_PASS_VKEY=circuits/build/student_access_pass_vkey.json \
STUDENT_ACCESS_PASS_WITNESS=/secure/path/student-access-pass-witness.json \
node scripts/bench-student-access-pass.mjs
```

The witness file contains private values and must stay outside the repository. Run at least 30 warm runs on a named machine, report median and p95, and capture RSS before and peak RSS during proving.

### 6.2 Browser WASM measurement

Use the same circuit build and a dedicated worker in a production browser build. Record the browser/version, OS, CPU, memory, warm-up count, median/p95 proof-generation and verification durations, worker peak memory where the browser exposes it, and whether proof generation blocks the UI thread. Do not compare Node and browser numbers unless the machine, artifacts, and witness are identical.

## 7. Required security follow-up

Before describing the student passcard as a signature-backed credential:

1. Define the issuer trust root and verify the issuer signature before enrollment, or add a tested signature relation to the circuit.
2. Define explicit bounds for the academic epoch and any age/eligibility predicate.
3. Ensure the verifier checks that `root` and `epoch` are active and atomically consumes the nullifier.
4. Compile the exact student circuit, export its own verification key, and bind the artifact manifest to the source hash.
5. Add positive, negative, malformed-path, wrong-epoch, wrong-root, duplicate-nullifier, and cross-circuit-artifact tests.
6. Run and publish the Node and browser WASM benchmarks using the protocol above.

This document formalizes the current source constraints and its trust assumptions. It is not an independent cryptographic audit or a claim that the follow-up items are already implemented.
