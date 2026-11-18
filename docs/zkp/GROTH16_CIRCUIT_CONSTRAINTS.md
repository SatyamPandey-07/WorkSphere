# Groth16 Membership Circuit: Constraints, Benchmarks, and Verification

This document specifies the R1CS accounting and security properties of the
BN254 Groth16 membership circuits. The primary circuit is
[`circuits/membership_verifier.circom`](../../circuits/membership_verifier.circom),
which proves depth-16 membership. The companion
[`circuits/student_access_pass.circom`](../../circuits/student_access_pass.circom)
adds a private nullifier key and a public nullifier output.

Constraint counts are for Circom 2.x with the circomlib Poseidon templates
used by this repository. A compiler or circomlib upgrade must regenerate the
R1CS report; the report, not this table, is the build authority.

## 1. Circuit statements

### 1.1 MembershipVerifier(16)

Public inputs are `root` and `epoch`. Private inputs are `identitySecret`,
`pathElements[16]`, and `pathIndices[16]`.

The circuit proves:

$$
\exists s,p_0,\ldots,p_{15},b_0,\ldots,b_{15}:
\quad
root = H_{16}(\operatorname{Poseidon}_2(s,epoch),p,b)
$$

where each $b_i\in\{0,1\}$ selects the left/right order at level $i$.

### 1.2 StudentAccessPass(16)

This circuit has the same Merkle membership statement and additionally proves:

$$
nullifierHash =
\operatorname{Poseidon}_3(secret,nullifierKey,epoch).
$$

The nullifier is public and deterministic for a secret, key, and epoch, while
the secret and key remain private.

## 2. R1CS constraint accounting

An R1CS instance consists of matrices $A,B,C$ over the BN254 scalar field and
witness vector $w$:

$$
(Aw)\odot(Bw)=Cw.
$$

Each Circom `===` assertion contributes one rank-1 constraint. A signal
assignment using `<==` creates a witness computation and contributes
constraints only when its expression is non-linear.

### 2.1 Component counts

| Component | Circom instance | Constraints per instance | MembershipVerifier(16) | StudentAccessPass(16) |
|---|---:|---:|---:|---:|
| Leaf Poseidon hash | `Poseidon(2)` | 240 | 240 | 240 |
| Merkle Poseidon hashes | `Poseidon(2)` × 16 | 240 | 3,840 | 3,840 |
| Path selector | `MembershipDualMux`/`DualMux` × 16 | 3 | 48 | 48 |
| Root equality | `root === currentHash[16]` | 1 | 1 | 1 |
| Nullifier Poseidon hash | `Poseidon(3)` | 300 | 0 | 300 |
| Nullifier equality | `nullifierHash === hasher.out` | 1 | 0 | 1 |
| **Total** |  |  | **4,129** | **4,430** |

### 2.2 Poseidon hash

For the circomlib BN254 Poseidon parameters used here:

- `Poseidon(2)` is accounted as approximately 240 R1CS constraints.
- `Poseidon(3)` is accounted as approximately 300 R1CS constraints.

The cost is dominated by the S-box arithmetic and round structure. Poseidon
avoids bit decomposition required by conventional hash circuits, so the hash
is substantially smaller than a SHA-256 circuit over the same field.

### 2.3 Merkle path verifier

At every tree level, `DualMux` enforces:

$$
b_i(1-b_i)=0
$$

and computes the selected ordered pair:

$$
left_i=(right_{i-1}-sibling_i)b_i+right_{i-1},
$$

$$
right_i=(right_{i-1}-sibling_i)(1-b_i)+sibling_i.
$$

The boolean constraint and the two multiplexing equations cost three
constraints per level. Each selected pair then enters one `Poseidon(2)` hash.
For depth $L$:

$$
C_{\mathrm{membership}} =
C_{\mathrm{leaf}}
L(C_{\mathrm{mux}}+C_{\mathrm{Poseidon2}})
1.
$$

For $L=16$:

$$
240 + 16(3+240)+1 = 4,129.
$$

### 2.4 Nullifier derivation

`StudentAccessPass` adds:

$$
C_{\mathrm{nullifier}} =
C_{\mathrm{Poseidon3}} + C_{\mathrm{equality}}
=300+1=301.
$$

Therefore:

$$
4,129+301=4,430.
$$

The base `membership_verifier` circuit does not derive a nullifier. Systems
requiring replay or double-redemption prevention must use the access-pass
variant or derive and enforce an equivalent domain-separated nullifier.

## 3. Reproducible R1CS verification

Compile the circuit and inspect the generated R1CS metadata:

```bash
npx circom2 circuits/membership_verifier.circom \
  --r1cs --wasm --sym -l node_modules -o circuits/build
npx snarkjs r1cs info circuits/build/membership_verifier.r1cs
```

For the nullifier-bearing circuit:

```bash
npx circom2 circuits/student_access_pass.circom \
  --r1cs --wasm --sym -l node_modules -o circuits/build
npx snarkjs r1cs info circuits/build/student_access_pass.r1cs
```

