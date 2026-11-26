# Sequence CRDT Mathematics: Logoot, LATA, and Distributed String Editing

> **Technical Architecture Specification & Mathematical Foundations**  
> **Status:** Reference Document / Algorithmic Foundations  
> **Scope:** Fractional Positioning, Distributed Sequence Editing, Logoot, LATA, Deterministic Tie-Breaking, Interleaving Anomalies, and Tombstone Compaction  
> **Related Architecture:** [`../architecture/CAUSAL_ORDERING_AND_TIEBREAKING.md`](../architecture/CAUSAL_ORDERING_AND_TIEBREAKING.md), [`./CRDT_VECTOR_MATHEMATICAL_SPEC.md`](./CRDT_VECTOR_MATHEMATICAL_SPEC.md), [`./YJS_SYNC_PROTOCOL.md`](./YJS_SYNC_PROTOCOL.md), and [`./CRDT_MULTI_PEER_VECTOR_GC.md`](./CRDT_MULTI_PEER_VECTOR_GC.md)

---

## 1. Introduction and Terminology

Collaborative text editing in distributed systems enables multiple users located across different networks to edit shared documents (such as WorkSphere's collaborative whiteboard text nodes, scratchpads, and notes) simultaneously without coordinating through a centralized distributed lock manager.

### Why Simple Integer Indices Fail in Distributed Sequences

In a single-threaded text buffer, a character sequence is indexed as a linear array:

$$S = [c_0, c_1, c_2, \dots, c_{n-1}]$$

where each element $c_i$ occupies integer index $i \in \{0, \dots, n-1\}$.

When two replicas $R_1$ and $R_2$ edit the string concurrently without synchronization:
1. Suppose the initial buffer is `"CAT"` ($c_0 = \text{'C'}, c_1 = \text{'A'}, c_2 = \text{'T'}$).
2. Replica $R_1$ inserts `'H'` at index 0 to produce `"HCAT"`.
3. Concurrently, replica $R_2$ deletes character at index 1 (`'A'`) to produce `"CT"`.
4. If $R_2$ receives the operation $\text{insert}('H', 0)$ from $R_1$, applying it at local index 0 shifts all existing characters right, producing `"HCT"`.
5. However, when $R_1$ receives $\text{delete}(1)$ from $R_2$, index 1 on $R_1$'s buffer now points to `'C'` (since `'H'` was inserted at index 0), deleting the wrong character and yielding `"HAT"`.

The replicas diverge ($R_1 = \text{"HAT"} \ne R_2 = \text{"HCT"}$) because **plain integer indices are mutable, relative offsets** that shift dynamically whenever earlier elements are inserted or deleted.

### Core Terminology

- **Sequence CRDT (Conflict-Free Replicated Data Type):** A distributed data structure representing an ordered sequence of elements that guarantees strong eventual consistency (SEC): any two replicas that have received the same set of update operations will observe an identical sequence state, independent of operation arrival order.
- **Position Identifier:** An immutable, globally unique identifier assigned to an element upon insertion that defines its relative position within a total order $\mathcal{T}$. Once assigned, an identifier never shifts or changes value.
- **Replica (Node):** An independent participant in the distributed network holding a local replica of the document, generating local mutations, and receiving remote mutations.
- **Operation:** A discrete, self-contained mutation record representing an insertion $\text{ins}(id, char)$ or deletion $\text{del}(id)$.
- **Logical Ordering:** The dense total ordering relation $\prec$ defined over position identifiers such that for any two distinct identifiers $id_A \ne id_B$, either $id_A \prec id_B$ or $id_B \prec id_A$.
- **Tombstone:** A marker indicating that an element has been logically deleted while retaining its position identifier and metadata in memory or storage to preserve ordering references for concurrent operations.
- **Convergence vs. Intention Preservation:**
  - **Convergence:** All replicas that process the same operations reach the exact same mathematical state.
  - **Intention Preservation:** The resulting sequence faithfully reflects what users intended (e.g., preserving word integrity and avoiding character interleaving such as merging `"ABC"` and `"XYZ"` into `"AXBYCZ"`).

---

## 2. Fractional Position Identifiers

To avoid index shifting, sequence CRDTs assign every item an immutable identifier from a dense mathematical space where between any two distinct identifiers $P$ and $Q$ ($P \prec Q$), an infinite number of intermediate identifiers can be allocated:

$$\forall P, Q \in \mathcal{I} \quad (P \prec Q \implies \exists M \in \mathcal{I}: P \prec M \prec Q)$$

### Lexicographic Ordering and Vector Representation

Rather than using continuous floating-point numbers (which quickly suffer from IEEE 754 precision exhaustion after ~53 subdivisions), fractional identifiers are represented as variable-length tuples or arrays of numeric components:

$$P = [d_1, d_2, \dots, d_k]$$

Comparison between two position identifiers $P = [p_1, \dots, p_m]$ and $Q = [q_1, \dots, q_n]$ is defined lexicographically:

$$P \prec Q \iff \exists i \ge 1 \text{ such that } (\forall j < i, \; p_j = q_j) \land (p_i < q_i \lor (i = m + 1 \land m < n))$$

### Arbitrary-Precision Arrays and BigInt Representations

Fixed-width numeric allocations (such as 32-bit or 64-bit integers) eventually exhaust available subdivisions between adjacent integers. When repeated insertions occur at the exact same boundary (e.g., typing text at the start of a document or appending at the end), identifiers must extend in depth:

$$[1] \prec [1, 5] \prec [1, 5, 8] \prec [2]$$

Using arbitrary-precision integer representations (such as TypeScript `bigint` arrays or variable-length byte buffers) prevents numeric overflow while allowing unbounded depth extensions.

### Concrete TypeScript Implementation: Fractional Position Allocator

Below is a mathematically correct TypeScript implementation illustrating how fractional position identifiers can be computed between two boundary identifiers.

```typescript
/**
 * FractionalPositionAllocator.ts
 *
 * Demonstrates fractional position allocation between two lexicographically ordered identifiers.
 * Each position identifier is represented as an array of non-negative BigInt components.
 */

export type PositionIdentifier = bigint[];

/**
 * Lexicographical comparison between two position identifiers.
 * Returns:
 *   -1 if a < b
 *    0 if a == b
 *   +1 if a > b
 */
export function comparePositions(a: PositionIdentifier, b: PositionIdentifier): number {
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  if (a.length < b.length) return -1;
  if (a.length > b.length) return 1;
  return 0;
}

/**
 * Computes a new position identifier strictly between beforeId and afterId.
 * Assumes comparePositions(beforeId, afterId) < 0.
 *
 * @param beforeId Lower bound (or empty array for start of document)
 * @param afterId Upper bound (or empty array for end of document)
 * @param base Radix used for fractional division (e.g., 2^16 or 2^32)
 */
export function allocatePositionBetween(
  beforeId: PositionIdentifier,
  afterId: PositionIdentifier,
  base: bigint = 65536n // 16-bit integer radix
): PositionIdentifier {
  if (beforeId.length > 0 && afterId.length > 0) {
    const cmp = comparePositions(beforeId, afterId);
    if (cmp >= 0) {
      throw new Error("Invalid bounds: beforeId must be strictly less than afterId");
    }
  }

  const result: bigint[] = [];
  let depth = 0;

  while (true) {
    const bDigit = depth < beforeId.length ? beforeId[depth] : 0n;
    const aDigit = depth < afterId.length ? afterId[depth] : base;

    const diff = aDigit - bDigit;

    if (diff > 1n) {
      // Sufficient gap exists at current depth: choose midpoint
      const mid = bDigit + diff / 2n;
      result.push(mid);
      return result;
    } else if (diff === 1n) {
      // Gap is exactly 1: copy lower boundary digit and subdivide at next depth
      result.push(bDigit);
      // Boundary for next depth: afterId effectively becomes maximum boundary
      const remainingBefore = beforeId.slice(depth + 1);
      const subAllocated = allocateSubPosition(remainingBefore, base);
      return result.concat(subAllocated);
    } else {
      // Digits are equal: advance to next depth level
      result.push(bDigit);
      depth++;
    }
  }
}

function allocateSubPosition(beforeSuffix: PositionIdentifier, base: bigint): PositionIdentifier {
  if (beforeSuffix.length === 0) {
    // Suffix is empty: allocate midpoint between 0 and base
    return [base / 2n];
  }
  const digit = beforeSuffix[0];
  const step = (base - digit) / 2n;
  if (step > 0n) {
    return [digit + step];
  }
  // No room at current level: append 0 and recurse
  return [digit].concat(allocateSubPosition(beforeSuffix.slice(1), base));
}
```

---

## 3. Logoot Positioning Algorithm

### Theoretical Background

**Logoot** was introduced in 2009 by Stéphane Weiss, Pascal Urso, and Pascal Molli (INRIA / Université Henri Poincaré) as an operation-based sequence CRDT designed for collaborative text editing.

### Identifier Structure

In Logoot, an element identifier is an ordered list of identifier components, bounded by two virtual sentinel identifiers:
- Start sentinel: $\mathcal{I}_{\text{start}} = [\langle 0, 0, 0 \rangle]$
- End sentinel: $\mathcal{I}_{\text{end}} = [\langle \text{max\_int}, 0, 0 \rangle]$

Each component in the list is a 3-tuple:

$$c = \langle \text{pos}, \text{replicaId}, \text{clock} \rangle$$

where:
1. $\text{pos} \in \{0, \dots, \text{base} - 1\}$ is a non-negative integer representing the digit in a chosen numerical radix (e.g., base $2^{16}$ or $2^{32}$).
2. $\text{replicaId}$ is the unique identifier of the originating replica (UUID, public key, or integer node ID).
3. $\text{clock}$ is the monotonically increasing logical clock (session counter) of that replica.

A full Logoot identifier is therefore:

$$L = [c_1, c_2, \dots, c_k] = [\langle p_1, r_1, s_1 \rangle, \langle p_2, r_2, s_2 \rangle, \dots, \langle p_k, r_k, s_k \rangle]$$

### Ordering Rule

Given two Logoot identifiers $L_A = [a_1, \dots, a_m]$ and $L_B = [b_1, \dots, b_n]$, the total ordering relation $<_L$ is evaluated lexicographically by comparing tuples at each level $i$:

$$\langle p_a, r_a, s_a \rangle < \langle p_b, r_b, s_b \rangle \iff (p_a < p_b) \lor (p_a = p_b \land r_a < r_b) \lor (p_a = p_b \land r_a = r_b \land s_a < s_b)$$

If one identifier is a prefix of another, the shorter list precedes the longer list.

### Worked Example: Concurrent Insertion at the Same Position

Consider two replicas $R_1$ and $R_2$ inserting characters between sentinel 0 and sentinel 100:
- Initial state: Boundary $P_0 = [\langle 0, 0, 0 \rangle]$, Boundary $P_{\text{end}} = [\langle 100, 0, 0 \rangle]$.
- **Replica $R_1$ (Replica ID 1, Clock 1):** Inserts `'A'` between $P_0$ and $P_{\text{end}}$. It picks midpoint 50:
  $$P_A = [\langle 50, 1, 1 \rangle]$$
- **Replica $R_2$ (Replica ID 2, Clock 1):** Concurrently inserts `'B'` between $P_0$ and $P_{\text{end}}$. It independently picks midpoint 50:
  $$P_B = [\langle 50, 2, 1 \rangle]$$

When both replicas exchange operations:
- Both compare $P_A$ and $P_B$:
  - Level 1 position digit: $50 = 50$ (tie).
  - Level 1 replica ID: $1 < 2$.
  - Therefore, $P_A <_L P_B$.
- Both replicas sort their sequence as:
  $$[P_A, P_B] \implies \text{"AB"}$$

Deterministic convergence is guaranteed because the replica ID breaks the position digit tie identically across all nodes.

---

## 4. LATA Sequence CRDT

### Algorithmic Overview

LATA (List As Tree Approach / Linearized Asymmetric Tree Algorithm) is an alternative sequence CRDT approach formulated in distributed systems research to address identifier growth and interleaving anomalies in fractional indexing algorithms.

Rather than treating the sequence as flat fractional numbers divided indefinitely, LATA organizes inserted characters into an explicit tree or directed acyclic graph of relative insertion offsets:
1. **Left/Right Relative Anchoring:** An insertion operation explicitly specifies its immediate causal predecessor ($L$) and causal successor ($R$).
2. **Asymmetric Expansion:** When concurrent operations share identical $(L, R)$ anchor contexts, LATA uses deterministic priority rules (combining Lamport timestamps, replica identifiers, and directional expansion vectors) to linearize concurrent sibling operations.
3. **Identifier Compaction:** By avoiding arbitrary deep radix subdivisions where single users insert sequential keystrokes, LATA allows contiguous blocks written by a single replica to share compression contexts.

### Theoretical Comparison: Logoot vs. LATA

| Property | Logoot | LATA |
|---|---|---|
| **Underlying Metaphor** | Dense fractional numerical space | Explicit causal insertion tree / relative anchor links |
| **Identifier Structure** | Variable-length list of `(digit, replica, clock)` tuples | Relative dependency tuple `(originId, leftId, rightId, priority)` |
| **Identifier Growth** | Deepens proportional to alternation frequency at identical positions | Grows with concurrent branching depth |
| **Storage in Memory** | Flat balanced tree / skip-list over position keys | Directed acyclic graph / tree linearized on traversal |
| **Implementation Status in WorkSphere** | **Theoretical** (not implemented in runtime) | **Theoretical** (not implemented in runtime) |

> **Crucial Implementation Note:** Neither Logoot nor LATA is directly implemented in WorkSphere's production runtime. WorkSphere delegates rich text and collaborative whiteboard synchronization to Yjs, which implements the **YATA** (Yet Another Transformation Approach) algorithm. Logoot and LATA are documented herein as the algorithmic and mathematical foundations of sequence CRDTs.

---

## 5. Concurrent Insertion and Deterministic Tie-Breaking

When distributed participants generate concurrent insertions without prior coordination, multiple position identifiers can be generated with identical spatial coordinates. A robust sequence CRDT must define a deterministic total order $(\mathcal{I}, \prec)$ that satisfies:
1. **Irreflexivity:** $\forall A \in \mathcal{I}, \; \neg(A \prec A)$
2. **Transitivity:** $\forall A, B, C \in \mathcal{I}, \; (A \prec B \land B \prec C) \implies A \prec C$
3. **Totality:** $\forall A, B \in \mathcal{I} \; (A \ne B), \; (A \prec B \lor B \prec A)$

### The Tie-Breaking Hierarchy

In sequence CRDT design, ties are broken through a deterministic hierarchy of tuples:

$$\text{Identifier} = \langle \text{PathDigits}, \; \text{LogicalClock}, \; \text{NodeID}, \; \text{SequenceCounter} \rangle$$

```
   ┌────────────────────────────────────────────────────────┐
   │              Compare Identifiers: A vs B               │
   └───────────────────────────┬────────────────────────────┘
                               │
                               ▼
               ┌───────────────────────────────┐
               │ 1. Positional Path Digits     │
               │    Lexicographical Comparison │
               └───────────────┬───────────────┘
                               │
                        [Path A == Path B]
                               │
                               ▼
               ┌───────────────────────────────┐
               │ 2. Lamport / Logical Clock    │
               │    clockA vs clockB           │
               └───────────────┬───────────────┘
                               │
                       [clockA == clockB]
                               │
                               ▼
               ┌───────────────────────────────┐
               │ 3. Lexicographical Node ID    │
               │    nodeA.localeCompare(nodeB) │
               └───────────────┬───────────────┘
                               │
                        [nodeA == nodeB]
                               │
                               ▼
               ┌───────────────────────────────┐
               │ 4. Local Sequence Counter     │
               │    counterA vs counterB       │
               └───────────────────────────────┘
```

### Deterministic Ordering Table

| Operation $A$ | Operation $B$ | Positional Path | Clock | Node ID | Deterministic Winner | Final Order |
|---|---|---|---|---|---|---|
| Ins `'X'` | Ins `'Y'` | `[10]` vs `[20]` | 1 vs 1 | `nodeA` vs `nodeB` | $A$ (smaller path) | `[X, Y]` |
| Ins `'X'` | Ins `'Y'` | `[15]` vs `[15]` | 2 vs 5 | `nodeA` vs `nodeB` | $A$ (lower clock) | `[X, Y]` |
| Ins `'X'` | Ins `'Y'` | `[15]` vs `[15]` | 3 vs 3 | `"alice"` vs `"bob"` | $A$ (`"alice" < "bob"`) | `[X, Y]` |
| Ins `'X'` | Ins `'Y'` | `[15, 4]` vs `[15]` | 1 vs 1 | `nodeA` vs `nodeA` | $B$ (shorter prefix) | `[Y, X]` |

Because every replica executes this exact comparison pipeline, every node reaches the exact same character ordering without any central coordinator.

---

## 6. Interleaving Anomalies

### What is an Interleaving Anomaly?

An **interleaving anomaly** occurs when two users concurrently type distinct words or sentences at the exact same location in a document, and the sequence CRDT algorithm interleaves the individual characters of the two strings rather than keeping each user's text block contiguous.

#### Concrete Example:
- Document contains: `"Hello "`
- User 1 types concurrently: `"Alice"`
- User 2 types concurrently: `"Bob"`
- **Expected Intention:** `"Hello AliceBob "` or `"Hello BobAlice "`
- **Interleaving Anomaly Result:** `"Hello ABloicbee "`

### Why Interleaving Happens in Fractional Indexing

When User 1 types `"Alice"` as rapid sequential keystrokes, the client assigns fractional identifiers:

$$P_A = [10], \quad P_l = [11], \quad P_i = [12], \quad P_c = [13], \quad P_e = [14]$$

Concurrently, User 2 typing `"Bob"` might generate:

$$P_B = [10, 5], \quad P_o = [11, 5], \quad P_b = [12, 5]$$

When merged lexicographically:

$$[10] \prec [10, 5] \prec [11] \prec [11, 5] \prec [12] \prec [12, 5] \dots \implies \text{"ABloicbe"}$$

The characters of `"Alice"` and `"Bob"` interleave like a deck of cards.

### Mitigation Strategies

Modern sequence CRDT algorithms mitigate interleaving via:
1. **Origin Tracking (YATA / Yjs approach):** Each operation explicitly records the ID of the character immediately to its left ($originLeft$) and right ($originRight$) at the moment of insertion. Concurrent insertions with different origins do not interleave.
2. **Boundary Allocation Strategies (Logoot-Split / LSeq):** Uses randomized or exponential base allocation ($h$-growth trees) that dynamically widens the allocation space to ensure contiguous keystroke blocks from the same replica remain clustered together.

---

## 7. Tombstones and Memory Compaction

### The Purpose of Tombstones

When a character is deleted in a sequence CRDT, it cannot simply be erased from memory immediately. 

If replica $R_1$ deletes character $C_3$ and removes it from its data structures:
1. Concurrently, replica $R_2$ inserts character $C_{new}$ immediately following $C_3$ ($\text{insertAfter}(C_3)$).
2. When $R_1$ receives $R_2$'s operation, $R_1$ no longer has any record of $C_3$ and cannot determine where to place $C_{new}$.
3. The causal reference chain breaks, leading to document corruption or replica desynchronization.

Therefore, deleted elements are converted into **tombstones** ($isDeleted = \text{true}$), keeping their position identifier $P$ in the ordering structure while omitting their visible character value.

### Conditions for Safe Tombstone Compaction

Tombstones can only be safely garbage-collected (purged from storage) when all participants in the network have observed the deletion and can never reference the deleted item again.

Mathematically, given a set of network replicas $\mathcal{R} = \{R_1, R_2, \dots, R_n\}$, let $V_i$ be the state vector of replica $R_i$. The **Stable Acknowledgement Frontier** (or causal stability horizon) $V_{\text{stable}}$ is the component-wise minimum across all active peers:

$$V_{\text{stable}}[k] = \min_{R_i \in \mathcal{R}} V_i[k]$$

A tombstone created by replica $k$ with logical clock $s$ is **safe for compaction** if and only if:

$$s < V_{\text{stable}}[k]$$

### Compaction Flow

```
   ┌────────────────────────────────────────────────────────┐
   │             Distributed Replicas A, B, C               │
   └───────────────────────────┬────────────────────────────┘
                               │
                               ▼
               ┌───────────────────────────────┐
               │ Exchange State Vectors        │
               │ (Peer Acknowledgement Matrix) │
               └───────────────┬───────────────┘
                               │
                               ▼
               ┌───────────────────────────────┐
               │ Compute Stability Frontier    │
               │ V_stable = min(V_A, V_B, V_C) │
               └───────────────┬───────────────┘
                               │
                               ▼
               ┌───────────────────────────────┐
               │ Tombstone Scan:               │
               │ clock(tombstone) < V_stable ? │
               └───────┬───────────────┬───────┘
                       │               │
                     [YES]            [NO]
                       │               │
                       ▼               ▼
           ┌──────────────────────┐  ┌──────────────────────┐
           │ Purge Tombstone from │  │ Retain Tombstone;    │
           │ IndexedDB / Memory   │  │ Offline peer might   │
           └──────────────────────┘  │ reference anchor     │
                                     └──────────────────────┘
```

### Nomad Room Disconnection Challenges

In WorkSphere's co-working rooms, nomad participants frequently close laptop lids or lose cellular connection for hours or days. 

If a disconnected peer $R_{offline}$ is retained in $\mathcal{R}$, $V_{\text{stable}}$ remains frozen at $R_{offline}$'s last observed clock, preventing **all other peers** from compacting tombstones and causing memory bloat.

WorkSphere addresses this through an **Eviction Horizon Epoch**: peers offline longer than a configured threshold (e.g., 30 days in `src/lib/offline/tombstoneCompactor.ts` or 7 days in Yjs snapshot compaction) are formally evicted from the active peer frontier. If an evicted peer reconnects later, it is rejected from incremental differential sync and must re-initialize its document from a fresh base snapshot.

---

## 8. Convergence Properties and Mathematical Reasoning

### Theorem: Deterministic Convergence of Sequence CRDTs

Let $\mathcal{O} = \{o_1, o_2, \dots, o_n\}$ be a finite set of insertion operations. Each operation $o_i = \langle id_i, char_i \rangle$ contains a unique identifier $id_i \in \mathcal{I}$ and a character payload $char_i$.

Suppose the position identifier space $(\mathcal{I}, \prec)$ is a strict total order.

**Assertion:** Any two replicas $R_A$ and $R_B$ that receive the set $\mathcal{O}$ in any arbitrary delivery order will display the exact same sequence of characters.

#### Proof Outline:
1. **Uniqueness:** By construction, each position identifier $id_i = \langle \text{path}_i, \text{clock}_i, \text{replica}_i \rangle$ is unique across the entire distributed system because each replica identifier $\text{replica}_i$ is unique and each replica's $\text{clock}_i$ is strictly monotonic.
2. **Total Ordering:** The comparison operator $\prec$ is a strict total order over $\mathcal{I}$. For any two operations $o_j, o_k \in \mathcal{O}$ ($j \ne k$), $id_j \ne id_k$, which implies either $id_j \prec id_k$ or $id_k \prec id_j$.
3. **Sorted Representation:** Both replicas represent the document sequence as the ordered set:
   $$S = [o_{\pi(1)}, o_{\pi(2)}, \dots, o_{\pi(n)}] \quad \text{such that} \quad id_{\pi(1)} \prec id_{\pi(2)} \prec \dots \prec id_{\pi(n)}$$
4. **Permutation Identity:** Since a finite set equipped with a strict total order has a unique sorted permutation, the permutation $\pi$ on replica $R_A$ is identical to the permutation $\pi$ on replica $R_B$.
5. **Conclusion:** Both replicas converge to the exact same ordered string $char_{\pi(1)} char_{\pi(2)} \dots char_{\pi(n)}$. $\blacksquare$

### Consistency Model Distinctions

- **Strong Eventual Consistency (SEC):** Replicas that have received the same set of updates have identical visible state without requiring rollback, negotiation, or consensus phases.
- **Causal Ordering:** Guarantees that if operation $A$ caused operation $B$ ($A \to B$), then every node processes $A$ before $B$.
- **Deterministic Ordering:** A tie-breaking mechanism that enforces identical ordering decisions on concurrent operations without communication.

---

## 9. Complexity and Algorithmic Trade-offs

| Dimension | Logoot | LATA | YATA (Yjs Standard) |
|---|---|---|---|
| **Identifier Size** | Grows with depth ($O(D \cdot \text{sizeOf(tuple)})$) | Variable tree path | Fixed coordinate $\text{ID}(client, clock)$ |
| **Comparison Cost** | $O(D)$ where $D$ is path depth | $O(D)$ tree search | $O(1)$ coordinate comparison + causal left/right resolution |
| **Memory Overhead** | High per-character overhead (~40–80 bytes per character) | Moderate per-character overhead | High without compaction; low when merged into contiguous blocks |
| **Interleaving Susceptibility** | High under simple midpoint split; mitigated by LSeq | Low | Extremely Low (explicit origin left/right bounding) |
| **Tombstone Requirement** | Yes (or boundary tree retaining deleted paths) | Yes | Yes (retained in Yjs DeleteSet until snapshot compaction) |
| **Suitability for Keystrokes** | Poor for rapid typing unless batched | Good for tree-structured editing | Excellent for rich text, code, and canvas whiteboards |

---

## 10. WorkSphere Implementation Mapping

The following table explicitly maps the theoretical concepts discussed in this specification to actual implementations and files within the WorkSphere repository:

| Concept | Relevant WorkSphere File / Component | Actual Repository Behavior | Status |
|---|---|---|---|
| **Causal Partial Ordering** | `src/core/sync/VectorClock.ts` | Map of `nodeId -> counter`; implements happens-before ($A < B$), concurrent ($A \parallel B$), and semilattice join. | **Implemented (Production)** |
| **Causal Buffering & Monotonicity** | `src/core/sync/OfflineMutationQueue.ts` | Buffers offline mutations, checks causal dependencies before dispatch, handles exponential/jitter backoff and gzip compression (#9728). | **Implemented (Production)** |
| **Deterministic Tie-Breaking Hierarchy** | `docs/architecture/CAUSAL_ORDERING_AND_TIEBREAKING.md`, `src/core/sync/LamportTimestampResolver.ts` | Resolves concurrent mutations via `HLC -> Lamport Timestamp -> Node ID -> Mutation ID`. | **Implemented (Production)** |
| **Sequence Collaborative Text CRDT** | `src/components/sessions/Scratchpad.tsx`, `src/lib/crdt/snapshotManager.ts` | Uses **Yjs (YATA)** with `Y.Text` and `Y.Doc` for collaborative notes and Monaco code editor. | **Implemented (Production via Third-Party)** |
| **Canvas Whiteboard Spatial CRDT** | `src/hooks/useMeshCanvasWhiteboard.ts`, `src/lib/whiteboard/whiteboardCore.ts` | Uses `Y.Array<Y.Map>` over WebRTC P2P DataChannels and PartyKit WebSocket fallback. | **Implemented (Production)** |
| **Tombstone Compactor & Eviction** | `src/lib/offline/tombstoneCompactor.ts` | Scans IndexedDB stores, purges tombstones older than 30 days while skipping unmerged vector clock branches. | **Implemented (Library Utility)** |
| **Logoot Fractional Indexing Algorithm** | `docs/crdt/SEQUENCE_CRDT_MATHEMATICS.md` | Documented as foundational fractional indexing model; not used as standalone runtime class. | **Explanatory / Theoretical** |
| **LATA Sequence Algorithm** | `docs/crdt/SEQUENCE_CRDT_MATHEMATICS.md` | Documented as an asymmetric tree alternative; not implemented in runtime codebase. | **Explanatory / Theoretical** |

---

## 11. References

1. **Logoot Paper:**  
   Weiss, S., Urso, P., & Molli, P. (2009). *Logoot: A Additive Polynomial-Time Algorithm for Collaborative Editing with Good Properties*. Research Report RR-6713, INRIA. [INRIA Open Access](https://inria.hal.science/inria-00336158).
2. **LSeq (Logoot Extension for Interleaving Mitigation):**  
   Nédelec, B., Molli, P., Mostefaoui, A., & Desmontils, E. (2013). *LSeq: an adaptive structure for designed collaborative editing with reversible mutation*. Proceedings of the 2013 ACM symposium on Document engineering (DocEng '13), pp. 37–46.
3. **YATA (Yjs Underlying Algorithm):**  
   Nicolaescu, P., Jahns, V., Derntl, M., & Klamma, R. (2016). *Near Real-Time Peer-to-Peer Shared Editing on Extensible Data Types*. In International Conference on Web Engineering (ICWE 2016), Springer, Cham, pp. 39–57.
4. **Comprehensive Survey on Sequence CRDTs:**  
   Shapiro, M., Preguiça, N., Baquero, C., & Zawirski, M. (2011). *Conflict-Free Replicated Data Types*. In Symposium on Self-Stabilizing Systems (SSS 2011), Lecture Notes in Computer Science, vol 6976. Springer, Berlin, Heidelberg.
5. **WorkSphere Architecture Documentation:**  
   - [`docs/architecture/CAUSAL_ORDERING_AND_TIEBREAKING.md`](../architecture/CAUSAL_ORDERING_AND_TIEBREAKING.md)
   - [`docs/crdt/CRDT_VECTOR_MATHEMATICAL_SPEC.md`](./CRDT_VECTOR_MATHEMATICAL_SPEC.md)
   - [`docs/crdt/YJS_SYNC_PROTOCOL.md`](./YJS_SYNC_PROTOCOL.md)
   - [`docs/crdt/CRDT_MULTI_PEER_VECTOR_GC.md`](./CRDT_MULTI_PEER_VECTOR_GC.md)
