# Sparse Merkle Tree Nullifier Verification: R1CS Analysis, Security Proof, and Benchmarks

**Issue:** [#7738](https://github.com/Prathvikmehra/WorkSphere/issues/7738)
**Status:** Reference analysis for security audit. Not a deployed circuit.
**Last verified:** 2026-11-14
**Toolchain:** Circom 2.2.3 (`circom2` 0.2.23), circomlib 2.0.5, SnarkJS 0.7.6,
Node.js 24.18.0, Chromium 156.0.8078.4 (Playwright 1.64.0).

> **Implementation status.** WorkSphere does not currently ship a Sparse Merkle
> Tree (SMT) circuit. Anonymous venue check-ins use the depth-16 Poseidon
> membership circuit in
> [`circuits/student_access_pass.circom`](../../circuits/student_access_pass.circom)
> and a Redis/PostgreSQL nullifier ledger in
> [`src/lib/zkp/nullifierLedger.ts`](../../src/lib/zkp/nullifierLedger.ts).
> This document specifies the SMT relation that a production implementation
> must instantiate, measures its R1CS cost at depths 16, 24, and 32, proves the
> properties an auditor must check, and records reproducible browser and server
> benchmarks. "The circuit" below means the reference circuit in §2 unless a
> repository artifact is named explicitly.

## Key findings

1. **Measured cost.** The verifier-only SMT circuit costs **9,615 / 13,775 /
   17,935** R1CS constraints at depth **16 / 24 / 32**. The composed circuit
   that also derives the nullifier costs **10,220 / 14,380 / 18,540**.
2. **Exact closed forms.** Verifier-only:
   `total = 1,295 + 520·L`, `nonlinear = 745 + 246·L`,
   `linear = 550 + 274·L`. Composed: add a fixed **605** constraints for
   `Poseidon(3)`; the nullifier equality is a wire alias and costs zero.
3. **Component costs.** `Poseidon(2) = 517` (243 nonlinear + 274 linear),
   `Poseidon(3) = 605` (264 + 341), `DualMux = 3`, `Num2Bits(254) = 255`
   (254 + 1), `IsZero = 2`.
4. **Browser and server proving are at parity.** Warm browser WASM proves in
   **612 / 726 / 1,049 ms** versus **607 / 691 / 992 ms** in a warm Node.js
   process: **+0.8% / +5.1% / +5.7%**. Cold Node.js processes are 40–67% slower
   because every request pays curve-table initialization and WASM compilation.
5. **Depth 16/24/32 are unsafe as the sole double-spend guard.** With random
   keys, a slot collision is more likely than not at **~301 / ~4,823 /
   ~77,163** nullifiers. An attacker who knows a victim's nullifier can also
   grind a colliding low-`L`-bit key in `2^L` Poseidon evaluations, which is
   trivial at `L = 16` and feasible at `L = 32`. Keep the ledger authoritative
   or use full-depth keys, bucket commitments, or `L ≥ 48`.
6. **Integration gaps exist in the current repository.** The shipped
   `verify-nullifier` route loads a verification key with `nPublic = 1` but
   sends four public signals, `venueId` is not bound by any circuit, and the
   ledger is epoch-global rather than venue-scoped. See §9.

---

## 1. Scope and security model

### 1.1 What is being analyzed

The circuit proves one of two statements about a nullifier `nh` in an epoch
`e`:

- **Non-membership (`mode = 0`)**: the key derived from `nh` is not present
  with value `1` in the SMT committed by `root`.
- **Membership (`mode = 1`)**: the key derived from `nh` is present with value
  `1` in the SMT committed by `root`.

The SMT is a fixed-depth binary tree. Leaf positions are the low `L` bits of
the key. Empty leaves use the Poseidon zero-hash chain. The circuit is
deliberately small enough to prove in a browser; the security analysis shows
exactly what that costs.

### 1.2 Notation

| Symbol         | Meaning                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------- |
| $\mathbb{F}_r$ | BN254 scalar field                                                                                |
| $r$            | $21888242871839275222246405745257275088548364400416034343698204186575808495617 \approx 2^{253.6}$ |
| $H_2, H_3$     | Circomlib Poseidon with 2 and 3 field inputs, one output                                          |
| $L$            | SMT depth (`levels` in Circom)                                                                    |
| $nh$           | Public nullifier hash                                                                             |
| $e$            | Public epoch                                                                                      |
| $key$          | $H_2(nh, e)$; the SMT key                                                                         |
| $k, v$         | Private leaf key and leaf value                                                                   |
| $leaf$         | $H_2(k, v)$                                                                                       |
| $b_i$          | Path bit at level $i$ (least-significant bit first)                                               |
| $s_i$          | Private sibling hash at level $i$                                                                 |
| $z_i$          | Zero hash: $z_0 = H_2(0,0)$, $z_{i+1} = H_2(z_i, z_i)$                                            |
| $mode$         | Public bit: 0 = unspent, 1 = spent                                                                |
| $\ell$         | Number of public inputs, $\ell = 4$                                                               |
| $R_L$          | The depth-$L$ relation defined in §2.1                                                            |

### 1.3 Assumptions

The proofs in §6 are conditional on the following assumptions. They are stated
explicitly because several are heuristic, not theorems.

- **A1 (Poseidon collision resistance).** No probabilistic polynomial-time
  (PPT) adversary finds distinct $(x,y) \ne (x',y')$ with
  $H_2(x,y) = H_2(x',y')$, or distinct triples with equal $H_3$ output, except
  with negligible probability.
- **A2 (Poseidon preimage resistance).** Given a random $H_3$ output, no PPT
  adversary finds a preimage except with negligible probability.
- **A3 (Poseidon PRF heuristic).** For secret $(s,k)$, the map
  $e \mapsto H_3(s,k,e)$ is computationally indistinguishable from a random
  function. This is a heuristic; Poseidon is not proven to be a PRF.
- **A4 (Groth16 knowledge soundness).** For an honestly generated CRS and the
  intended circuit, any PPT adversary that outputs an accepting proof for $x$
  can be extracted to a witness $w$ with $(x,w) \in R_L$, except with
  negligible probability. Groth16 has such an argument in the generic bilinear
  group model under $q$-type assumptions.
- **A5 (CRS integrity).** The verifier uses the verification key for the
  intended circuit and setup, and the setup's toxic waste was destroyed.
- **A6 (Canonical tree).** The root publisher inserts each leaf at
  $\mathrm{low}_L(k)$ and never stores two different keys in one slot. The
  circuit does not enforce this; it is an operator trust assumption (§5.3).
- **A7 (Ledger atomicity and root freshness).** The nullifier claim is
  linearizable, and the verifier accepts only roots that are current for the
  epoch, or the ledger rejects replays against stale roots.

BN254/Groth16 provides roughly 100 bits of classical security and no
post-quantum security. The circuit's Poseidon parameters target the same
order.

---

## 2. The reference circuit

### 2.1 Relation

Public input
$x = (root, nh, e, mode) \in \mathbb{F}_r^4$.
Private witness
$w = (k, v, s_0,\ldots,s_{L-1}, b_0,\ldots,b_{L-1})$.

The relation $R_L(x,w)$ holds when:

$$
key = H_2(nh, e) \tag{R1}
$$

$$
b_i \in \{0,1\}, \qquad
key \equiv \sum_{i=0}^{253} b_i 2^i \pmod r,
\qquad b_i = \text{pathIndices}[i] \ \text{for } i < L \tag{R2}
$$

$$
leaf = H_2(k, v), \qquad v \in \{0,1\} \tag{R3}
$$

$$
h_0 = leaf, \qquad
h_{i+1} = H_2\!\left((s_i - h_i)b_i + h_i,\ (h_i - s_i)b_i + s_i\right) \tag{R4}
$$

$$
root = h_L \tag{R5}
$$

$$
same = \begin{cases} 1 & key = k \\ 0 & key \ne k \end{cases} \tag{R6}
$$

$$
mode = same \cdot v \tag{R7}
$$

Equation (R4) is exactly the two `DualMux` outputs: for $b_i = 0$ the current
node is the left child, for $b_i = 1$ it is the right child. The bit order is
least-significant bit first, matching `Num2Bits` output order.

The composed deployment relation $R_L^\ast$ adds the nullifier derivation:

$$
nh = H_3(secret, nullifierKey, e) \tag{R8}
$$

with $secret$ and $nullifierKey$ private. The reference benchmarks in §7 use
$R_L$; adding (R8) adds a fixed 605 constraints (§4.2).

### 2.2 Circuit source

```circom
pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";

template DualMux() {
    signal input in[2];
    signal input s;
    signal output out[2];

    s * (1 - s) === 0;
    out[0] <== (in[1] - in[0]) * s + in[0];
    out[1] <== (in[0] - in[1]) * s + in[1];
}

template SMTNullifierVerifier(levels) {
    signal input root;
    signal input nullifierHash;
    signal input epoch;
    signal input mode; // 1 = spent, 0 = unspent

    signal input leafKey;
    signal input leafValue;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    // R1: key = Poseidon(nullifierHash, epoch)
    component keyHasher = Poseidon(2);
    keyHasher.inputs[0] <== nullifierHash;
    keyHasher.inputs[1] <== epoch;
    signal key <== keyHasher.out;

    // R2: path bits are the low `levels` bits of the key
    component keyBits = Num2Bits(254);
    keyBits.in <== key;
    for (var i = 0; i < levels; i++) {
        pathIndices[i] === keyBits.out[i];
    }

    // R3: leaf = Poseidon(leafKey, leafValue)
    component leafHasher = Poseidon(2);
    leafHasher.inputs[0] <== leafKey;
    leafHasher.inputs[1] <== leafValue;
    signal currentHash[levels + 1];
    currentHash[0] <== leafHasher.out;

    // R4/R5: Merkle path to the public root
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

    root === currentHash[levels];

    // R6/R7: mode = [key == leafKey] * leafValue
    leafValue * (1 - leafValue) === 0;

    component sameKey = IsZero();
    sameKey.in <== key - leafKey;

    mode * (1 - mode) === 0;
    mode === sameKey.out * leafValue;
}

component main {public [root, nullifierHash, epoch, mode]} = SMTNullifierVerifier(16);
```

For deployment, add (R8) before the key derivation:

```circom
component nullifierHasher = Poseidon(3);
nullifierHasher.inputs[0] <== secret;
nullifierHasher.inputs[1] <== nullifierKey;
nullifierHasher.inputs[2] <== epoch;
nullifierHash === nullifierHasher.out;
```

The equality in (R8) compiles to wire aliasing and adds no constraint; the
only cost is `Poseidon(3)` itself.

### 2.3 Public signal ABI

SnarkJS consumes public signals in the order of the `public` list in the main
component. For the reference circuit:

| Index | Signal          | Meaning                        | Verifier must check               |
| ----: | --------------- | ------------------------------ | --------------------------------- |
|     0 | `root`          | SMT root for the epoch         | Equals the canonical root for `e` |
|     1 | `nullifierHash` | $H_3(secret, nullifierKey, e)$ | Well-formed, not already claimed  |
|     2 | `epoch`         | Epoch scope                    | Equals the expected epoch         |
|     3 | `mode`          | 0 = unspent, 1 = spent         | Equals the expected operation     |

The order is part of the ABI. Reordering the public list silently breaks every
client even though the circuit still compiles.

### 2.4 Semantics of `mode`

| `sameKey` | `leafValue` | `mode` | Meaning                                           |
| --------: | ----------: | -----: | ------------------------------------------------- |
|         0 |           0 |      0 | Slot empty or occupied by a different key         |
|         0 |           1 |      0 | Slot occupied by a **different** key with value 1 |
|         1 |           0 |      0 | The key is present but unspent                    |
|         1 |           1 |      1 | The key is spent                                  |

The second row is the subtle one: a spent slot belonging to a different key
still yields `mode = 0` for this key, which is correct set semantics. It also
creates the collision problem analyzed in §5.

---

## 3. R1CS accounting

### 3.1 R1CS and QAP

An R1CS instance has matrices $A, B, C \in \mathbb{F}_r^{n \times (m+1)}$ and
a witness vector $a = (1, a_1, \ldots, a_m)$ such that

$$
(Aa) \odot (Ba) = Ca.
$$

For each constraint $j$:

$$
\left(\sum_i A_{j,i} a_i\right)
\left(\sum_i B_{j,i} a_i\right)
=
\sum_i C_{j,i} a_i.
$$

The QAP interpolates $u_i, v_i, w_i$ over a domain $H$ with
$t(X) = \prod_{h \in H}(X-h)$ and defines

$$
h(X) =
\frac{
\left(\sum_i a_i u_i(X)\right)
\left(\sum_i a_i v_i(X)\right)
-
\sum_i a_i w_i(X)
}{t(X)}.
$$

The witness satisfies the R1CS iff $t(X)$ divides the numerator; $h$ has
degree at most $n-2$. Groth16 proves knowledge of $a$ by proving this
divisibility in the exponent.

### 3.2 How Circom counts

Circom reports **nonlinear** and **linear** constraints separately. Both are
written to the `.r1cs` file, in separate sections; `snarkjs r1cs info` reports
their sum. Two compiler behaviors matter for audits:

- A signal-to-signal equality such as `root === currentHash[levels]` can be
  compiled to **wire aliasing**, costing **zero** constraints under the
  default `--O2` optimization. The same applies to
  `pathIndices[i] === keyBits.out[i]` and
  `nullifierHash === nullifierHasher.out`.
- The linear count is not a fixed function of the Circom source. It depends on
  which affine expressions the optimizer fuses. Regenerate the R1CS for every
  compiler or circomlib change; this document's tables are measurements, not
  source-level estimates.

The counts below were produced with the commands in Appendix B and are
reproducible from the listed toolchain.

### 3.3 Measured component costs

Each row is an isolated circuit compiled with the same Circom/circomlib
versions. "Instances" is the number used by the SMT circuit.

| Component          | Template                       | Cost per instance (NL + linear = total) | Notes                                         |
| ------------------ | ------------------------------ | --------------------------------------: | --------------------------------------------- |
| Poseidon, 2 inputs | `Poseidon(2)`                  |                     243 + 274 = **517** | $t=3$, 8 full + 57 partial rounds, 81 S-boxes |
| Poseidon, 3 inputs | `Poseidon(3)`                  |                     264 + 341 = **605** | $t=4$, 8 full + 56 partial rounds, 88 S-boxes |
| Path selector      | `DualMux`                      |                           3 + 0 = **3** | 1 booleanity + 2 multiplexing constraints     |
| Bit decomposition  | `Num2Bits(254)`                |                       254 + 1 = **255** | 254 booleanity + 1 recomposition              |
| Zero test          | `IsZero`                       |                           2 + 0 = **2** | `out = 1 - in*inv`, `in*out = 0`              |
| Booleanity         | `x*(1-x) === 0`                |                           1 + 0 = **1** | `leafValue`, `mode`                           |
| Mode product       | `mode === a*b`                 |                           1 + 0 = **1** | R7                                            |
| Key difference     | `sameKey.in <== key - leafKey` |                           0 + 1 = **1** | linear                                        |
| Signal equality    | `a === b`                      |                           0 + 0 = **0** | wire alias under `--O2`                       |

The Poseidon S-box is `in2 = in*in; in4 = in2*in2; out = in4*in`, i.e. three
nonlinear constraints per S-box. Full rounds apply $t$ S-boxes, partial rounds
apply one. This explains the nonlinear counts exactly:
$8 \cdot 3 + 57 = 81$ S-boxes for $t=3$, and $8 \cdot 4 + 56 = 88$ for $t=4$.
The linear counts come from the `Ark` (round-constant) and `Mix`/`MixS` (MDS)
affine layers; the optimizer fuses some of them, so the measured totals are
authoritative.

---

## 4. Complete constraint tables

### 4.1 Verifier-only circuit

`SMTNullifierVerifier(L)`, public `[root, nullifierHash, epoch, mode]`,
private `[leafKey, leafValue, pathElements[L], pathIndices[L]]`.

| Component                                                   | Count |             Nonlinear |                Linear |                     Total |
| ----------------------------------------------------------- | ----: | --------------------: | --------------------: | ------------------------: |
| Key hash `Poseidon(2)`                                      |     1 |                   243 |                   274 |                       517 |
| Leaf hash `Poseidon(2)`                                     |     1 |                   243 |                   274 |                       517 |
| Path hashes `Poseidon(2)`                                   |   $L$ |                $243L$ |                $274L$ |                    $517L$ |
| Path selectors `DualMux`                                    |   $L$ |                  $3L$ |                     0 |                      $3L$ |
| Bit decomposition `Num2Bits(254)`                           |     1 |                   254 |                     1 |                       255 |
| Mode logic (2 booleanity + `IsZero` + product + difference) |     1 |                     5 |                     1 |                         6 |
| Root equality                                               |     1 |                     0 |                     0 |                         0 |
| **Total**                                                   |       | $\mathbf{745 + 246L}$ | $\mathbf{550 + 274L}$ | $\mathbf{1{,}295 + 520L}$ |

Depth-by-depth:

| Depth $L$ | Nonlinear | Linear |  **Total** |  Wires | Public | Private | Labels |        QAP domain | ptau power |
| --------: | --------: | -----: | ---------: | -----: | -----: | ------: | -----: | ----------------: | ---------: |
|        16 |     4,681 |  4,934 |  **9,615** |  9,617 |      4 |      34 | 14,201 | 16,384 ($2^{14}$) |         14 |
|        24 |     6,649 |  7,126 | **13,775** | 13,777 |      4 |      50 | 20,401 | 16,384 ($2^{14}$) |         14 |
|        32 |     8,617 |  9,318 | **17,935** | 17,937 |      4 |      66 | 26,601 | 32,768 ($2^{15}$) |         15 |

The QAP domain is the smallest power of two strictly greater than
`constraints + public inputs + outputs`; SnarkJS doubles the power when the sum
is exactly a power of two. Depth 32 crosses from $2^{14}$ to $2^{15}$, which is
why its proving cost jumps disproportionately (§8.4).

### 4.2 Composed circuit with nullifier derivation

Add `Poseidon(3)` for (R8). The nullifier equality is a wire alias.

| Depth $L$ | Verifier-only | Nullifier `Poseidon(3)` | Equality |  **Total** | Nonlinear | Linear |  Wires | Private | Labels |
| --------: | ------------: | ----------------------: | -------: | ---------: | --------: | -----: | -----: | ------: | -----: |
|        16 |         9,615 |                     605 |        0 | **10,220** |     4,945 |  5,275 | 10,223 |      36 | 15,137 |
|        24 |        13,775 |                     605 |        0 | **14,380** |     6,913 |  7,467 | 14,383 |      52 | 21,337 |
|        32 |        17,935 |                     605 |        0 | **18,540** |     8,881 |  9,659 | 18,543 |      68 | 27,537 |

Closed forms: `total = 1,900 + 520L`,
`nonlinear = 1,009 + 246L`, `linear = 891 + 274L`.

### 4.3 Marginal cost per level

| Quantity            | Per level |  Depth 16 |   Depth 24 |   Depth 32 |
| ------------------- | --------: | --------: | ---------: | ---------: |
| `Poseidon(2)` path  |       517 |     8,272 |     12,408 |     16,544 |
| `DualMux`           |         3 |        48 |         72 |         96 |
| **Per-level total** |   **520** |     8,320 |     12,480 |     16,640 |
| Fixed base          |     1,295 |     1,295 |      1,295 |      1,295 |
| **Grand total**     |           | **9,615** | **13,775** | **17,935** |

Cost grows linearly with depth. The nonlinear share is 48.7% at depth 16 and
48.0% at depth 32; the linear share is not negligible and must be included in
any proving-cost estimate.

### 4.4 Reconciliation with existing documents

[`docs/zkp/GROTH16_CIRCUIT_CONSTRAINTS.md`](./GROTH16_CIRCUIT_CONSTRAINTS.md)
and [`docs/ZKP_VERIFICATION_PROTOCOL.md`](../ZKP_VERIFICATION_PROTOCOL.md)
quote approximate Poseidon costs of 240 and 300 and totals of 4,129 and 4,430.
Those figures are **nonlinear-only estimates**. The R1CS files contain both
sections:

| Circuit (depth 16)      | Existing claim | Measured NL | Measured linear | Measured total | Understated by |
| ----------------------- | -------------: | ----------: | --------------: | -------------: | -------------: |
| `membership_verifier`   |          4,129 |       4,179 |           4,658 |      **8,837** |          4,708 |
| `student_access_pass`   |          4,430 |       4,443 |           4,999 |      **9,442** |          5,012 |
| SMT verifier (this doc) |              — |       4,681 |           4,934 |      **9,615** |              — |

The measured `student_access_pass` nonlinear count (4,443) is within 0.3% of
the old 4,430, which confirms that the old table counted nonlinear constraints
only. Proving time and key size scale with the total, so the old figures
understate the deployment cost by roughly half.

---

## 5. Depth selection and collision analysis

Depth is **not** a cryptographic security parameter in this design. The key
space is $\mathbb{F}_r$ (about $2^{253.6}$), but the leaf position is only
$L$ bits. Two distinct keys that agree on their low $L$ bits occupy the same
slot. This section quantifies the consequences.

### 5.1 Slot space and birthday collisions

For $n$ uniformly random keys and $2^L$ slots, the probability of at least one
collision is

$$
P_{\mathrm{coll}}(n,L) \approx 1 - \exp\!\left(-\frac{n(n-1)}{2 \cdot 2^L}\right).
$$

The number of keys for a 50% chance is approximately
$1.1774\sqrt{2^L}$.

| Depth |               Slots | 50% collision at | $n = 1{,}000$ | $n = 10{,}000$ | $n = 50{,}000$ | $n = 100{,}000$ |
| ----: | ------------------: | ---------------: | ------------: | -------------: | -------------: | --------------: |
|    16 |              65,536 |             ~301 |        99.95% |          ~100% |          ~100% |           ~100% |
|    24 |          16,777,216 |           ~4,823 |         2.93% |         94.92% |          ~100% |           ~100% |
|    32 |       4,294,967,296 |          ~77,163 |        0.012% |          1.16% |         25.25% |          68.78% |
|    48 | 281,474,976,710,656 |           ~19.8M |           ~0% |            ~0% |        0.0004% |         0.0018% |

A registry of even a few thousand students cannot use depth 16 or 24 as a
unique-slot structure. Depth 32 is borderline at 50,000 and fails at 100,000.

### 5.2 Targeted prefix grinding

Birthday collisions are not the only attack. If an attacker knows a victim's
nullifier `nh` (it is a public signal and appears in logs), the attacker can
compute the victim's key $H_2(nh,e)$ and grind their own `nullifierKey` until
their key shares the victim's low $L$ bits. The expected work is $2^L$
Poseidon evaluations:

| Depth |       Expected work | Practical cost                            |
| ----: | ------------------: | ----------------------------------------- |
|    16 |              65,536 | Seconds in JavaScript; trivial            |
|    24 |          16,777,216 | Minutes; trivial for a motivated attacker |
|    32 |       4,294,967,296 | Hours to days on a GPU; feasible          |
|    48 | 281,474,976,710,656 | Infeasible                                |

An attacker who succeeds can insert their leaf into the victim's slot. If the
SMT is the only double-spend guard, this is a **soundness break**: the victim's
spent marker is overwritten, so the victim can prove `mode = 0` again (or the
attacker can deny the victim's `mode = 1` proof). If the ledger is
authoritative, the ledger still blocks the replay, but the SMT invariant is
broken and the attack is a denial-of-service on spent-status proofs.

### 5.3 Canonical-tree assumption

The circuit proves that the supplied leaf is at the path determined by
`key`, but it does not prove that the leaf's own key hashes to that path.
A malicious or buggy tree builder could insert a leaf at a position unrelated
to $\mathrm{low}_L(k)$. The circuit would still verify, because it only checks
the path from the supplied leaf to the public root. This is why A6 (canonical
tree) is a trust assumption. To enforce it in-circuit, add a second
`Num2Bits(254)` on `leafKey` and bind its low `L` bits to `pathIndices`
(+255 constraints, +2.7% at depth 16). This prevents malformed insertions but
does not prevent duplicate keys or slot overwrites; those need an insertion
policy or a bucket commitment.

### 5.4 Non-canonical bit decomposition

`Num2Bits(254)` proves that `key` equals
$\sum_{i=0}^{253} b_i 2^i$ **in the field**, not as an integer. Since
$2^{254} > r$, the sum $S$ can be either `key` or `key + r`. Both satisfy the
constraints when $key + r < 2^{254}$:

$$
\Pr[key + r < 2^{254}]
= \frac{2^{254} - r}{2^{254}}
\approx 0.2439.
$$

For about **24.39%** of keys, a malicious prover can choose the alternate
decomposition and therefore a different path from the canonical
$\mathrm{low}_L(key)$. This is the Circom `Num2Bits(254)` pitfall, not a bug in
this circuit alone. Mitigations:

- add an explicit range check $S < r$ to the 254-bit decomposition
  (roughly 254–500 extra constraints), or
- restrict the key to 253 bits, where the decomposition is unique because
  $2^{253} < r$, and define the key derivation accordingly, or
- keep the ledger authoritative and document that the SMT is not the sole
  replay guard.

The ledger currently masks this: the second proof still carries the same
`nullifierHash`, so the claim is rejected. It becomes exploitable if proofs
are accepted without a ledger claim, or if the ledger is reset while an old
root remains valid.

### 5.5 Recommendations

1. **Do not use depth 16 or 24 as a unique-slot SMT** for any registry larger
   than a few hundred keys. Use depth 32 only with an explicit collision
   policy.
2. **Prefer one of:** depth 48+ (26,255 constraints verifier-only, 26,860
   composed), a two-level bucket structure (32-bit bucket index plus a
   per-bucket commitment), or full-depth keys with an off-circuit bucket
   commitment.
3. **Keep the nullifier ledger authoritative** until the SMT has a proven
   collision policy. The circuit proves set semantics; the ledger proves
   uniqueness of the claim.
4. **Detect collisions operationally.** At insertion, reject or bucket a leaf
   whose low `L` bits are already occupied by a different key, and alert on the
   attempt. Silent overwrite is the dangerous case.
5. **Add the `S < r` range check** or switch to 253-bit keys if the SMT is ever
   used without the ledger.

For reference, the closed forms extrapolate to:

| Depth | Verifier-only | Composed | Approx. zkey (composed) |
| ----: | ------------: | -------: | ----------------------: |
|    48 |        26,255 |   26,860 |                ~12.7 MB |
|    64 |        34,575 |   35,180 |                ~16.6 MB |
|   254 |       133,375 |  133,980 |                ~63.4 MB |

The zkey estimate uses the measured ~473 bytes per constraint and is
approximate; it is not a benchmark.

---

## 6. Formal security properties

### 6.1 Completeness

**Theorem 1 (Completeness).** For every $(x,w) \in R_L$, the prover outputs a
proof that the verifier accepts with probability 1, up to negligible
witness-generation error. The same holds for $R_L^\ast$.

_Proof._ Every constraint in §2.1 is satisfied by construction of the honest
witness. The QAP numerator is divisible by $t(X)$, so $h(X)$ is a polynomial
of degree at most $n-2$. Groth16 completeness is the identity

$$
e(A,B) = e(\alpha,\beta)\,e(\mathrm{IC}(x),\gamma)\,e(C,\delta),
$$

which follows by expanding $A$, $B$, and $C$ with bilinearity and applying the
QAP divisibility identity; the $h(\tau)t(\tau)$ term is exactly what the
prover encodes in $C$. The full expansion is in Groth 2016, §3.2. No
additional assumption is used. $\square$

### 6.2 Root binding

**Lemma 1 (Root binding).** Under A1, no PPT adversary can output two distinct
leaf maps $D \ne D'$ with the same root, except with negligible probability.

_Proof._ Fix the tree shape and the zero-hash convention. If $D \ne D'$ but
$\mathrm{Root}(D) = \mathrm{Root}(D')$, walk down from the root. At the first
node whose two child pairs differ, the parent hashes are equal by assumption
along the path, so the two distinct child pairs are a Poseidon collision. If
the child pairs never differ, the maps differ only below a node whose child
hashes are equal; recurse into that subtree. At a leaf, distinct $(k,v)$ with
the same $H_2(k,v)$ is again a collision. $\square$

**Lemma 2 (Path uniqueness).** Given a root and a position
$p \in \{0,1\}^L$, there is at most one tuple
$(k,v,s_0,\ldots,s_{L-1})$ with $v \in \{0,1\}$ that verifies against the root,
except with negligible probability.

_Proof._ Two accepting tuples for the same position produce two paths from
possibly different leaves to the same root. If the leaves differ, the first
level at which the two ordered child pairs differ gives a Poseidon collision;
if the leaves agree but a sibling differs, the same argument applies at the
first differing level. This is the standard Merkle path-binding argument, and
it is the same reduction as Lemma 1. $\square$

### 6.3 Mode encoding

**Lemma 3 (Mode soundness).** For any accepting witness of $R_L$:

- $mode = 1 \implies key = k$ and $v = 1$;
- $mode = 0 \implies \lnot(key = k \land v = 1)$.

_Proof._ The `IsZero` constraints force $same = 1$ iff $key - k = 0$, and
$same = 0$ otherwise. The `IsZero` template enforces
$out = 1 - in \cdot inv$ and $in \cdot out = 0$: if $in = 0$ then $out = 1$;
if $in \ne 0$ then $in \cdot out = 0$ forces $out = 0$ and
$inv = in^{-1}$. Booleanity of `leafValue` and `mode` is enforced by
$x(1-x) = 0$. Finally $mode = same \cdot v$. If $mode = 1$, both factors are

1. If $mode = 0$, the product of two bits is 0, so at least one factor is 0.
   $\square$

### 6.4 Spent-state soundness

**Theorem 2 (No false spent proof).** Under A1 and A4, if the canonical root
$R$ does **not** commit to leaf $(key,1)$ at position
$\mathrm{low}_L(key)$, then no PPT adversary can produce an accepting proof for
$(R, nh, e, 1)$, except with negligible probability.

_Proof._ By A4, extract a witness $w$. Lemma 3 gives $k = key$ and $v = 1$, so
the Merkle constraints yield a valid path from $H_2(key,1)$ to $R$ at position
$\mathrm{low}_L(key)$. By Lemma 2, at most one leaf tuple verifies at that
position, so the tuple committed there is $(key,1)$, contradicting the
assumption. $\square$

### 6.5 Nullifier invalidation

**Theorem 3 (No false unspent proof).** Under A1 and A4, if $R$ commits to
$(key,1)$ at position $\mathrm{low}_L(key)$, then no PPT adversary can produce
an accepting proof for $(R, nh, e, 0)$, except with negligible probability.

_Proof._ Extract $w$. By Lemma 3, either $k \ne key$, or $k = key$ and
$v = 0$.

- If $k = key$ and $v = 0$, the proof's path starts at $H_2(key,0)$ and ends
  at $R$. The committed path starts at $H_2(key,1)$ and ends at $R$. By
  Lemma 2, the two path tuples at the same position are equal, so
  $H_2(key,0) = H_2(key,1)$, a Poseidon collision because $0 \ne 1$.
- If $k \ne key$, the proof's leaf tuple $(k,v)$ at position
  $\mathrm{low}_L(key)$ differs from the committed tuple $(key,1)$ at the same
  position, contradicting Lemma 2.

Both cases contradict A1 except with negligible probability. $\square$

**Corollary 1 (Nullifier invalidation).** Once a nullifier is spent in the
canonical tree for epoch $e$, it cannot be proven unspent against that tree.
This is the circuit-level half of replay protection. The other half is the
ledger and root freshness (A7): if the verifier accepts a stale root from
before the spend, Theorem 3 does not apply to that root, so a replay is
possible unless the ledger rejects the duplicate claim.

### 6.6 Nullifier derivation binding

**Theorem 4 (Nullifier binding).** Under A1, A2, and A4, an accepting proof
for $R_L^\ast$ implies knowledge of $(secret, nullifierKey)$ with
$nh = H_3(secret, nullifierKey, e)$. A PPT adversary cannot produce a valid
proof for a nullifier generated by another party, except with negligible
probability.

_Proof._ Extraction gives the witness, which includes the preimage of $nh$
under $H_3(\cdot,\cdot,e)$. Forging another party's nullifier requires a
preimage of a random $H_3$ output (A2). $\square$

### 6.7 Double-spend resistance

**Theorem 5 (Double-spend resistance).** Assume A1–A7. Let the ledger claim be
keyed by $(\text{venue}, nh, e)$ (or by $(nh,e)$ for a global-per-epoch
policy) and let the verifier accept only roots that are current for $e$. Then
the probability that the system accepts two check-ins for the same ledger key
is negligible.

_Proof._ The first accepted request atomically claims the key (A7). A second
request with the same key observes a duplicate. A second request with a
different nullifier for the same credential is impossible because the
derivation is deterministic; finding another preimage would contradict
Theorem 4. A user who holds multiple credentials has multiple nullifiers by
design. A second request against a stale root is rejected by root freshness,
or, if accepted, still blocked by the ledger. The only remaining case is a
break of ledger atomicity or of the root-freshness policy, both excluded by
A7. $\square$

The theorem is only as strong as the ledger scope. The current repository uses
a global `(nh, e)` key, so the guarantee is "one check-in per epoch across all
venues", not "one per venue" (§9, F4).

### 6.8 Zero knowledge

**Theorem 6 (Zero knowledge).** Groth16 is perfect zero-knowledge in the CRS
model: there is a PPT simulator $\mathcal{S}$ such that for every
$(x,w) \in R_L$, $\mathcal{S}(\mathrm{CRS}, \tau, x)$ and
$\mathrm{Prove}(\mathrm{CRS},x,w)$ are identically distributed, where $\tau$
is the CRS trapdoor.

_Proof._ In an honest proof, the prover samples $r, s \leftarrow \mathbb{F}_r$
uniformly. Hence $A = [\alpha + \sum_i a_i u_i(\tau) + r\delta]_1$ is uniform
in $\mathbb{G}_1$ and $B$ is uniform in $\mathbb{G}_2$; $C$ is determined by
the verification equation. The simulator samples $A, B$ uniformly and computes
the unique $C$ that satisfies
$e(A,B) = e(\alpha,\beta)e(\mathrm{IC}(x),\gamma)e(C,\delta)$ using the CRS
trapdoor. The two distributions are identical. $\square$

The verifier therefore learns only:

- the public inputs $(root, nh, e, mode)$,
- the fact that a witness exists,
- the proof itself.

It does not learn $secret$, $nullifierKey$, $k$, $v$, the siblings, or the
path bits. Zero knowledge does **not** hide the public inputs. In particular,
`nh` is a stable pseudonym within an epoch, and `root` can reveal the size or
occupancy of the epoch's tree.

### 6.9 Cross-epoch unlinkability

**Corollary 2.** Under A3, nullifiers for different epochs,
$H_3(secret, nullifierKey, e)$ and $H_3(secret, nullifierKey, e')$, are
computationally indistinguishable from independent random values. A verifier
cannot link a user's check-ins across epochs from the nullifier alone.

Within one epoch, the nullifier is intentionally stable so the ledger can
detect duplicates. Two venues that compare ledgers, or a global ledger, can
therefore link a user's same-epoch check-ins across venues. This is a design
consequence, not a proof failure.

### 6.10 What the proof does not guarantee

- **Root freshness.** The proof is relative to the supplied root. The verifier
  must check that the root is canonical for the epoch.
- **Nullifier uniqueness.** The proof does not know whether the nullifier was
  already claimed. The ledger must check and claim atomically.
- **Venue binding.** `venueId` is not in the reference relation. A proof is
  valid for any venue that accepts the same root and epoch.
- **Canonical tree.** The tree builder can violate A6; the circuit does not
  detect misplaced leaves.
- **Post-quantum security.** BN254/Groth16 is not post-quantum.
- **Client compromise.** A leaked witness or a malicious client can prove
  anything the witness allows; the proof is not a secure enclave.
- **Setup integrity.** A leaked toxic waste allows forgery regardless of the
  circuit.

---

## 7. Groth16 convention validation

This section maps the circuit's R1CS to the exact checks performed by SnarkJS
0.7.6. The equations follow Groth (2016) and the `snarkjs` implementation.

### 7.1 Setup and CRS

For a QAP with $m+1$ variables and $\ell$ public inputs, the setup samples
$\alpha,\beta,\gamma,\delta,\tau \leftarrow \mathbb{F}_r$ and publishes:

**Proving key**

$$
\begin{aligned}
&[\alpha]_1,\ [\beta]_1,\ [\beta]_2,\ [\delta]_1,\ [\delta]_2,\\
&\{[\tau^i]_1\}_{i=0}^{n-1},\ \{[\tau^i]_2\}_{i=0}^{n-1},\\
&\left\{\left[\frac{\beta u_i(\tau) + \alpha v_i(\tau) + w_i(\tau)}{\delta}\right]_1\right\}_{i=0}^{m},\\
&\left\{\left[\frac{\tau^i t(\tau)}{\delta}\right]_1\right\}_{i=0}^{n-2}.
\end{aligned}
$$

**Verification key**

$$
[\alpha]_1,\ [\beta]_2,\ [\gamma]_2,\ [\delta]_2,\
\left\{\left[\frac{\beta u_i(\tau) + \alpha v_i(\tau) + w_i(\tau)}{\gamma}\right]_1\right\}_{i=0}^{\ell}.
$$

For this circuit, $\ell = 4$ and the verification key must contain
$|\mathrm{IC}| = 5$ elements. The shipped verification keys are checked in §9.

### 7.2 Proving

Sample $r, s \leftarrow \mathbb{F}_r$ and compute

$$
A = \left[\alpha + \sum_{i=0}^{m} a_i u_i(\tau) + r\delta\right]_1,
$$

$$
B = \left[\beta + \sum_{i=0}^{m} a_i v_i(\tau) + s\delta\right]_2,
$$

$$
C = \left[
\sum_{i=\ell+1}^{m} a_i \frac{\beta u_i(\tau) + \alpha v_i(\tau) + w_i(\tau)}{\delta}
+ \frac{h(\tau)t(\tau)}{\delta}
+ A s + B r - r s \delta
\right]_1.
$$

### 7.3 Verification

The standard verification equation is

$$
e(A,B) = e(\alpha,\beta)\cdot e(\mathrm{IC}(x),\gamma)\cdot e(C,\delta),
$$

where

$$
\mathrm{IC}(x) = \mathrm{IC}_0 + \sum_{i=1}^{\ell} x_i \mathrm{IC}_i.
$$

SnarkJS computes the equivalent pairing product

$$
e(-A,B)\cdot e(\mathrm{IC}(x),\gamma_2)\cdot e(C,\delta_2)\cdot
e(\alpha_1,\beta_2) = 1,
$$

which is the same equation rearranged by bilinearity:
$e(-A,B) = e(A,B)^{-1}$. The `groth16.verify` path in
`node_modules/snarkjs/build/main.cjs` performs exactly this `pairingEq`, after
validating that each public signal is in $[0,r)$ and that each proof point is
a valid curve point.

| Convention               | Groth16                                                    | SnarkJS 0.7.6                                    | Match               |
| ------------------------ | ---------------------------------------------------------- | ------------------------------------------------ | ------------------- |
| Public input aggregation | $\mathrm{IC}_0 + \sum x_i \mathrm{IC}_i$                   | `multiExpAffine(IC[1..], publicSignals) + IC[0]` | Yes                 |
| Verification equation    | $e(A,B) = e(\alpha,\beta)e(\mathrm{IC},\gamma)e(C,\delta)$ | `pairingEq(-A,B; ICx,γ2; C,δ2; α1,β2)`           | Yes, rearranged     |
| Field range check        | $x_i \in [0,r)$                                            | `publicInputsAreValid`                           | Yes                 |
| Point validity           | on-curve, subgroup, non-infinity                           | `G1.isValid`, `G2.isValid`                       | Yes                 |
| Public signal order      | circuit `public` list                                      | same order                                       | Yes, ABI must match |
| G1 encoding              | affine $(x,y)$                                             | `[x, y, 1]`                                      | Yes                 |
| G2 encoding              | affine $(x,y)$                                             | `[[x0,x1],[y0,y1],[1,0]]`                        | Yes                 |
| Solidity export          | EIP-197 order                                              | swaps Fp2 coordinates                            | Use the exporter    |

Measured proof size: 128 bytes compressed (32 + 64 + 32) and 807 bytes as the
pretty-printed JSON used in the repository.

### 7.4 Verification checklist

A proof can be cryptographically valid while the wrong statement is accepted.
The verifier must perform all of these checks:

1. `publicSignals.length === 4` and `vkey.nPublic === 4`.
2. `vkey` hash matches the audited circuit build.
3. `root` equals the canonical root for `epoch` (root registry / freshness).
4. `epoch` equals the expected epoch (or an explicitly allowed grace window).
5. `mode` equals the expected value: `0` for check-in, `1` for spent-status.
6. `nullifierHash` is a field element and is not already claimed.
7. The ledger claim is atomic and happens after verification.
8. The response token is bound to `(venue, nh, epoch)` and an expiry.

Skipping step 1 is a real hazard: SnarkJS aggregates only the public signals
it is given. If a trailing public input is zero, omitting it leaves the
aggregate unchanged and the proof still verifies. A verifier that treats a
missing `mode` as `0` could accept a proof intended for a different operation.
Always pass the exact array and assert its length.

### 7.5 Proof malleability

Groth16 proofs are re-randomizable. Given a valid $(A,B,C)$ and any
$\Delta r, \Delta s \in \mathbb{F}_r$:

$$
A' = A + \Delta r\,[\delta]_1,\quad
B' = B + \Delta s\,[\delta]_2,\quad
C' = C + \Delta s\,A + \Delta r\,B + \Delta r\Delta s\,[\delta]_1
$$

is another valid proof for the **same** public inputs. The re-randomization
uses only elements of the proving key; it does not require the witness. Do not
use the proof hash as a unique session identifier or nonce. The nullifier
ledger, not the proof bytes, is the replay guard. If a verifier needs a
proof-bound nonce, bind it into the statement (a public input) instead.

### 7.6 Trusted setup

Groth16 requires a circuit-specific CRS. The repository's
[`scripts/compile-membership-zkp.sh`](../../scripts/compile-membership-zkp.sh)
generates a local `bn128` powers-of-tau file with a single contribution and
then contributes to the circuit zkey with a locally generated entropy string.
This is adequate for development and tests, but it does **not** provide a
public ceremony: whoever ran the script knows (or could have retained) the
toxic waste and could forge proofs for that zkey. Production must use a
publicly verifiable powers-of-tau ceremony (for example, a Hermez/Powers of
Tau transcript) and a multi-party phase-2 contribution, and must pin the
resulting verification key by hash.

The ptau power must cover the QAP domain: 14 for depths 16 and 24, 15 for
depth 32. A depth-32 deployment with the repository's `pot14` file fails at
setup time.

---

## 8. Benchmarks

### 8.1 Environment

| Item      | Value                                                       |
| --------- | ----------------------------------------------------------- |
| CPU       | Apple M2, 8 cores (4 performance + 4 efficiency)            |
| Memory    | 16 GB unified                                               |
| OS        | macOS 27.2.1 (build 26B131)                                 |
| Node.js   | 24.18.0                                                     |
| SnarkJS   | 0.7.6                                                       |
| Circom    | 2.2.3 (`circom2` npm 0.2.23)                                |
| circomlib | 2.0.5                                                       |
| Browser   | Chromium 156.0.8078.4, Playwright 1.64.0, headless          |
| Power     | Laptop on AC power; single machine; no mobile device tested |

"Server-side native" here means **Node.js running SnarkJS**, not a native
proving binary. SnarkJS uses JavaScript plus WASM field arithmetic in both
Node.js and the browser, so parity is expected. A native prover such as
rapidsnark would be faster server-side; it was not measured.

### 8.2 Methodology

**Node.js cold.** A fresh Node.js process per sample, five samples per depth.
The timer wraps `snarkjs.groth16.fullProve`, which includes reading and parsing
the zkey from disk, loading the curve tables, compiling the witness WASM,
computing the witness, and proving. This models a serverless invocation with
no warm state.

**Node.js warm.** A fresh process per sample, one discarded warm-up, then two
measured proofs; three processes per depth, six measured samples. The timer
still includes the per-call zkey read and parse. This models a warm server
process without relying on repeated calls in one process, which occasionally
hangs after several iterations in this environment.

**Browser WASM.** A fresh page per sample, five samples per depth. The WASM,
zkey, and vkey are fetched and cached before timing; the timer wraps
`fullProve` and `verify` only. The page is Chromium headless with the default
single-threaded WASM backend. Network transfer and UI rendering are excluded.
The zkey and WASM are served with `application/wasm` and
`application/octet-stream` over a local HTTP server.

Percentiles use the nearest-rank definition; medians of even-sized samples are
the average of the two middle values. All proofs were verified; any failure
aborted the run.

### 8.3 Results

All times in milliseconds.

| Runtime      | Depth | Prove median | Prove p95 | Verify median | Verify p95 |
| ------------ | ----: | -----------: | --------: | ------------: | ---------: |
| Node.js cold |    16 |        882.9 |   1,225.3 |          13.5 |       20.1 |
| Node.js cold |    24 |      1,154.9 |   1,278.1 |          14.1 |       20.4 |
| Node.js cold |    32 |      1,392.1 |   1,989.0 |          13.6 |       15.9 |
| Node.js warm |    16 |        606.9 |     663.5 |          10.3 |       19.7 |
| Node.js warm |    24 |        690.6 |     758.5 |          10.5 |       13.3 |
| Node.js warm |    32 |        992.0 |   1,013.7 |           9.8 |       10.2 |
| Browser WASM |    16 |        612.0 |     701.3 |           9.2 |       11.2 |
| Browser WASM |    24 |        726.1 |     731.6 |           8.9 |        9.0 |
| Browser WASM |    32 |      1,048.6 |   1,108.8 |           8.8 |        9.2 |

Browser versus warm Node.js:

| Depth | Prove delta | Verify delta | Interpretation                                              |
| ----: | ----------: | -----------: | ----------------------------------------------------------- |
|    16 |       +0.8% |       -10.7% | Parity; differences are within run noise                    |
|    24 |       +5.1% |       -15.2% | Browser slightly slower to prove, slightly faster to verify |
|    32 |       +5.7% |       -10.2% | Same pattern at the larger domain                           |

Cold Node.js is 40–67% slower than warm Node.js because every fresh process
pays curve initialization and WASM compilation. A serverless deployment should
budget the cold figure; a long-lived server can budget the warm figure.

### 8.4 Scaling and artifacts

| Depth | Constraints | Prove warm (ms) |    zkey | Witness WASM | Witness file |   Node RSS |
| ----: | ----------: | --------------: | ------: | -----------: | -----------: | ---------: |
|    16 |       9,615 |           606.9 | 4.55 MB |      1.80 MB |      0.31 MB | 384–555 MB |
|    24 |      13,775 |           690.6 | 6.06 MB |      1.83 MB |      0.44 MB | 634–660 MB |
|    32 |      17,935 |           992.0 | 8.61 MB |      1.86 MB |      0.57 MB | 608–732 MB |

Depth 16 to 24 adds 4,160 constraints and 83.7 ms (about 20 µs per
constraint). Depth 24 to 32 adds the same constraint count but 301.4 ms,
because the QAP domain doubles from $2^{14}$ to $2^{15}$ and the FFT cost
grows with the domain, not just the constraint count. Extrapolating proving
time linearly from constraint count alone will underestimate depth-32 and
larger circuits.

The zkey dominates the browser download. At 10 Mbps, 4.55 / 6.06 / 8.61 MB
takes about 3.6 / 4.9 / 6.9 s; at 50 Mbps, about 0.7 / 1.0 / 1.4 s. These
transfers are excluded from the timings above. Production clients should
pre-cache the zkey in a service worker, verify its hash, and show progress
during the first load.

Node RSS includes zkey buffers and is reported as a range across cold samples,
not a peak measurement. Browser memory was not instrumented. Mobile devices
were not tested; expect slower proving and higher memory pressure, and measure
on the target device class before committing to client-side proving.

### 8.5 Interpretation

- Browser proving is practical: 0.6–1.1 s on an Apple M2 for 9.6k–17.9k
  constraints, with verification under 12 ms.
- Client-side proving is the privacy-preserving deployment: the witness never
  leaves the device. Server-assisted proving sends `secret` and
  `nullifierKey` to the server and voids the anonymity claim unless the server
  is trusted.
- A depth-32 circuit with a 2^15 domain costs about 1 second and an 8.6 MB
  zkey. Depth 48 would cost roughly 1.5–2 seconds and a ~13 MB zkey (composed)
  (extrapolated), which is still plausible for a browser with caching.
- Verification is cheap enough to run on every request; the bottleneck is
  proving and the ledger round trip, not verification.

### 8.6 Reproduction

The exact commands, including the test vector and the benchmark scripts, are in
Appendix B. The raw samples are listed there so the medians and p95 values can
be checked independently.

---

## 9. Integration gaps and audit findings

These findings concern the current repository, not the reference circuit. They
are ordered by deployment impact.

| ID  | Severity          | Finding                                                                                                                                             | Evidence                                                                                                           | Recommendation                                                                                                                                |
| --- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Info              | No SMT circuit is implemented; the ledger is Redis/PostgreSQL                                                                                       | [`nullifierLedger.ts`](../../src/lib/zkp/nullifierLedger.ts), [`circuits/`](../../circuits)                        | Treat §2–§7 as the reference design; implement and audit before claiming SMT guarantees                                                       |
| F2  | High (functional) | The route loads `verification_key.json` with `nPublic = 1` but supplies four public signals; SnarkJS throws and the route returns 400               | [`route.ts`](../../src/app/api/auth/zkp/verify-nullifier/route.ts) lines 73–94; `public/zkp/verification_key.json` | Ship the SMT vkey (`nPublic = 4`), assert `publicSignals.length === vkey.nPublic`, and add a startup self-test                                |
| F3  | High (binding)    | `venueId` is a public signal but is not constrained by any circuit; a proof is valid for any `venueId`                                              | `route.ts` lines 55–57; `student_access_pass.circom` has three public inputs                                       | Bind `venueId` in the nullifier derivation, e.g. `Poseidon(4)(secret, nullifierKey, venueId, epoch)`, and add it to the circuit's public list |
| F4  | Medium            | The ledger key is `(nullifierHash, epoch)`, not `(venueId, nullifierHash, epoch)`; comments say venue-scoped but the semantics are global per epoch | `nullifierLedger.ts` lines 23–25, 78–82; Prisma unique `[nullifierHash, epoch]`                                    | Decide the policy; if per-venue, add `venueId` to the key and the unique constraint                                                           |
| F5  | Medium            | The route has no `mode` public signal, so spent and unspent proofs are not distinguished                                                            | `route.ts` line 28; reference ABI §2.3                                                                             | Add `mode` to the ABI; require `mode = 0` for check-in and `mode = 1` for spent-status queries                                                |
| F6  | High if SMT-only  | Depths 16/24/32 have prefix collisions; a targeted grind costs `2^L`                                                                                | §5                                                                                                                 | Use depth 48+, bucket commitments, or keep the ledger authoritative; reject or bucket colliding insertions                                    |
| F7  | Medium            | `Num2Bits(254)` admits a second decomposition for ~24.39% of keys, enabling an alternate path                                                       | §5.4                                                                                                               | Add an `S < r` range check or use 253-bit keys; keep the ledger authoritative until fixed                                                     |
| F8  | High (production) | The ptau and zkey are generated by a local single-contribution ceremony; toxic waste is not provably destroyed                                      | `scripts/compile-membership-zkp.sh`                                                                                | Use a public powers-of-tau ceremony and a multi-party phase 2; pin the vkey hash                                                              |
| F9  | Low               | The circuit does not bind `pathIndices` to the low bits of `leafKey`, so the tree must enforce canonical insertion                                  | §5.3                                                                                                               | Enforce at insertion; optionally add a second `Num2Bits(254)` on `leafKey` (+255 constraints)                                                 |
| F10 | Low (library)     | SnarkJS aggregates only the supplied public signals; omitting a trailing zero-valued input still verifies                                           | §7.4                                                                                                               | Assert the exact length and bind every signal explicitly                                                                                      |

F2 fails closed: the route catches the exception and returns a validation
error, so it is a deployment blocker rather than a verification bypass. F3 is
the most important semantic gap: without binding `venueId`, a valid proof can
be replayed at a different venue, and the global ledger is the only thing that
stops a second claim.

### 9.1 Production checklist

- **Circuit:** SMT with `mode`, `venueId` binding, `S < r` range check or
  253-bit keys, canonical `leafKey` path binding, depth 48+ or bucket
  commitments.
- **Setup:** public ptau, multi-party phase 2, vkey pinning by hash, manifest
  with circuit hash, `nPublic`, and the public signal ABI.
- **Verifier:** exact signal count, root freshness registry, epoch check,
  expected `mode`, atomic ledger claim, venue scoping, idempotent token
  reissue.
- **Client:** client-side proving in a Web Worker, progress and cancel UI,
  zkey cached and hash-checked, explicit consent before any server-assisted
  proving.
- **Operations:** monitor low-`L`-bit collisions at insertion, tree occupancy,
  ledger lag, and proof failure rates; alert on duplicate inserts.
- **Audit:** circuit audit, cryptographic review of the setup and ledger,
  penetration test of the verifier and token flow.

---

## 10. Limitations

- The benchmarks are a single-machine, single-run study. They are indicative,
  not a service-level guarantee.
- The reference circuit is not deployed. The repository's depth-16 circuit and
  ledger are different artifacts with different constraint counts (§4.4).
- The proofs assume A1–A7. Poseidon's collision resistance and PRF behavior
  are heuristic; Groth16's knowledge soundness is in the generic group model.
- The collision analysis assumes uniformly random keys. A biased or
  attacker-chosen key distribution can only make collisions easier.
- The zkey extrapolations for depth 48+ are linear approximations and are
  labeled as such.
- Mobile, Safari/Firefox, multi-threaded WASM, SIMD, and native provers were
  not measured.
- This document does not replace a formal audit of the deployed circuit, the
  setup ceremony, or the ledger implementation.

---

## Appendix A: Test vector

Generated with [`src/lib/zkp/poseidon.ts`](../../src/lib/zkp/poseidon.ts),
which must agree bit-for-bit with circomlib's Poseidon.

| Field                | Value                                                                           |
| -------------------- | ------------------------------------------------------------------------------- |
| `secret`             | `12345678901234567890`                                                          |
| `nullifierKey`       | `98765432109876543210`                                                          |
| `epoch`              | `2026`                                                                          |
| `nullifierHash`      | `12545095150152758256898079661562688125907388800776851673137935628625444857437` |
| `key`                | `241103004732688986398759425503293272097697277063164166647370474334156494245`   |
| key low 32 bits      | `10100101101010000001001011001001` (LSB first)                                  |
| empty leaf $z_0$     | `14744269619966411208579211824598458697587494354926760081771325075741142829156` |
| empty root, depth 16 | `21035245323335827719745544373081896983162834604456827698288649288827293579666` |
| empty root, depth 24 | `21694045479371014653083846597424257852691458318143380497809004364947786214945` |
| empty root, depth 32 | `7694308195910501081009121293114024464085863242234210875116972222894508088593`  |

The witness used for the benchmarks is a valid non-membership proof against
the empty tree: `leafKey = 0`, `leafValue = 0`, `mode = 0`,
`pathElements = [z_0, ..., z_{L-1}]`, and `pathIndices` equal to the low `L`
bits of `key`. Public signals for depth 16 are
`["21035245323335827719745544373081896983162834604456827698288649288827293579666",
"12545095150152758256898079661562688125907388800776851673137935628625444857437",
"2026", "0"]`.

## Appendix B: Reproduction

The commands assume the repository root and the toolchain in §8.1. The
circuit is the listing in §2.2; write it to a temporary file.

### B.1 Compile and inspect

```bash
mkdir -p /tmp/zkp-smt
# Write the §2.2 listing to /tmp/zkp-smt/smt.circom, then:
npx circom2 /tmp/zkp-smt/smt.circom \
  --r1cs --wasm --sym -l node_modules -o /tmp/zkp-smt

npx snarkjs r1cs info /tmp/zkp-smt/smt.r1cs
```

For depth 24 and 32, replace `SMTNullifierVerifier(16)` with
`SMTNullifierVerifier(24)` or `SMTNullifierVerifier(32)` in the instantiation
line and recompile. The compiler output must match §4.1.

### B.2 Powers of tau and zkey

Power 15 covers all three depths; power 14 is enough for depths 16 and 24.

```bash
cd /tmp/zkp-smt
npx snarkjs powersoftau new bn128 15 pot15_0000.ptau -v
npx snarkjs powersoftau contribute pot15_0000.ptau pot15_0001.ptau \
  --name="worksphere-7738" -e="$(openssl rand -hex 32)"
npx snarkjs powersoftau prepare phase2 pot15_0001.ptau pot15_final.ptau -v

npx snarkjs groth16 setup smt.r1cs pot15_final.ptau smt_0000.zkey
npx snarkjs zkey contribute smt_0000.zkey smt_final.zkey \
  --name="worksphere-7738" -e="$(openssl rand -hex 32)"
npx snarkjs zkey export verificationkey smt_final.zkey smt_vkey.json
```

The single-contribution ceremony is for local reproduction only. See §7.6.

### B.3 Witness and proof

Generate the input with the Poseidon implementation. The script below uses
`poseidonHash` from `src/lib/zkp/poseidon.ts`; bundle it first with
`npx esbuild src/lib/zkp/poseidon.ts --bundle --format=cjs --platform=node --outfile=/tmp/zkp-smt/poseidon.cjs`.

```js
const fs = require("fs");
const { poseidonHash } = require("/tmp/zkp-smt/poseidon.cjs");

const secret = 12345678901234567890n;
const nullifierKey = 98765432109876543210n;
const epoch = 2026n;
const nh = poseidonHash([secret, nullifierKey, epoch]);
const key = poseidonHash([nh, epoch]);

const zero = [poseidonHash([0n, 0n])];
for (let i = 1; i <= 32; i++) {
  zero.push(poseidonHash([zero[i - 1], zero[i - 1]]));
}

const bits = [];
let rest = key;
for (let i = 0; i < 32; i++) {
  bits.push((rest & 1n).toString());
  rest >>= 1n;
}

for (const depth of [16, 24, 32]) {
  const input = {
    root: zero[depth].toString(),
    nullifierHash: nh.toString(),
    epoch: epoch.toString(),
    mode: "0",
    leafKey: "0",
    leafValue: "0",
    pathElements: zero.slice(0, depth).map((v) => v.toString()),
    pathIndices: bits.slice(0, depth),
  };
  fs.writeFileSync(`/tmp/zkp-smt/input${depth}.json`, JSON.stringify(input));
}
```

Then:

```bash
cd /tmp/zkp-smt
npx snarkjs wtns calculate smt_js/smt.wasm input16.json witness16.wtns
npx snarkjs groth16 prove smt_final.zkey witness16.wtns proof16.json public16.json
npx snarkjs groth16 verify smt_vkey.json public16.json proof16.json
```

### B.4 Node.js benchmark

Run one depth per process to avoid the repeated-call hang observed in this
environment; take five cold samples and six warm samples as in §8.2.

```bash
# Cold: timer around fullProve in a fresh process.
node bench-one.cjs 16
# Warm: one discarded warm-up, then two measured proofs per process.
node bench-warm.cjs 16
```

The scripts are short; the essential timer is:

```js
const t0 = performance.now();
const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  input,
  `/tmp/zkp-smt/smt_js/smt.wasm`,
  `/tmp/zkp-smt/smt_final.zkey`,
);
const t1 = performance.now();
const ok = await snarkjs.groth16.verify(vkey, publicSignals, proof);
const t2 = performance.now();
```

### B.5 Browser benchmark

Serve `/tmp/zkp-smt` and `node_modules/snarkjs/build/snarkjs.min.js` over HTTP,
open a fresh Chromium page per sample, pre-fetch the WASM, zkey, and vkey,
then run `fullProve` and `verify` inside `page.evaluate`. The measured samples
are in §8.3. Use `application/wasm` for the witness WASM; otherwise Chromium
falls back to a slower instantiation path.

## Appendix C: Raw benchmark samples

Node.js cold (five samples per depth):

| Depth | Prove samples (ms)                          | Verify samples (ms)          |
| ----: | ------------------------------------------- | ---------------------------- |
|    16 | 1,225.3; 795.2; 1,058.6; 882.9; 782.5       | 16.9; 10.9; 12.7; 13.5; 20.1 |
|    24 | 1,019.2; 1,278.1; 1,244.3; 1,044.8; 1,154.9 | 20.4; 14.1; 11.2; 19.5; 11.4 |
|    32 | 1,392.1; 1,294.7; 1,314.2; 1,989.0; 1,622.7 | 11.7; 15.9; 9.8; 13.6; 14.6  |

Node.js warm (six samples per depth):

| Depth | Prove samples (ms)                         | Verify samples (ms)              |
| ----: | ------------------------------------------ | -------------------------------- |
|    16 | 637.4; 605.9; 598.9; 606.0; 607.7; 663.5   | 10.4; 9.8; 10.3; 19.7; 10.2; 9.4 |
|    24 | 758.5; 723.3; 677.1; 674.0; 676.8; 704.1   | 11.1; 12.0; 9.7; 8.7; 9.8; 13.3  |
|    32 | 995.1; 968.1; 1,013.7; 988.9; 999.1; 971.3 | 10.0; 9.0; 10.1; 9.0; 9.6; 10.2  |

Browser WASM (five samples per depth; sample values are rounded to the nearest
millisecond here, while the medians and p95 in §8.3 are computed from the
unrounded timings):

| Depth | Prove samples (ms)                | Verify samples (ms) |
| ----: | --------------------------------- | ------------------- |
|    16 | 664; 701; 607; 603; 612           | 9; 11; 9; 9; 10     |
|    24 | 712; 708; 732; 731; 726           | 9; 9; 9; 9; 9       |
|    32 | 1,063; 1,003; 1,049; 1,109; 1,004 | 9; 9; 9; 9; 9       |

## References

- J. Groth. "On the Size of Pairing-Based Non-interactive Arguments."
  EUROCRYPT 2016.
- Circom documentation: <https://docs.circom.io/>
- circomlib Poseidon implementation:
  <https://github.com/iden3/circomlib/tree/master/circuits>
- SnarkJS: <https://github.com/iden3/snarkjs>
- Poseidon: <https://eprint.iacr.org/2019/458>
- BN254 and pairing security: <https://hackmd.io/@jpw/bn254>
- Repository documents:
  [`GROTH16_CIRCUIT_CONSTRAINTS.md`](./GROTH16_CIRCUIT_CONSTRAINTS.md),
  [`circuit-specification.md`](./circuit-specification.md),
  [`ZKP_VERIFICATION_PROTOCOL.md`](../ZKP_VERIFICATION_PROTOCOL.md),
  [`ZKP_STUDENT_MEMBERSHIP.md`](../ZKP_STUDENT_MEMBERSHIP.md).
