# Yjs State Vector Exchange: Mathematical Specification and Invariants

This specification defines the state-vector protocol used to exchange Yjs
updates between replicas. It is intentionally independent of transport
(WebSocket, PartyKit, WebRTC, or an offline journal). The protocol assumes
reliable eventual delivery: messages may be delayed, duplicated, reordered, or
temporarily unavailable, but every update is eventually delivered to every
replica that remains in the membership set.

## 1. Model and notation

Let:

- $\mathcal{C}$ be the set of Yjs client IDs.
- $\mathbb{N}$ be the non-negative integers.
- A **struct** be an immutable Yjs item with identity
  $(c,k)$, where $c \in \mathcal{C}$ is its client ID and $k$ is its starting
  clock.
- $len(s)$ be the number of consecutive clocks occupied by struct $s$.
- $S_R$ be the set of structs integrated by replica $R$.
- $D_R$ be the logical Yjs document obtained by integrating $S_R$.

Yjs client clocks are contiguous for the history known to a replica. A struct
may occupy a clock interval:

$$
I(s) = [s.c, s.clock,\ s.clock + len(s) - 1].
$$

The client ID and clock are identity, not wall-clock time. They must never be
renumbered during serialization, compaction, or transport.

## 2. State vector

The state vector of replica $R$ is a finite partial function:

$$
V_R : \mathcal{C} \rightharpoonup \mathbb{N}.
$$

For a client $c$, $V_R[c]$ is the greatest contiguous clock known by $R$.
Missing entries are defined as zero:

$$
V_R[c] = 0 \quad \text{when } c \notin dom(V_R).
$$

Equivalently, if clocks are zero-based, $V_R[c]=n$ means that the replica has
integrated every clock in $\{0,\ldots,n-1\}$ from client $c$. The exact
zero-based/one-based encoding convention is an implementation detail; all
comparisons use the same convention.

The vector is a causal frontier, not a count of total rows and not a timestamp.
For example:

$$
V_A = \{x \mapsto 7,\ y \mapsto 2\}
$$

means that $A$ knows client $x$ through clock 7 and client $y$ through clock 2.

### 2.1 Vector join

The least upper bound (join) of two vectors is component-wise maximum:

$$
(V_1 \sqcup V_2)[c] =
\max(V_1[c], V_2[c]).
$$

The join is associative, commutative, and idempotent:

$$
V \sqcup V = V,\qquad
V_1 \sqcup V_2 = V_2 \sqcup V_1,\qquad
(V_1 \sqcup V_2)\sqcup V_3 = V_1\sqcup(V_2\sqcup V_3).
$$

## 3. Partial order

For vectors $V_1$ and $V_2$, define:

$$
V_1 \le V_2
\iff
\forall c \in dom(V_1)\cup dom(V_2),\ V_1[c]\le V_2[c].
$$

The strict order is:

$$
V_1 < V_2
\iff
V_1\le V_2
\land
\exists c,\ V_1[c]<V_2[c].
$$

If neither $V_1\le V_2$ nor $V_2\le V_1$, the vectors are concurrent:

$$
V_1 \parallel V_2.
$$

The order is a partial order because it is reflexive, antisymmetric, and
transitive:

1. **Reflexive:** every component satisfies $V[c]\le V[c]$.
2. **Antisymmetric:** if $V_1[c]\le V_2[c]$ and $V_2[c]\le V_1[c]$ for every
   $c$, then all components are equal, so $V_1=V_2$.
3. **Transitive:** $V_1[c]\le V_2[c]\le V_3[c]$ implies
   $V_1[c]\le V_3[c]$ for every $c$.

The state vector of a replica monotonically increases under update
application:

$$
V_R^{before} \le V_R^{after}.
$$

## 4. Differential update

Let $U_A$ be an update containing structs known by replica $A$, and let $V_B$
be the state vector advertised by replica $B$. The differential update from
$A$ to $B$ is:

