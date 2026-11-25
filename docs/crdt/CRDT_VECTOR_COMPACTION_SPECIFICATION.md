# Formal Specification: State-Vector Compaction, Tombstone Reclamation, and Peer Eviction

- **Issue:** [#7737](https://github.com/SatyamPandey-07/WorkSphere/issues/7737)
- **Status:** Formal specification. Journal compaction is implemented;
  peer-vector eviction and stabilized tombstone collection are reference
  designs.
- **Last verified:** 2026-11-14
- **Toolchain:** Yjs 13.6.33, `idb` 8.0.3, y-protocols 1.0.7, y-partykit 0.0.33.

This document gives the mathematical model behind
[`src/lib/crdt/canvasProvider.ts`](../../src/lib/crdt/canvasProvider.ts): what it
means for a historical update chunk to be _squashed_ into a base snapshot, why
that operation preserves convergent eventual consistency, when a deletion
tombstone may be reclaimed, and under which conditions a stalled peer may be
evicted without corrupting the causal history. It is written to be checkable by
an auditor: every definition maps to a Yjs primitive, and every proof names the
assumption it consumes.

> **Implementation status.**
>
> | Capability                                                      | State                 | Where                                                              |
> | --------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------ |
> | In-memory full-state encoding and round-trip verification       | Implemented           | `NomadCanvasProvider.compactState`, `assertSnapshotReconstructs`   |
> | IndexedDB journal compaction with atomic snapshot-plus-prune    | Implemented           | `CanvasChangeJournal.compact`, `NomadCanvasProvider.runCompaction` |
> | State-vector domination check between a document and a snapshot | Implemented           | `isStateVectorBehind` in `snapshotManager.ts`                      |
> | Stale-presence pruning (15 s heartbeat timeout)                 | Implemented           | `AwarenessProtocol`                                                |
> | Transport-epoch mismatch → full-state fallback                  | Implemented           | `party/server.ts`, `handleSyncRequest`                             |
> | Retention-epoch peer eviction driven by stalled state vectors   | Reference design      | §6, §7.3                                                           |
> | Tombstone reclamation gated on a stability frontier             | Reference design      | §5, §7.4                                                           |
> | Frontier-gated pruning of app-level tombstone records           | Implemented (library) | `src/lib/offline/tombstoneCompactor.ts` (§5.5)                     |
>
> Yjs exposes no public API for selectively dropping delete-set entries, so
> stabilized tombstone collection inside a **Yjs document** requires an update
> rewriter and is not something the current code can do. The persisting room
> server runs with `gc: false` (`party/server.ts`), which keeps deleted payloads
> and delete-set entries in the snapshot. §5 specifies what a correct
> implementation must prove before enabling collection. The frontier-gated
> collector in §5.5 is the same policy applied earlier in the stack: it prunes
> application-level tombstone _records_ in IndexedDB, which it can delete, and
> never touches Yjs structs.

## Contents

1. [Scope and notation](#1-scope-and-notation)
2. [Formal model](#2-formal-model)
3. [The squash invariant](#3-the-squash-invariant)
4. [Convergence proofs](#4-convergence-proofs)
5. [Tombstones and reclamation](#5-tombstones-and-reclamation)
6. [Peer eviction](#6-peer-eviction)
7. [Algorithms](#7-algorithms)
8. [Durability analysis](#8-durability-analysis)
9. [Parameters](#9-parameters)
10. [Failure modes and threats](#10-failure-modes-and-threats)
11. [Verification and tests](#11-verification-and-tests)
12. [Limitations](#12-limitations)
13. [Related documents](#13-related-documents)

## 1. Scope and notation

### 1.1 What this specification covers

1. A formal model of a Yjs replica, an update, a state vector, and a base
   snapshot (§2).
2. The exact squash-eligibility invariant, including a verified
   counterexample showing why the commonly quoted inequality is necessary but
   not sufficient for incremental chunks (§3).
3. Step-by-step proofs that compaction is a join homomorphism and therefore
   preserves strong eventual consistency (§4).
4. Tombstone semantics and the stability frontier required for reclamation
   (§5).
5. Peer-eviction semantics for disconnected or stalled peers, with the safety
   preconditions that keep eviction from orphaning writes (§6).
6. Algorithms for the in-memory document and the IndexedDB journal, plus the
   reference eviction and collection loops (§7, §8).

### 1.2 Notation

| Symbol                      | Meaning                                                                |
| --------------------------- | ---------------------------------------------------------------------- |
| $\mathbb{N}$                | Natural numbers, used for clocks                                       |
| $C$                         | Set of client identifiers (Yjs `clientID`, a 32-bit integer)           |
| $s=\langle c,k,\ell\rangle$ | Struct authored by client $c$, starting at clock $k$, of length $\ell$ |
| $I(s)$                      | Identity interval $[k,k+\ell)$                                         |
| $S_r$                       | Struct store of replica $r$                                            |
| $D_r$                       | Delete set of replica $r$, a set of struct identities                  |
| $V_r$                       | State vector of replica $r$: $C \to \mathbb{N}$                        |
| $u$                         | Update: a pair $(S_u, D_u)$                                            |
| $V_u$                       | State vector _of the update_, computed from its structs                |
| $B$                         | Base snapshot: an encoded document plus its state vector and checksum  |
| $R_e$                       | Set of retained replicas at retention epoch $e$                        |
| $F_e$                       | Stability frontier at epoch $e$                                        |
| $\tau$                      | Eviction threshold, in retention epochs                                |

### 1.3 Relationship to the existing state-vector documents

[`CRDT_VECTOR_MATHEMATICAL_SPEC.md`](./CRDT_VECTOR_MATHEMATICAL_SPEC.md) and
[`CRDT_VECTOR_COMPACTION.md`](./CRDT_VECTOR_COMPACTION.md) define the state
vector as the **largest contiguous clock observed**:

$$
SV[c] = \max\{\,k \mid \forall j \le k,\ (c,j) \in D\,\}.
$$

Yjs itself returns the **next expected clock**:

$$
V(c) = \sup\{\,k + \ell \mid \langle c,k,\ell\rangle \in S\,\},
\qquad \sup\varnothing = 0.
$$

The two differ by exactly one: $V(c) = SV[c] + 1$. This document uses the
half-open form because that is what `Y.encodeStateVector`, `getState`, and
`Y.decodeStateVector` return, and because half-open intervals make the
domination relation a plain product order. All comparisons here are internally
consistent; when reading the older documents, shift by one before mixing
results. The reclamation condition in §5.3 depends on this convention: a
tombstone at clock $k$ is safe to collect when $k < F(c)$ in the half-open
form, which is $k \le SV_{\min}[c]$ in the older form.

## 2. Formal model

### 2.1 Replicas, structs, and identity

A struct is an immutable tuple

$$
s = \langle c, k, \ell, p \rangle,
$$

where $p$ is the payload and dependency metadata. Its identity is the pair
$(c,k)$, and it occupies the clock interval $I(s) = [k, k+\ell)$. Identity is
immutable for the lifetime of the document:

> **A1 (Immutability).** No operation changes $c$, $k$, $\ell$, or the payload
> of an existing struct. Compaction re-encodes structs; it never rewrites them.

Per-client clocks are allocated densely, and Yjs represents undecided ranges
with `Skip` structs when a partial update is integrated. This gives the prefix
property that makes a state vector sufficient:

> **A2 (Decided prefix).** For every client $c$, every clock $j < V_r(c)$ is
> decided on replica $r$: it is either integrated into $S_r$ or explicitly
> known to be missing via a `Skip`. No clock below the frontier is unknown.

Two structs with the same identity are the same struct. This is why applying
the same update twice is a no-op, which the next lemma records.

### 2.2 State vector and update vector

**Definition 1 (Replica state vector).** For replica $r$,

$$
V_r(c) = \sup\{\, k + \ell \;\mid\; \langle c,k,\ell\rangle \in S_r \,\},
\qquad \sup \varnothing = 0.
$$

This is exactly `Y.encodeStateVector(doc)` and `getState(store, client)` in
Yjs. A client that has never been seen contributes $0$.

**Definition 2 (Update state vector).** For an update $u$,

$$
V_u(c) = \sup\{\, k + \ell \;\mid\; \langle c,k,\ell\rangle \in S_u,\ [0,k) \text{ is decided within } u \,\}.
$$

Operationally this is `Y.encodeStateVectorFromUpdate(u)`. The qualifier matters:
Yjs counts only a client's **leading contiguous run starting at clock 0**. A
`Skip` or a first struct with $k>0$ stops the count. Consequently $V_u(c)$ is a
_lower bound_ on the highest clock present in $u$, not an exact description of
the chunk. §3.3 shows why this distinction is load-bearing.

### 2.3 Delete sets and visibility

**Definition 3 (Delete set).** $D_r \subseteq C \times \mathbb{N}$ is the set of
struct identities that replica $r$ has seen deleted. Yjs compresses it as
per-client clock ranges. $D_r$ is monotone until garbage collection:

> **A3 (Monotone deletion).** Applying an update can only add identities to
> $D_r$. No operation removes an entry except a frontier-gated collection
> (§5).

**Definition 4 (Visibility).** A struct $s$ is visible on $r$ when

$$
\mathrm{vis}_r(s) = 1
\iff
s \in S_r
\;\land\;
(c_s,k_s) \notin D_r
\;\land\;
\mathrm{deps}(s) \subseteq S_r.
$$

The payload is present, not deleted, and its causal dependencies are satisfied.
The materialized canvas is a deterministic function of $(S_r, D_r)$:

> **A4 (Deterministic materialization).** Two replicas with the same struct set
> and the same delete set display the same document, including the winner of
> every concurrent edit. Yjs resolves competing writes by struct identity
> (client id, then clock), not by arrival order.

### 2.4 Update, join, and history

An update is a pair $u=(S_u,D_u)$. Applying $u$ to a replica is set union with
identity-based deduplication:

$$
(S,D) \sqcup (S_u,D_u) = (S \cup S_u,\; D \cup D_u).
$$

> **A5 (Join laws).** $\sqcup$ is idempotent, commutative, and associative on
> struct sets because union is, and struct identity makes duplicate inserts
> collapse. This is the standard state-based CRDT join.

A history $H=[u_1,\dots,u_n]$ folds to

$$
\mathrm{fold}(H) = u_1 \sqcup u_2 \sqcup \cdots \sqcup u_n,
$$

and a replica's document is $\mathrm{fold}(H_r)$ for the updates it has
delivered. Because of A5, the fold is independent of delivery order and
duplicates.

> **A6 (Lossless encoding).** $\mathrm{encode}(S,D)$ is a binary update whose
> application reconstructs $(S,D)$, and encoding the same $(S,D)$ twice
> produces byte-identical output. The second half is what makes the FNV-1a
> checksum in `computeChecksum` a valid equality test: equal checksums imply
> equal struct and delete sets, up to the (negligible) hash collision
> probability.

The checksum is a _diagnostic_, not a security primitive. It detects
divergence; it does not prove agreement against an adversary who can craft
collisions.

## 3. The squash invariant

### 3.1 The invariant from the issue

The issue proposes the following criterion before a chunk may be folded into a
base snapshot:

$$
\forall c \in C:\quad V_{\text{current}}(c) \ge V_{\text{update}}(c).
$$

**Definition 5 (Domination).** For a base $B$ with vector $V_B$ and an update
$u$ with vector $V_u$,

$$
B \sqsupseteq u
\iff
\forall c \in C:\; V_B(c) \ge V_u(c).
$$

This is the pointwise product order on $C \to \mathbb{N}$. In the codebase it
appears as the negation of `isStateVectorBehind(local, remote)`, which returns
true exactly when some client entry of `local` is below `remote`:

```ts
// src/lib/crdt/snapshotManager.ts
export function isStateVectorBehind(local, remote) {
  const localClock = Y.decodeStateVector(local);
  const remoteClock = Y.decodeStateVector(remote);
  for (const [clientId, clock] of remoteClock) {
    if ((localClock.get(clientId) ?? 0) < clock) return true;
  }
  return false;
}
```

So `B ⊇ u` is exactly `!isStateVectorBehind(V_B, V_u)`.

### 3.2 Domination is necessary for redundancy

**Lemma 1 (Necessity).** If every struct of $u$ lies strictly below the base
frontier, that is, for every $\langle c,k,\ell\rangle \in S_u$ we have
$k+\ell \le V_B(c)$, then $B \sqsupseteq u$.

_Proof._ Fix $c$. Every struct of $u$ authored by $c$ ends at or below
$V_B(c)$, so the supremum in Definition 2 is at most $V_B(c)$; the leading-run
qualifier can only lower it further. Hence $V_u(c) \le V_B(c)$ for every $c$.
$\square$

The contrapositive is the useful operational form: if $B \not\sqsupseteq u$,
then $u$ contains a struct at or above the base frontier, so $u$ cannot be
redundant. This is why a failing domination check must block pruning.

### 3.3 Domination is not sufficient for incremental chunks

The converse of Lemma 1 fails, for two independent reasons.

**Reason 1: under-reported update vectors.** Lemma 1 needs
$V_u$ to describe the chunk. But `Y.encodeStateVectorFromUpdate` only counts a
leading run from clock 0. A local edit, a replayed journal block, or a batched
`Y.mergeUpdates` output typically starts at $k>0$, so it reports
$V_u(c)=0$ even when it carries structs far above the base frontier. The
inequality is then vacuously true for that client.

**Reason 2: delete sets.** $V_u$ says nothing about $D_u$. A chunk can contain
only deletions, with an empty struct set, and still change visibility when
applied to a base that has not seen those deletions.

The following case was reproduced with Yjs 13.6.33 for this document:

```js
const Y = require("yjs");
const d = new Y.Doc();
const t = d.getText("t");
for (let i = 0; i < 5; i++) t.insert(i, "x");
const sv5 = Y.encodeStateVector(d); // V = 5
for (let i = 5; i < 10; i++) t.insert(i, "y");

const delta = Y.encodeStateAsUpdate(d, sv5); // structs 5..9
Y.decodeStateVector(Y.encodeStateVectorFromUpdate(delta)); // Map(0) {}  <-- empty
```

Applying `delta` to a fresh document leaves the state vector empty and parks
the structs in `pendingStructs`, yet the document has changed. The measured
outcomes are:

| Base $B$        | Chunk $u$                      | $V_B$ | $V_u$ | Inequality | $u$ redundant?          |
| --------------- | ------------------------------ | ----: | ----: | ---------- | ----------------------- |
| empty           | full update, clocks $[0,10)$   |     0 |    10 | fails      | no (correctly rejected) |
| clocks $[0,10)$ | suffix update, clocks $[5,10)$ |    10 |     0 | passes     | yes                     |
| empty           | suffix update, clocks $[5,10)$ |     0 |     0 | **passes** | **no — unsound**        |
| clocks $[0,10)$ | full update, clocks $[0,10)$   |    10 |    10 | passes     | yes                     |

Row 3 is the counterexample. A naive implementation of the issue's inequality,
applied per journal record, would delete a record that the base does not cover.

### 3.4 The operational predicate

The condition that is actually sufficient combines frontier domination with
explicit set inclusion:

$$
\mathsf{Squash}(B,u)
\iff
\underbrace{V_B \sqsupseteq V_u}_{\text{necessary frontier check}}
\;\land\;
\underbrace{\mathrm{ids}(S_u) \subseteq \mathrm{decided}(B)}_{\text{struct coverage}}
\;\land\;
\underbrace{D_u \subseteq D_B}_{\text{delete coverage}}.
$$

Here $\mathrm{decided}(B)$ is the set of identities below $B$'s frontier,
$\{\,(c,j) : j < V_B(c)\,\}$. Equivalently, and more directly:

$$
\mathsf{Squash}(B,u)
\iff
\mathrm{encode}(B \sqcup u) = \mathrm{encode}(B).
$$

The right-hand form is the one an implementation should test, because it
captures both struct and delete effects. It costs one scratch document and two
encodings, which is exactly what `assertSnapshotReconstructs` already does for
snapshots:

```ts
const scratch = new Y.Doc();
Y.applyUpdate(scratch, encode(B));
Y.applyUpdate(scratch, u);
assert(
  computeChecksum(Y.encodeStateAsUpdate(scratch)) ===
    computeChecksum(encode(B)),
);
```

**Proposition 1.** If $\mathsf{Squash}(B,u)$ holds, then applying $u$ to $B$
does not change the materialized document.

_Proof._ The hypothesis says $\mathrm{encode}(B \sqcup u)$ and
$\mathrm{encode}(B)$ are the same bytes. By A6, encoding is injective on
$(S,D)$ up to that byte representation, so $S_B \cup S_u = S_B$ and
$D_B \cup D_u = D_B$. Therefore $u$ adds no struct and marks nothing newly
deleted. By A4 the materialized document is unchanged. $\square$

### 3.5 What the implemented compactor actually relies on

`runCompaction` does not test each journal block against Definition 5. It does
something stronger and simpler:

1. Read the journal boundary `stats.latestSeq` **before** encoding.
2. Call `restoreFromJournal()`, which applies the stored snapshot and then
   every surviving block in ascending `seq` order to the live document.
3. Encode the live document, so the base is by construction the fold of the
   baseline and every block at or below the boundary.
4. Prune only blocks with `seq <= throughSeq` in the same IndexedDB
   transaction that writes the snapshot.

The domination check appears afterwards, as a consistency assertion between the
live document and the persisted snapshot:

```ts
if (isStateVectorBehind(Y.encodeStateVector(this.doc), persistedVector)) {
  throw new CanvasSnapshotIntegrityError(/* snapshot ahead of document */);
}
```

This ordering is what makes the per-chunk insufficiency harmless: the base is
derived from a fold that already contains the pruned chunks, so the struct and
delete coverage conditions of §3.4 hold by construction. The frontier
inequality is retained as defence in depth, not as the pruning authority. Any
future implementation that prunes a chunk **without** first folding it into the
base must use Proposition 1, not the bare inequality.

## 4. Convergence proofs

This section proves that compaction preserves strong eventual consistency
(SEC). The argument has four steps: the join laws, encoding round-trip,
substitution of equal values, and the SEC theorem itself.

### 4.1 Step 1: histories form a join semilattice

By A5, struct and delete sets under union form a join semilattice
$(\mathcal{D}, \sqcup, \sqsubseteq)$ where $\sqsubseteq$ is set inclusion per
component. For any two histories $H_1, H_2$:

$$
\begin{aligned}
\text{Idempotence:} && \mathrm{fold}(H_1) \sqcup \mathrm{fold}(H_1) &= \mathrm{fold}(H_1),\\
\text{Commutativity:} && \mathrm{fold}(H_1) \sqcup \mathrm{fold}(H_2) &= \mathrm{fold}(H_2) \sqcup \mathrm{fold}(H_1),\\
\text{Associativity:} && (\mathrm{fold}(H_1) \sqcup \mathrm{fold}(H_2)) \sqcup \mathrm{fold}(H_3) &= \mathrm{fold}(H_1) \sqcup (\mathrm{fold}(H_2) \sqcup \mathrm{fold}(H_3)).
\end{aligned}
$$

These are inherited from set union. The generic proof is already recorded in
[`state-based-resolution.md`](./state-based-resolution.md) §5; it is not
repeated here.

### 4.2 Step 2: encoding is a section of the fold

**Lemma 2 (Round-trip).** For any document state $(S,D)$ with no undecided
pending structs,

$$
\mathrm{fold}\big(\mathrm{encode}(S,D)\big) \equiv (S,D),
$$

where $\equiv$ means equality of struct sets and delete sets.

_Proof._ By A6, applying `encode(S,D)` to the empty state reconstructs exactly
the structs and delete entries that were encoded. No identity is renumbered,
because A1 fixes $c$ and $k$. $\square$

The pending-struct restriction is real. Yjs keeps structs whose dependencies
have not arrived in `doc.store.pendingStructs`, outside the struct store and
outside the state vector. `Y.encodeStateAsUpdate` does not serialize them.
Compaction must therefore run only when the pending set is empty, or it will
snapshot a document that cannot reconstruct the pending state. §12 records this
as a deployment precondition.

### 4.3 Step 3: replacing a prefix by its encoding is an equality

Let $H = J_p \cdot J_s$, where $J_p = [u_1,\dots,u_m]$ is the pruned prefix,
$J_s = [u_{m+1},\dots,u_n]$ is the suffix that remains, and $\cdot$ is list
concatenation. Define

$$
B' = \mathrm{encode}\big(\mathrm{fold}(J_p)\big).
$$

**Lemma 3 (Prefix substitution).** $\mathrm{fold}(B') \equiv \mathrm{fold}(J_p)$.

_Proof._ Apply Lemma 2 to $(S,D)=\mathrm{fold}(J_p)$. $\square$

### 4.4 Step 4: the compacted history has the same join

**Theorem 1 (Squash safety).** For every suffix $J_s$,

$$
\mathrm{fold}(B') \sqcup \mathrm{fold}(J_s)
\;\equiv\;
\mathrm{fold}(J_p) \sqcup \mathrm{fold}(J_s).
$$

_Proof._ Substitute Lemma 3 into the left-hand side. The join is a congruence
with respect to $\equiv$ because it operates componentwise on sets. $\square$

In words: the compacted history and the original history denote the same
element of the semilattice. Compaction changes the representation, not the
value.

### 4.5 Step 5: SEC is preserved

**Theorem 2 (Convergence preservation).** Let replicas $r$ and $s$ deliver the
same set of updates after compaction, in any order and with any duplicates.
Then $D_r = D_s$ and both display the same document.

_Proof._ By A5, order and duplicates do not affect the fold, so
$D_r = \mathrm{fold}(H) = D_s$ for the delivered set $H$. Theorem 1 shows that
compaction replaces a subterm of that fold by an equal value, so the fold of
the compacted history equals the fold of the original history. By A4 the
materialized document is a deterministic function of $(S,D)$, hence the same on
both replicas. $\square$

**Corollary 1 (Compaction is a homomorphism).** Let $K_m$ be the operator that
replaces the first $m$ updates of a history by their encoding. Then

$$
\mathrm{fold}(K_m(H)) = \mathrm{fold}(H).
$$

Compaction therefore commutes with the join: compacting before or after
merging two histories yields the same document.

### 4.6 Repeated and concurrent compaction

**Theorem 3 (Idempotence and confluence).**

1. Compacting the same prefix twice yields the same base, up to encoding order.
2. If boundary $m_2 \ge m_1$, the base produced at $m_2$ dominates the base
   produced at $m_1$.
3. Two compactions with boundaries $m_1,m_2$ commute.

_Proof._

1. Both runs encode $\mathrm{fold}(J_p)$ for the same prefix; A6 makes the
   bytes identical.
2. The fold over a longer prefix contains the fold over a shorter one, because
   $\sqcup$ is monotone in each argument. Encoded frontiers are monotone
   because the state vector is derived from the struct store.
3. Apply Theorem 1 twice; both orders reduce to the same fold, and by (1) the
   final base is the encoding of that fold. $\square$

### 4.7 What compaction does not preserve

The proof says the _document_ is preserved. It does not say that every
observable is preserved:

- **Undo depth.** A snapshot has no history to undo into. Dropping the
  `UndoManager` stack at a checkpoint is safe for content and unsafe for user
  expectations; the product decision must be explicit.
- **Per-update provenance.** After compaction, individual transactions are no
  longer distinguishable in storage. Audit logs that need per-operation
  attribution must be kept separately.
- **Pending structs.** See §4.2 and §12.
- **Checksum stability across encoders.** A6 is a statement about one Yjs
  version. Upgrading Yjs can change the byte encoding of the same logical
  state; a checksum recorded by an older client is not a cross-version
  equality proof.

## 5. Tombstones and reclamation

### 5.1 Why tombstones exist

Deleting a struct does not remove it from the causal history. It records that
the struct is deleted, while keeping its identity so that a delayed insert
cannot make the object reappear. Formally, deletion adds the struct identity to
$D_r$, and visibility is defined by Definition 4.

**Example 1 (Resurrection).** Client $A$ inserts struct $s=\langle A,7,1\rangle$.
Client $A$ then deletes it and advertises $D_A \ni (A,7)$. Replica $B$ was
offline and holds only the pre-deletion update containing $s$. If every replica
forgets $(A,7)$ and $B$ reconnects, applying $B$'s update makes $s$ visible
again: the object returns from the dead. A tombstone is exactly the memory that
prevents this.

Yjs has two modes:

- `gc: true` replaces the deleted item's payload with a `GC` placeholder of the
  same identity and may then drop the delete-set entry, because the placeholder
  itself encodes "deleted". Identity is never reused.
- `gc: false` keeps the deleted payload and the delete-set entry. The persisting
  room server uses this mode so a snapshot can be replayed without losing the
  deletion boundary.

Both modes preserve identity. That is the property the proofs below depend on.

### 5.2 The stability frontier

Let $R_e$ be the set of replicas whose acknowledgements are retained at
retention epoch $e$, and let $V_{r,e}$ be the state vector each replica
acknowledged for that epoch.

**Definition 6 (Stability frontier).**

$$
F_e(c) = \min_{r \in R_e} V_{r,e}(c),
\qquad F_e(c) = 0 \text{ when } R_e = \varnothing.
$$

The frontier is the clock below which **every retained replica** has decided the
history. It is the compaction analogue of a distributed garbage-collection
watermark.

**Definition 7 (Collectible tombstone).** A tombstone entry covering struct
identities $I \subseteq C \times \mathbb{N}$ is collectible at epoch $e$ when

$$
\max_{(c,k) \in I} k < F_e(c)
\quad\text{and}\quad
\text{the deletion clock } d < F_e(c_d).
$$

The first condition says every deleted struct is below the frontier. The second
says the deletion event itself is below the frontier.

**Lemma 4 (Frontier monotonicity).** If $R_{e+1} \subseteq R_e$, then
$F_{e+1}(c) \ge F_e(c)$ for every $c$.

_Proof._ The minimum is taken over a subset, and removing elements from a finite
set can only increase its minimum. $\square$

Monotonicity is why eviction and reclamation interact: evicting a peer removes
a constraint from the minimum, so the frontier can advance. This is also why
eviction is the dangerous operation: an unjustified eviction advances the
frontier over history the evicted peer had not acknowledged.

### 5.3 Non-resurrection theorem

**Theorem 4 (Non-resurrection).** Assume:

1. the base snapshot $B$ dominates the frontier, $V_B(c) \ge F_e(c)$ for all $c$;
2. tombstone $t$ is collectible at epoch $e$ in the sense of Definition 7;
3. the collected identity range is retained as a compact summary, and any
   update carrying an identity inside that range is rejected or dropped.

Then no future update delivered to any replica that starts from $B$ can make a
struct covered by $t$ visible.

_Proof._ Let $s$ be a struct covered by $t$, so $(c_s,k_s)\in I$ and
$k_s < F_e(c_s)$. By Definition 6, every retained replica has decided $(c_s,k_s)$
at epoch $e$, and by A2 the decision is either "integrated" or "explicitly
skipped". Consider any future update $u$ that contains $s$.

- If $u$ comes from a retained replica, that replica already holds the decision
  for $(c_s,k_s)$, so applying $u$ changes nothing by A1 and A5.
- If $u$ comes from a returning or new replica, it must first receive $B$
  (condition 1 and the reconnection rule in §6.4). Because $B$ decides every
  clock below $F_e(c_s)$ and $k_s < F_e(c_s)$, the identity is already decided
  in $B$. Re-delivery is idempotent.
- Condition 3 catches an update that bypasses the snapshot path: the retained
  summary rejects any identity at or below the collected boundary, so $s$
  cannot be reintroduced even if it arrives out of band.

Visibility requires an undecided identity (Definition 4). All covered
identities are decided, so visibility cannot change. $\square$

Two operational consequences follow.

**Corollary 2 (Do not forget the boundary).** Physically deleting the tombstone
payload _and_ the identity summary is unsafe. The summary is the analogue of
Yjs's `GC` placeholder: it must survive even after the payload is gone.

**Corollary 3 (Base must lead the frontier).** Condition 1 is not automatic.
If the snapshot lags the frontier, a returning peer could receive a base that
does not decide a collected identity, and the proof fails. Compaction must run
after the frontier is computed, or must clamp the frontier to
$\min(F_e(c), V_B(c))$.

### 5.4 Why the current server retains tombstones

`party/server.ts` configures the persisting room with
`{ gc: false, persist: { mode: "snapshot" } }`. The snapshot therefore includes
deleted payloads and their delete-set entries. Journal compaction bounds the
number of **records**, not the number of tombstones. For a long-lived canvas
whose objects are frequently created and deleted, snapshot size can grow even
when the record count is flat.

There is a second constraint: Yjs does not expose a public API for removing a
delete-set entry from a document or re-encoding a document with a filtered
delete set. `Y.decodeUpdate` exposes the delete set for inspection, but there is
no supported `encode` counterpart that accepts a modified one. A production
implementation of §5.3 therefore needs one of:

1. an upstream Yjs capability or a maintained patch that rewrites the delete
   set,
2. a custom update transformer that is proven equivalent to the filtered
   history, or
3. a different persistence model that stores the frontier summary separately
   and rebuilds documents from it.

Until one of these exists, the safe operating mode is: keep `gc: false`, bound
journal records with compaction, monitor snapshot growth, and treat tombstone
reclamation as a future optimization with the proof obligations above.

### 5.5 The application-level collector

One layer down, the repository already implements the policy that
Definitions 6 and 7 formalize — for its own record store, not for Yjs structs.
[`src/lib/offline/tombstoneCompactor.ts`](../../src/lib/offline/tombstoneCompactor.ts)
scans `DEFAULT_COMPACTION_STORES` — `crdt_tombstones`, `crdt_operations`,
`pending_sync_queue`, `notes_cache`, and `pending_notes_queue` — and deletes
records that pass three gates:

| Gate           | Code                                                                                                            | Specification analogue                                        |
| -------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Age            | `getTombstoneTimestamp(record)` older than `DEFAULT_TOMBSTONE_MAX_AGE_MS` (30 days)                             | Wall-clock proxy for "the deletion has had time to propagate" |
| Merge status   | `isVectorClockMerged(record, stableVectorClock)`                                                                | Definition 7's frontier test                                  |
| Explicit flags | `isMerged === false`, `syncStatus` in `unmerged`/`pending`/`in_flight`/`conflict`, non-empty `unmergedBranches` | $D_{p,e} \not\subseteq D_B$; skip                             |

The second gate is the interesting one. It walks the record's `vectorClock`
and rejects the record when any node's tick exceeds the same node's tick in
`stableVectorClock`:

```ts
for (const [nodeId, tick] of Object.entries(record.vectorClock)) {
  const stableTick = stableVectorClock[nodeId] || 0;
  if (typeof tick === "number" && tick > stableTick) return false;
}
```

That is exactly $d \le F_e(c)$ for the record's deletion clock $d$, in the
largest-observed-clock convention of §1.3 — a record whose deletion was not yet
acknowledged by every retained peer is retained. The comment in the source names
the failure mode this prevents: _"Unmerged vector clock branches MUST NOT be pruned, or disconnected
peers will resurrect the deleted entity upon later sync"_ (#6488), which is
Example 1's resurrection scenario and the conclusion of Theorem 4.

Three boundaries are worth stating plainly, because they are where a reader
might over-credit the implementation:

1. **It deletes records, not structs.** The stores hold JSON records with an
   explicit `deleted`/`tombstone` marker and an attached vector clock. Deleting
   such a record removes a tombstone _and_ its payload together, which is safe
   only because no Yjs document reconstructs state from these stores.
2. **It is not on a live code path.** The module is re-exported from
   [`src/lib/offline/index.ts`](../../src/lib/offline/index.ts) and covered by
   [`src/__tests__/offline/tombstoneCompactor.test.ts`](../../src/__tests__/offline/tombstoneCompactor.test.ts),
   but no production call site invokes `compactTombstones`; the sweep has to be
   scheduled by a caller that computes `stableVectorClock`. Treat it as an
   available building block, not as a running service.
3. **It assumes a benign stable clock.** `isVectorClockMerged` trusts the
   `stableVectorClock` it is handed. If a caller passes a frontier from a
   single replica rather than the minimum over $R_e$, gate 2 silently weakens
   to a local check and Corollary 3's failure mode returns. The frontier must
   be computed as a minimum (§6.3, E4), never taken from the local replica.

## 6. Peer eviction

### 6.1 Two different epochs

The codebase already uses the word "epoch" for transport restart detection:
`party/server.ts` sets `serverEpoch = Date.now()` at startup and answers a
mismatched client epoch with `sendFullSyncFallback(conn, "epoch_mismatch")`.
That is a **transport epoch**. This section defines a second, independent
notion.

**Definition 8 (Retention epoch).** A retention epoch is a logical, monotonically
increasing counter $e \in \mathbb{N}$ covering a fixed wall-clock duration
$\Delta$. At the end of each epoch, every retained peer acknowledges a state
vector $V_{p,e}$ and a liveness status.

Keeping the two epochs distinct matters: a server restart must not be
interpreted as a retention epoch, and a retention tick must not force a
transport resync.

### 6.2 Peer records and stalls

**Definition 9 (Peer record).** For a peer $p$,

$$
\pi_p = \langle c_p,\ \text{session}_p,\ \text{lastSeen}_p,\ V_{p,e},\ \text{acked}_p \rangle,
$$

where $c_p$ is the Yjs client id of that document instance, $\text{lastSeen}_p$
is the last heartbeat, $V_{p,e}$ is the acknowledged vector, and
$\text{acked}_p$ records whether every journal block attributed to $p$ has been
folded into the base.

A user with several tabs has several client ids and therefore several peer
records. Eviction is per document instance, not per human.

**Definition 10 (Liveness).** Peer $p$ is live at epoch $e$ when it has an open
transport connection and its last heartbeat is within the awareness timeout
(15 s in `AwarenessProtocol`). Otherwise it is disconnected.

**Definition 11 (Stall count).** The stall count is the number of consecutive
completed epochs in which the peer was disconnected and its vector did not
advance:

$$
\sigma_p(e) =
\max\{\, j \le e \;\mid\; \forall i \in [e-j, e]:\;
\neg\mathrm{live}(p,i) \ \land\ V_{p,i} = V_{p,i-1} \,\}.
$$

The threshold $\tau$ is configurable. A peer is **stalled** when
$\sigma_p(e) \ge \tau$.

Existing eviction code in the repository operates one layer below this
definition and does not need it. `SpeedtestRoom.evictUnresponsivePeers`
(`src/party/speedtest.room.ts`) closes connections whose heartbeat is older than
`PEER_TIMEOUT_MS`, and `SpatialVoiceRoom` evicts a user's previous connection
when a second one registers (split-brain). Both are **connection-level**: they
reclaim a socket or a presence slot, and neither reads a document state vector.
Evicting a socket is always safe, because the peer's writes are durable in the
journal before eviction matters. Evicting a **retained replica** — which is what
advances the frontier and enables tombstone collection — is the new operation,
and that is what §6.3 constrains. `AwarenessProtocol`'s 15 s stale-presence
sweep is a third, different thing again: presence is ephemeral and not part of
the document.

### 6.3 Eviction predicate

Eviction is not merely "stalled for $\tau$ epochs". The issue's wording
("disconnected or stale clients whose state vector has stalled past a
configurable epoch threshold") describes the trigger; the following safety
conditions describe when the trigger may be acted on.

**Definition 12 (Safe eviction).** Peer $p$ may be evicted at epoch $e$ only
when all of the following hold:

$$
\begin{aligned}
\text{E0 (stalled):}   && \sigma_p(e) &\ge \tau,\\
\text{E1 (base covers):} && V_B &\sqsupseteq V_{p,e},\\
\text{E2 (deletes covered):} && D_{p,e} &\subseteq D_B,\\
\text{E3 (acked):} && \mathrm{acked}_p &= \text{true},\\
\text{E4 (authority):} && \text{the decision is recorded by the room authority.}
\end{aligned}
$$

E1 and E2 are the safety core. E3 prevents evicting a peer while its own
writes still sit in an unmerged journal. E4 makes the retained set a
single authoritative decision rather than a per-replica guess; two replicas
with different $R_e$ would compute different frontiers and could collect
different tombstones.

Note the asymmetry: a peer's _self-reported_ vector is used for E0 and as an
input to E1, but E1 is checked against the authoritative base, not trusted
blindly. A peer that lies high cannot cause data loss because the base check
fails; a peer that lies low merely delays its own eviction and holds the
frontier down, which is a liveness problem, not a safety problem.

### 6.4 Reconnection after eviction

**Rule (Full-state fallback).** If a returning peer's vector does not dominate
the current frontier, or if its transport epoch differs, the server must send
the base snapshot rather than a delta.

Formally, if $V_p \not\sqsupseteq F_e$, then the missing-update function

$$
\Delta(B, V_p) = \{\, s \in S_B \mid k_s \ge V_p(c_s) \,\}
$$

is not well defined as a delta, because some structs below $V_p$ may already
have been collected and cannot be named. Sending $B$ is always correct: by
Theorem 1, applying a full-state base to any replica yields the same join as
the history it replaces.

This is exactly the shape of the existing restart rule: a transport-epoch
mismatch triggers `sendFullSyncFallback`, and the retention epoch should be
added to the same check with reason `retention_epoch_mismatch`.

### 6.5 Eviction safety theorem

**Theorem 5 (Eviction safety).** If $p$ is evicted at epoch $e$ under
Definition 12, then:

1. removing $p$ from $R_e$ does not change the fold of retained state;
2. the frontier after eviction is at least the frontier before;
3. every tombstone that was collectible before eviction remains collectible,
   and no new tombstone becomes collectible over history $p$ had not seen.

_Proof._

1. E1 and E2 say the base already contains every struct and deletion that $p$
   acknowledged. $p$'s contribution to the join is therefore a subset of $B$'s,
   and removing it changes nothing (Proposition 1 applied to each covered
   chunk).
2. Lemma 4 with $R_{e+1} = R_e \setminus \{p\}$.
3. The first half is monotonicity. For the second half, any tombstone newly
   below $F_{e+1}$ belongs to a client $c$ where $p$ was the unique minimum.
   Because E1 gives $V_B(c) \ge V_{p,e}(c)$, the base already decides those
   identities, so Theorem 4 applies with $F_{e+1}$ and $B$. $\square$

**Theorem 6 (Bounded backlog, conditional).** Assume the deletion rate is at
most $\delta$ identities per epoch, every stalled peer is evicted within $\tau$
epochs of stalling, and at least one live peer advances the frontier every
epoch. Then the number of retained tombstone entries is
$O((\tau + \lambda)\delta)$, where $\lambda$ is the frontier lag of live peers.

_Proof sketch._ By Theorem 5 the frontier advances past the stalled peer's
vector at eviction. A tombstone older than $\tau + \lambda$ epochs is below the
frontier of every live peer and is collectible. Only the last
$\tau + \lambda$ epochs' worth of entries remain. If no live peer advances, the
frontier is stationary and no collection is possible; the bound is conditional
on activity, which is the correct liveness statement for a quiescent room.
$\square$

### 6.6 Why eviction without the base check is unsafe

Suppose $p$ authored structs at clocks $[100,110)$ and went offline before
uploading them. Its journal blocks are still in its browser, not in the base.
If an operator evicts $p$ because its vector stalled, and the frontier advances
past clock 100, then a later compaction may collect tombstones that cover those
identities. When $p$ returns and replays its blocks:

- the delta path cannot name what is missing,
- the base does not contain the structs,
- the retained summary rejects them as collected.

The user's last ten edits are gone with no error that points at the cause. E1
and E3 exist precisely to make this scenario impossible: either the blocks are
folded into the base first, or the peer is not evicted.

This is the peer-eviction analogue of the non-resurrection theorem, and it is
why the issue's threshold alone is not a sufficient specification.

## 7. Algorithms

### 7.1 In-memory compaction

This is the implemented path in `NomadCanvasProvider`. It produces a base from
the current document and verifies that the base reconstructs the document
before any storage is touched.

```text
function compactInMemory(doc):
    assert doc.store.pendingStructs == null          # §4.2 precondition

    U  <- Y.encodeStateAsUpdate(doc)                 # full-state encoding
    V  <- Y.encodeStateVector(doc)                   # section of the fold
    h  <- FNV1a(U)

    assert h == checksum(doc)                        # encoding is deterministic
    assert reconstructs(U, V, h, "pre-compaction")   # scratch apply + re-encode

    return (U, V, h)

function reconstructs(U, V, h, phase):
    scratch <- new Y.Doc()
    try:
        Y.applyUpdate(scratch, U)
        assert FNV1a(Y.encodeStateAsUpdate(scratch)) == h
        assert Y.encodeStateVector(scratch) == V
    finally:
        scratch.destroy()
```

**Eligibility test for a chunk**, used only when a chunk is pruned without
first being folded into the base:

```text
function squashable(B, u):
    if not dominates(V_B, Y.encodeStateVectorFromUpdate(u)):
        return false                                  # necessary, fails safe
    scratch <- new Y.Doc()
    try:
        Y.applyUpdate(scratch, B.bytes)
        Y.applyUpdate(scratch, u)
        return FNV1a(Y.encodeStateAsUpdate(scratch)) == B.checksum
    finally:
        scratch.destroy()
```

The second half is the sufficient condition from §3.4. The first half is a
cheap rejection that avoids the scratch document for the common case.

### 7.2 IndexedDB compaction

The journal lives in the database `worksphere-crdt-canvas-journal` (version 2)
with three stores:

| Store       | Key                    | Value               | Purpose                             |
| ----------- | ---------------------- | ------------------- | ----------------------------------- |
| `journal`   | `seq` (auto-increment) | `JournalBlock`      | Append-only offline blocks          |
| `meta`      | `roomName`             | `CanvasJournalMeta` | Last sequence, snapshot bookkeeping |
| `snapshots` | `roomName`             | `CanvasSnapshot`    | One baseline per room               |

The `journal` store has a `by-room` index. Compaction proceeds as follows.

```text
function compactJournal(room, doc):
    stats <- journal.getStats(room)
    if stats.recordCount == 0: return null

    # 1. Boundary is captured BEFORE encoding.
    throughSeq <- stats.latestSeq

    # 2. Fold the baseline and every surviving block into the live document.
    restoreFromJournal(doc)

    # 3. Encode and verify.
    (U, V, h) <- compactInMemory(doc)

    # 4. One readwrite transaction across all three stores.
    tx <- db.transaction(["snapshots", "journal", "meta"], "readwrite")
    tx.snapshots.put({ room, update: U, stateVector: V, checksum: h,
                       opsAtSnapshot: stats.recordCount, createdAt: now })
    for block in tx.journal.index("by-room").getAll(room):
        if block.seq <= throughSeq:
            tx.journal.delete(block.seq)
    tx.meta.put({ room, lastSeq: max(meta.lastSeq, throughSeq),
                  opsAtSnapshot: stats.recordCount, compactedAt: now })
    await tx.done

    # 5. Re-read and verify the persisted snapshot.
    persisted <- journal.loadSnapshot(room)
    assert FNV1a(persisted.update) == persisted.checksum == h
    reconstructs(persisted.update, persisted.stateVector, persisted.checksum,
                 "post-compaction")

    # 6. The live document must not be behind the snapshot.
    assert not isStateVectorBehind(Y.encodeStateVector(doc), persisted.stateVector)

    return { snapshot: persisted, deletedRecords, reclaimedBytes }
```

The boundary rule is what makes step 2 and step 4 compatible. Records appended
after step 1 carry a strictly larger `seq`, so they are not selected by
`seq <= throughSeq`. The snapshot may incidentally include some of them if they
were applied to the live document before step 3. That is safe: the snapshot
then covers more history than it prunes, which is a monotone weakening of the
pruning rule, never a strengthening. It means fewer records are reclaimed on
that run, not that live records are deleted.

```text
function restoreFromJournal(doc):
    snapshot <- journal.loadSnapshot(room)
    if snapshot != null:
        assert FNV1a(snapshot.update) == snapshot.checksum
        reconstructs(snapshot.update, snapshot.stateVector, snapshot.checksum,
                     "restore")
        Y.applyUpdate(doc, snapshot.update, SNAPSHOT_RECOVERY_ORIGIN)

    for block in journal.listPending(room) sorted by seq:
        if FNV1a(block.update) != block.checksum:
            journal.remove(block.seq)          # corrupt: drop, do not guess
            continue
        Y.applyUpdate(doc, block.update, JOURNAL_REPLAY_ORIGIN)
```

### 7.3 Retention-epoch eviction loop

Reference design. It assumes a peer table with the fields of Definition 9 and
an authoritative base per room.

```text
function closeRetentionEpoch(room, e):
    base <- loadBase(room)
    for peer in peers(room):
        ack[peer][e] <- { vector: peer.lastAckVector,
                          live:   peer.connected && now - peer.lastSeen <= 15s }
        peer.stallCount <- advanceStall(peer, e, ack[peer][e])

    candidates <- [p for p in peers(room) if p.stallCount >= TAU]
    for p in candidates:
        if not dominates(base.vector, p.lastAckVector): continue   # E1
        if not subset(p.lastAckDeletes, base.deletes):   continue   # E2
        if not p.journalFolded:                          continue   # E3
        evict(p, e)                                                # E4, authority

    advanceBaseFrontier(room, e)      # min over the retained peers
    scheduleTombstoneCollection(room, e)

function advanceStall(peer, e, ack):
    if ack.live: return 0
    if ack.vector != peer.vectorAtEpoch[e-1]: return 0
    return peer.stallCount + 1
```

The loop is deliberately conservative. A peer that is merely disconnected is
not evicted while its vector still advances through another tab or a relay; a
peer whose blocks are not folded is never evicted regardless of how long it has
been silent.

### 7.4 Tombstone collection loop

Reference design; requires the update-rewriting capability discussed in §5.4.

```text
function collectTombstones(room, e):
    base   <- loadBase(room)
    F      <- min over retained peers of ackVector(peer, e)
    F      <- clamp(F, base.vector)          # Corollary 3
    batch  <- []

    for t in deleteSet(room):
        if not below(t.identities, F):  continue
        if not below(t.deletionClock, F): continue
        if not dependenciesBelow(t, F):   continue
        batch.append(t)

    rewritten <- rewriteDeleteSet(base, batch)   # retains a compact summary
    assert fold(rewritten) == fold(base)          # Theorem 1
    persist(rewritten, summary(batch), e)
```

Collection is idempotent: running it twice with the same frontier produces the
same summary, and the second run has no entries left to collect. It must run
after the base has been advanced (`advanceBaseFrontier`), never before, or
Corollary 3 is violated.

## 8. Durability analysis

### 8.1 Atomic swap

**Lemma 5 (Snapshot-plus-prune atomicity).** A crash during `compactJournal`
leaves the database in either the pre-compaction state or the post-compaction
state, never a mixture.

_Proof._ Steps 4 writes the snapshot, deletes superseded journal records, and
updates the meta record inside one IndexedDB `readwrite` transaction spanning
all three stores. IndexedDB transactions are atomic and serialized: if the
transaction aborts, none of its writes are visible; if it commits, all are. The
snapshot write and the record deletion are therefore never observed separately.
$\square$

This is the property the pre-#7741 code lacked: writing a snapshot first and
pruning later allows a crash between the two, which leaves a duplicated but
consistent state (recoverable) or, with the order reversed, a pruned state with
no baseline (data loss).

### 8.2 Boundary safety

**Lemma 6.** Every journal record deleted by a compaction run is covered by the
snapshot written by that run, and every record appended during the run
survives.

_Proof._ Let $s$ be the boundary captured in step 1. A deleted record has
`seq <= s`, and `restoreFromJournal` in step 2 applied every record with
`seq <= s` before step 3 encoded the document, so the snapshot covers it. A
record appended during the run has `seq > s` by the monotonicity of the
sequence counter (the counter and the insert share one transaction in
`CanvasChangeJournal.append`), so it is not deleted. $\square$

### 8.3 Recovery correctness

**Theorem 7 (Recovery).** After any crash, `restoreFromJournal` produces a
document that is join-equivalent to the pre-crash document.

_Proof._ The persisted state is either pre- or post-compaction (Lemma 5). In
the pre-compaction state, the baseline is the old snapshot and every record is
present; replay applies baseline then all records in seq order, which is the
fold of the full history. In the post-compaction state, the baseline covers all
records with `seq <= s` (Lemma 6) and the surviving records are exactly those
with `seq > s`; replay applies baseline then survivors, which is again the same
fold. By A5 the order of application does not matter and duplicates are
idempotent. $\square$

The checksum guards are not needed for this proof; they are there to fail
closed when storage is corrupted, which the algebraic argument cannot cover.

## 9. Parameters

Implemented values, verified against the source:

| Parameter                    |                                       Value | Source                         |
| ---------------------------- | ------------------------------------------: | ------------------------------ |
| Journal database             | `worksphere-crdt-canvas-journal`, version 2 | `canvasProvider.ts`            |
| Journal stores               |              `journal`, `meta`, `snapshots` | `canvasProvider.ts`            |
| Raw record threshold         |                                 500 records | `DEFAULT_MAX_JOURNAL_RECORDS`  |
| Raw byte threshold           |                     5,242,880 bytes (5 MiB) | `DEFAULT_MAX_COMPACTION_BYTES` |
| Operation trigger            |                            500 transactions | `maxOperations` default        |
| Periodic checkpoint          |                          300,000 ms (5 min) | `checkpointIntervalMs` default |
| Legacy replay buffer cap     |                   16,777,216 bytes (16 MiB) | `DEFAULT_MAX_BUFFER_BYTES`     |
| Awareness inactivity timeout |                                   15,000 ms | `AwarenessProtocol`            |
| Awareness heartbeat          |                                    5,000 ms | `AwarenessProtocol`            |
| Server persistence           |                  `gc: false`, snapshot mode | `party/server.ts`              |
| Transport epoch              |                `Date.now()` at server start | `party/server.ts`              |

Proposed values for the reference design. These are not implemented; they are
the parameters the proof obligations are stated against.

| Parameter                  | Symbol   |      Suggested default | Rationale                                                            |
| -------------------------- | -------- | ---------------------: | -------------------------------------------------------------------- |
| Retention epoch duration   | $\Delta$ |                 1 hour | Long enough to batch acknowledgements, short enough to bound backlog |
| Eviction threshold         | $\tau$   |       24 epochs (24 h) | A day of silence is a safe operational definition of "stale"         |
| Tombstone collection batch | —        |          1,000 entries | Bounds rewrite cost and memory                                       |
| Frontier clamp             | —        |                 always | Corollary 3                                                          |
| Full-sync trigger          | —        | vector behind frontier | §6.4                                                                 |

The thresholds are independent of the transport epoch and must not be derived
from `serverEpoch`, which changes on every server restart.

## 10. Failure modes and threats

| Failure                                | Effect without the rule                      | Control                                                               |
| -------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------- |
| Crash between snapshot write and prune | Pruned records with no baseline              | Single transaction (Lemma 5)                                          |
| Corrupt snapshot                       | Applying garbage or losing history           | Checksum + scratch round-trip; throw, do not repair                   |
| Corrupt journal block                  | Replay stalls or diverges                    | Drop the block and log it (`restoreFromJournal`)                      |
| Record appended during compaction      | Deleted without being in the snapshot        | Boundary captured before encoding (Lemma 6)                           |
| Pending structs present                | Snapshot omits them permanently              | Compact only when `pendingStructs` is empty (§12)                     |
| Chunk with a mid-stream gap            | Naive domination test passes, data is pruned | Proposition 1 scratch test, or fold-before-prune (§3.5)               |
| Delete-only chunk                      | Frontier test ignores deletion coverage      | $D_u \subseteq D_B$ in §3.4                                           |
| Eviction with unfolded blocks          | User edits are orphaned                      | E1 and E3 (§6.3)                                                      |
| Eviction with a lagging base           | Tombstone collected above the base           | Corollary 3                                                           |
| Peer reports a high vector             | Fabricated "caught up" state                 | E1 checks the authoritative base, not the claim                       |
| Peer reports a low vector              | Frontier pinned, collection stalls           | Treat as liveness issue; bound sessions and expire records            |
| Returning peer behind the frontier     | Delta cannot name collected ids              | Full-state fallback (§6.4)                                            |
| Two authorities evict differently      | Different frontiers, different collections   | Single authoritative retained set (E4)                                |
| Storage quota exceeded                 | Transaction aborts, offline edits lost       | Catch `QuotaExceededError`, surface to the user, retry after cleanup  |
| Yjs version upgrade                    | Checksums differ for equal state             | Version the checksum in the snapshot metadata; re-baseline on upgrade |

The last row deserves emphasis. A6 is version-scoped. A snapshot written by
Yjs 13.6.33 and a client running a later encoder can agree on every struct and
still produce different bytes. Compare state vectors for compatibility and
treat checksums as same-version integrity checks only.

## 11. Verification and tests

| Property                                                               | Test or command                                                |
| ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| Compaction writes a snapshot and prunes exactly the superseded records | `src/__tests__/lib/crdt/canvasProviderCompaction.test.ts`      |
| Snapshot checksum and state-vector round-trip                          | same file, `assertSnapshotReconstructs` paths                  |
| Snapshot recovery and convergence                                      | `src/__tests__/lib/crdt/snapshotManager.test.ts`               |
| Stale presence is pruned                                               | `src/__tests__/core/crdt/AwarenessProtocol.test.ts`            |
| Frontier-gated tombstone pruning keeps unmerged branches               | `src/__tests__/offline/tombstoneCompactor.test.ts`             |
| Divergent vectors are detected                                         | `src/__tests__/core/crdt/CrdtVectorClockDesync.test.ts`        |
| Partitioned mesh converges after heal                                  | `src/__tests__/core/crdt/CrdtAsymmetricMeshPartition.test.ts`  |
| Frontier monotonicity                                                  | Property test over random retained sets (§5.2)                 |
| Eviction safety preconditions                                          | New property test: generate peers, evict, assert fold equality |
| Gap-chunk counterexample                                               | The Node.js snippet in §3.3                                    |

The §3.3 snippet is reproduced as a regression test candidate: it fails if
someone replaces the scratch-document check with a bare state-vector
comparison. The expected observations are an empty map from
`Y.encodeStateVectorFromUpdate(delta)`, a non-null `pendingStructs` on the
fresh document, and a differing re-encoding.

## 12. Limitations

1. **Reference designs are not deployed.** §5.3 and §6 specify the conditions
   for Yjs-level tombstone collection and for retention-epoch peer eviction;
   the repository implements neither. What does exist is the app-level collector
   in §5.5, which prunes JSON tombstone records and is not wired to a caller.
   The implemented guarantees are the ones in §3.5, §5.5 gates, §7.1, §7.2, and
   §8.
2. **Pending structs.** Compaction must not run while
   `doc.store.pendingStructs` is non-empty. The field is internal to Yjs, which
   means the guard is version-coupled; the safer deployment rule is to compact
   only after a successful sync handshake reports no missing dependencies.
3. **No delete-set rewriting API.** §7.4 cannot be implemented against public
   Yjs APIs. Treat the loop as a specification for a future capability, not as
   runnable pseudocode.
4. **Checksums are not cryptographic.** FNV-1a detects accidental divergence.
   It does not resist an adversary who chooses the payload. A verifier that
   needs adversarial integrity must use a keyed hash or a signature.
5. **Single-writer assumption per room.** The IndexedDB database is per origin
   and per browser profile. Multi-tab writes are serialized by IndexedDB
   transactions, but there is no cross-tab leader election in this layer. The
   sequence counter is safe because the read-modify-write shares one
   transaction; higher-level coordination is out of scope.
6. **Wall-clock epochs are approximate.** Retention epochs are logical counters.
   If the tab is suspended, the counter pauses with it. The liveness bound in
   Theorem 6 assumes epochs advance; a suspended tab does not collect
   tombstones, which is safe.
7. **Mobile and storage pressure.** The analysis assumes transactions commit.
   Browsers evict IndexedDB under storage pressure; `QuotaExceededError` is not
   currently handled with a user-visible recovery path.
8. **No Byzantine peers.** Self-reported vectors and acknowledgements are
   trusted for liveness, not for safety. Safety rests on the authoritative
   base. A compromised server defeats every guarantee here.

## 13. Related documents

- [`CRDT_VECTOR_COMPACTION.md`](./CRDT_VECTOR_COMPACTION.md): the operational
  protocol, checkpoint lifecycle, heuristics, and the invariant checklist this
  specification formalizes.
- [`CRDT_VECTOR_MATHEMATICAL_SPEC.md`](./CRDT_VECTOR_MATHEMATICAL_SPEC.md):
  state-vector algebra, the missing-update function, and the tombstone GC
  sketch.
- [`state-based-resolution.md`](./state-based-resolution.md): the separate
  vector-clock state-based engine and the generic semilattice proofs.
- [`whiteboard-architecture.md`](./whiteboard-architecture.md): canvas schema,
  connection lifecycle, and the `gc: false` persistence configuration.
- [`../YJS_CRDT_COMPRESSION.md`](../YJS_CRDT_COMPRESSION.md): binary framing
  for compressed updates.
- [`../CRDT_REALTIME_SYNC_PROTOCOL.md`](../CRDT_REALTIME_SYNC_PROTOCOL.md):
  wire format and transport summary.
- [`../WEBRTC_MESH_CRDT_SYNC_SPECIFICATION.md`](../WEBRTC_MESH_CRDT_SYNC_SPECIFICATION.md):
  mesh transport and partitioning behavior.

## References

- M. Shapiro, N. Preguiça, C. Baquero, M. Zawirski. "Conflict-free Replicated
  Data Types." INRIA Research Report RR-7506, 2011.
- P. Nicolaescu, K. Jahns, A. Derntl, R. Klamma. "Near Real-Time Peer-to-Peer
  Shared Editing on Extensible Data Types." GROUP 2016. (Yjs.)
- Yjs internals: `StructStore.getState`, `encodeStateVector`,
  `encodeStateVectorFromUpdate`, `encodeStateAsUpdate`, delete sets, and
  `Skip`/`GC` structs. <https://github.com/yjs/yjs>
- IndexedDB transaction atomicity and durability:
  <https://www.w3.org/TR/IndexedDB/#transactions>
- [YJS_CRDT_COMPRESSION.md](../YJS_CRDT_COMPRESSION.md) for the compressed wire
  format used by the transport.