The generated `constraints`, `private inputs`, `public inputs`, and `wires`
must be recorded with the proving artifact. The powers-of-tau size must exceed
the circuit's required domain size; `scripts/compile-membership-zkp.sh`
uses a $2^{14}$ ceremony for the depth-16 membership circuit.

## 4. SnarkJS WebAssembly proving benchmarks

Proof generation uses the Circom witness WASM and SnarkJS Groth16 prover:

```ts
const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  input,
  "/zkp/membership_verifier.wasm",
  "/zkp/membership_verifier.zkey",
);
```

### 4.1 Benchmark protocol

Measure `fullProve` only, excluding network fetches and UI rendering:

1. Fetch and cache the WASM and zkey before timing.
2. Run two warm-up proofs.
3. Run at least 20 proofs using fresh valid witnesses.
4. Report median, p95, peak resident memory, browser, CPU model, and
   SnarkJS/circomlib versions.
5. Run the same witness shape for desktop and mobile; do not compare a cached
   desktop key against an uncached mobile key.

```ts
async function benchmark(fullProve, input, wasm, zkey, iterations = 20) {
  for (let i = 0; i < 2; i++) await fullProve(input, wasm, zkey);

  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fullProve(input, wasm, zkey);
    samples.push(performance.now() - start);
  }

  samples.sort((a, b) => a - b);
  return {
    medianMs: samples[Math.floor(samples.length / 2)],
    p95Ms: samples[Math.floor(samples.length * 0.95)],
  };
}
```

### 4.2 Reference engineering benchmarks

The following ranges are the repository's operational reference targets for
the depth-16 membership proof using SnarkJS WebAssembly. They are not a
cryptographic constant: browser version, thermal state, memory pressure,
WASM threading, and zkey transfer all affect the result.

| Runtime class | Representative environment | Median proving time | P95 budget | Expected memory |
|---|---|---:|---:|---:|
| Desktop | Apple M1 / modern x86-64 browser | 650–1,200 ms | < 1,500 ms | < 64 MB |
| Modern mobile | Recent ARM64 phone, warm WASM | 1,200–3,000 ms | < 4,000 ms | 64–128 MB |
| Low-end mobile | Older ARM64 phone or constrained PWA | 3,000–8,000 ms | < 10,000 ms | 128 MB or more |

Mobile clients should run proving in a Web Worker and expose progress or a
cancel affordance. A device that exceeds the memory budget should fail closed
with a retry or server-assisted verification option; it must not transmit the
private witness as a fallback.

## 5. Formal security properties

Let $R$ be the relation represented by the circuit, $x$ its public inputs, and
$w$ its private witness. Groth16 proves membership in:

$$
R = \{(x,w): \text{all R1CS constraints evaluate to zero}\}.
$$

### 5.1 Soundness

Under the knowledge-of-exponent assumption and the standard Groth16
assumptions for the BN254 setup, an accepting proof implies that a prover
knows a witness $w$ such that $(x,w)\in R$, except with negligible
probability.

For `MembershipVerifier(16)`, acceptance therefore implies knowledge of:

- an `identitySecret`,
- 16 sibling hashes,
- 16 boolean path indices,

whose leaf and path hash to the public `root` for the public `epoch`.

For `StudentAccessPass(16)`, it additionally implies knowledge of
`nullifierKey` satisfying the public nullifier equation. Soundness depends on
the verifier pinning the correct verification key and checking all public
signals in the expected order.

### 5.2 Zero knowledge

Groth16's proof randomizers hide witness-dependent group elements. Under the
zero-knowledge property of the protocol, a verifier learns only:

- the proof,
- the public inputs (`root`, `epoch`, and, for the access-pass variant,
  `nullifierHash`),
- the fact that a valid witness exists.

The verifier does not learn `identitySecret`, path siblings, path indices, or
`nullifierKey`. Zero knowledge does not hide public input metadata, and it does
not protect secrets that an application logs or transmits outside the proof
protocol.

### 5.3 Completeness

For every valid membership witness $w$:

1. `Poseidon(identitySecret, epoch)` equals the committed leaf.
2. Each boolean path index selects the correct sibling order.
3. The 16 Poseidon parent computations reach `root`.
4. In the access-pass circuit, the nullifier hash equals
   `Poseidon(secret, nullifierKey, epoch)`.

All constraints are satisfied, so an honestly generated Groth16 proof verifies
except for negligible implementation or field-encoding errors.

## 6. Verification invariants

1. Public signal ordering is fixed by the Circom `main` declaration.
2. The verifier key is generated from the exact R1CS used by the WASM witness
   generator.
3. The Merkle root and epoch are checked against the active registry before
   accepting access.
4. Nullifiers are recorded atomically and rejected on reuse.
5. Private inputs never enter logs, telemetry, URLs, or error payloads.
6. Circuit changes require a new R1CS, WASM, proving key, verification key, and
   artifact manifest.