$$
\Delta(V_A,V_B)
=
\{s\in S_A \mid
s.clock + len(s) > V_B[s.clientId]\}.
$$

For a single-clock struct this reduces to:

$$
\Delta(V_A,V_B)
=
\{s\in S_A \mid s.clock \ge V_B[s.clientId]\}.
$$

In Yjs, the operational form is:

```ts
const remoteVector = Y.decodeStateVector(encodedRemoteVector);
const delta = Y.encodeStateAsUpdate(localDoc, remoteVector);
```

`encodeStateAsUpdate` also accounts for Yjs struct dependencies and therefore
is the authoritative implementation of the mathematical set difference.
Implementations must not construct binary Yjs updates by slicing bytes or by
manually editing clocks.

### 4.1 Differential properties

For a correct state vector:

1. **Soundness:** every struct in $\Delta(V_A,V_B)$ is in $S_A$.
2. **Necessity:** every struct in $S_A$ that is not covered by $V_B$ is in the
   delta, subject to required Yjs dependencies.
3. **Empty delta:** if $V_A\le V_B$ and $B$ already contains all dependencies,
   $\Delta(V_A,V_B)=\varnothing$.
4. **Idempotence:** applying the same delta twice has the same result as
   applying it once.

## 5. State-vector handshake

The handshake is bidirectional. Each side advertises what it has and sends the
other side the missing differential update.

### 5.1 Pseudocode

```text
function handshake(localDoc, transport):
    localVector = encodeStateVector(localDoc)
    transport.send(SYNC_STEP_1, localVector)

on SYNC_STEP_1(remoteVectorBytes):
    remoteVector = decodeStateVector(remoteVectorBytes)
    delta = encodeStateAsUpdate(localDoc, remoteVector)
    transport.send(SYNC_STEP_2, delta)

on SYNC_STEP_2(delta):
    applyUpdate(localDoc, delta, origin = "remote-sync")

on reconnect:
    handshake(localDoc, transport)
```

Both peers execute this protocol. Thus, if $A$ has edits unknown to $B$ and
$B$ has edits unknown to $A$, both directions carry a delta.

### 5.2 Handshake invariants

- **Monotonic knowledge:** applying a valid update never decreases the local
  state vector.
- **No false knowledge:** a vector entry is advanced only after the referenced
  structs and their dependencies are integrated.
- **Duplicate safety:** a repeated `SYNC_STEP_2` is harmless.
- **Direction independence:** the result does not depend on which peer sends
  its step first.

## 6. Convergence proof

### Theorem

If replicas $A$ and $B$ start with arbitrary states and eventually receive the
same set of valid Yjs updates, then after delivery:

$$
D_A = D_B.
$$

This is strong eventual consistency (SEC).

### Proof

Let $U$ be the union of all valid structs eventually delivered to both
replicas. Yjs integration is a join operation over immutable struct identities:

$$
D_R^{after}=D_R^{before}\sqcup U_{delta}.
$$

The join has three relevant properties:

1. **Commutativity:** message order does not affect the result.
2. **Associativity:** batching versus streaming does not affect the result.
3. **Idempotence:** duplicate delivery does not change the result.

Therefore, after all messages are delivered:

$$
D_A = D_A^{initial}\sqcup U
\quad\text{and}\quad
D_B = D_B^{initial}\sqcup U.
$$

The handshake deltas include every struct absent from the recipient's
advertised vector. Consequently both replicas contain the same struct set
$U$; any overlap is removed by idempotence. Yjs resolves references and
concurrent structure deterministically from the same immutable identities.
Therefore both integrations produce the same logical document:

$$
\boxed{D_A=D_B}.
$$

The proof does not require FIFO delivery, exactly-once delivery, synchronized
wall clocks, or a single network path. It does require that a replica does not
advertise clocks it has not integrated and that eventual delivery is provided.

## 7. Differential extraction pseudocode

The following pseudocode describes a transport-neutral extraction layer. The
actual Yjs implementation should call `Y.encodeStateAsUpdate`.

```text
function extractDifferentialUpdate(localDoc, remoteVectorBytes):
    remoteVector = Y.decodeStateVector(remoteVectorBytes)

    # Yjs includes structs and dependencies absent from remoteVector.
    delta = Y.encodeStateAsUpdate(localDoc, remoteVector)

    return {
        kind: "SYNC_STEP_2",
        baseVector: remoteVectorBytes,
        update: delta
    }

function receiveDifferentialUpdate(localDoc, message):
    Y.applyUpdate(localDoc, message.update, origin = "remote-sync")
    assert(encodeStateVector(localDoc) >= message.baseVector)
```

The assertion is conceptual: production code should compare decoded vectors
component-wise and should not reject a valid update merely because the sender
advanced concurrently after taking its snapshot.

## 8. Tombstones and safe garbage collection

A deletion is represented by a tombstone (a deletion struct or deletion marker)
that preserves the causal fact that an object was removed. Removing the
tombstone before all relevant replicas know about the deletion permits a
delayed pre-deletion update to recreate the object.

Let $\mathcal{R}$ be the set of replicas that may still reconnect. Each
replica $r$ periodically acknowledges a state vector $V_r$. Define the
membership stability vector:

$$
V_{stable}[c] = \min_{r\in\mathcal{R}} V_r[c].
$$

The minimum is taken over all active and retained offline replicas. A tombstone
$t$ created at $(c,k)$ is eligible for collection only if:

$$
k < V_{stable}[c],
$$

and the deletion's dependencies are also below the stability frontier.

This condition means every replica in $\mathcal{R}$ has integrated the
tombstone. If a replica is offline beyond the retention policy, it must be
removed from $\mathcal{R}$ only through an explicit membership/restore policy;
silently ignoring it breaks the proof.

### 8.1 Tombstone GC pseudocode

```text
function acknowledgeReplica(replicaId, vector):
    acknowledgements[replicaId] = vector

function computeStableVector(membership):
    stable = emptyVector()
    for clientId in allClientIds(acknowledgements, membership):
        stable[clientId] = +infinity
        for replicaId in membership:
            stable[clientId] = min(
                stable[clientId],
                acknowledgements[replicaId][clientId] ?? 0
            )
    return stable

function collectTombstones(doc, membership, now):
    stable = computeStableVector(membership)

    for tombstone in doc.tombstones:
        deletionClock = tombstone.clientId
        deletionTime = tombstone.clock

        if deletionTime >= stable[deletionClock]:
            continue                         # a replica may not know it
        if not dependenciesCovered(tombstone, stable):
            continue                         # preserve causal prerequisites
        if not retentionPolicyAllows(tombstone, now):
            continue                         # optional operational grace period

        removeTombstonePayload(tombstone)
        retainStableDeletionSummary(tombstone.clientId, tombstone.clock)

    return doc
```

`retainStableDeletionSummary` may be a compact per-client clock frontier. It
must preserve enough information to reject any late operation at or before the
collected deletion clock. A GC implementation must not physically delete a
tombstone and forget its causal boundary.

## 9. Invariant checklist

1. **Identity:** every struct is identified by immutable `(clientId, clock)`.
2. **Contiguity:** each state-vector entry represents a contiguous prefix.
3. **Monotonicity:** vector entries only increase.
4. **Delta correctness:** a differential update is computed against the
   receiver's advertised vector.
5. **Join safety:** updates are applied through Yjs, not field-level merge
   heuristics.
6. **SEC:** equal delivered update sets imply equal logical documents.
7. **Tombstone safety:** a tombstone is collected only beyond the minimum
   acknowledged frontier of every replica that may reconnect.
8. **Compaction safety:** compaction may change encoding size, but never changes
   struct identities or causal clocks.

These invariants are sufficient to reason about reconnects, offline journals,
duplicate messages, out-of-order delivery, and safe tombstone reclamation.
