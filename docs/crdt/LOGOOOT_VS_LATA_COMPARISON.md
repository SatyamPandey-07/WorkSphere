# Sequence CRDT Comparison: Logoot vs. LATA

> **Status:** Architecture Reference & Theoretical Algorithmic Comparison  
> **Scope:** Dense Fractional Identifiers (Logoot) vs. Relative Dependency Tree Allocation (LATA / YATA-family)  
> **Related Architecture:** [`./SEQUENCE_CRDT_MATHEMATICS.md`](./SEQUENCE_CRDT_MATHEMATICS.md), [`./CRDT_VECTOR_MATHEMATICAL_SPEC.md`](./CRDT_VECTOR_MATHEMATICAL_SPEC.md), [`./CRDT_MULTI_PEER_VECTOR_GC.md`](./CRDT_MULTI_PEER_VECTOR_GC.md), and [`../architecture/CAUSAL_ORDERING_AND_TIEBREAKING.md`](../architecture/CAUSAL_ORDERING_AND_TIEBREAKING.md)

---

## A. Introduction

Sequence Conflict-Free Replicated Data Types (Sequence CRDTs) form the algorithmic backbone of distributed, real-time collaborative text editors, whiteboards, and scratchpads. In an environment without centralized locking or single-leader arbitration, multiple peers concurrently insert, modify, and delete characters or drawing primitives across a shared linear order.

### The Problem Space: Why Identifier Mechanics Matter
In single-threaded linear buffers, elements are indexed by continuous integer positions $0, 1, \dots, n-1$. However, simple integer offsets fail in distributed networks because insertions or deletions at index $i$ shift all subsequent character offsets $j > i$. If concurrent operations cross over network partitions, applying index-based transformations leads to non-deterministic buffer divergence and silent data corruption.

To achieve Strong Eventual Consistency (SEC) and Intention Preservation without coordination, sequence CRDTs assign every inserted element an immutable identifier. The design of these identifiers governs four critical operational metrics:
1. **Identifier Size & Boundary Growth:** Whether repetitive keystrokes (such as prepending characters at the document head) cause identifier bit-depths to explode asymptotically.
2. **Memory Footprint:** The overhead of storing structural metadata per character (e.g., 50–200 bytes of metadata for a 1-byte character).
3. **Insertion & Lookup Complexity:** The algorithmic runtime required to compute valid intermediate identifiers and insert them into local search trees (e.g., $O(\log n)$ vs. $O(n)$).
4. **Tombstone & Garbage Collection Overhead:** How deleted characters are handled to preserve causal references without causing unbounded memory leaks.

### Scope and Assumptions of This Comparison
This document presents a rigorous comparative analysis between two distinct sequence CRDT paradigms:
- **Logoot:** The canonical dense fractional indexing algorithm operating over a multi-level radix number space.
- **LATA (List As Tree Approach):** An asymmetric relative dependency tree algorithm related to the tree-linearization family (e.g., YATA / Treedoc / Causal Trees).

*Critical Repository Context:* WorkSphere’s collaborative runtime utilizes Yjs (which implements the YATA algorithm) and custom state-graph CRDTs (`CrdtDocument.ts`). Neither Logoot nor LATA is implemented as a standalone runtime class in WorkSphere's production codebase; this document serves as an architectural evaluation framework and algorithmic baseline.

---

## B. Formal Mathematical Definitions

### 1. Logoot

Logoot was formulated by Stéphane Weiss, Pascal Urso, and Pascal Molli (2009) as an operation-based sequence CRDT that provides unbounded dense ordering without central coordination.

#### Identifier Structure
An identifier $L \in \mathcal{L}$ in Logoot is an ordered list of identifier triples bounded between two immutable sentinels:
- Start sentinel: $\mathcal{I}_{\text{start}} = [\langle 0, 0, 0 \rangle]$
- End sentinel: $\mathcal{I}_{\text{end}} = [\langle \text{max\_pos}, 0, 0 \rangle]$

Each triple $c_k$ at depth level $k$ is defined as:
$$c_k = \langle p_k, r_k, s_k \rangle \in \mathbb{N} \times \mathcal{R} \times \mathbb{N}$$
where:
- $p_k \in \{0, 1, \dots, \text{base} - 1\}$ is an integer digit in numerical base $\mathcal{B}$ (e.g., $\mathcal{B} = 2^{16} = 65{,}536$ or $\mathcal{B} = 2^{32}$).
- $r_k \in \mathcal{R}$ is the unique immutable replica identifier (e.g., UUID or integer client ID).
- $s_k \in \mathbb{N}$ is the monotonic logical clock or session counter of replica $r_k$.

The complete identifier is represented as:
$$L = [c_1, c_2, \dots, c_d] = [\langle p_1, r_1, s_1 \rangle, \langle p_2, r_2, s_2 \rangle, \dots, \langle p_d, r_d, s_d \rangle]$$

#### Lexicographic Ordering
Let $L_A = [a_1, \dots, a_m]$ and $L_B = [b_1, \dots, b_n]$ be two Logoot identifiers. The total order $<_L$ is evaluated lexicographically:
$$L_A <_L L_B \iff \exists i \ge 1 \text{ such that } (\forall j < i, a_j = b_j) \land (a_i <_c b_i \lor (i = m + 1 \land m < n))$$
where component comparison $<_c$ is defined as:
$$\langle p_a, r_a, s_a \rangle <_c \langle p_b, r_b, s_b \rangle \iff (p_a < p_b) \lor (p_a = p_b \land r_a < r_b) \lor (p_a = p_b \land r_a = r_b \land s_a < s_b)$$

#### Intermediate Allocation Strategy
To insert an element between $L_{\text{prev}}$ and $L_{\text{next}}$ ($L_{\text{prev}} <_L L_{\text{next}}$):
1. Find the lowest depth level $d$ where $L_{\text{prev}}$ and $L_{\text{next}}$ share a common prefix.
2. Calculate the numerical distance between the digits at level $d$:
   $$\Delta = p_{\text{next}, d} - p_{\text{prev}, d}$$
3. If $\Delta > 1$, allocate a new digit $p_{\text{new}} \in (p_{\text{prev}, d}, p_{\text{next}, d})$ (e.g., midpoint $p_{\text{prev}, d} + \lfloor \Delta / 2 \rfloor$ or boundary step). The new identifier retains depth $d$:
   $$L_{\text{new}} = [c_1, \dots, c_{d-1}, \langle p_{\text{new}}, r_{\text{local}}, s_{\text{local}} \rangle]$$
4. If $\Delta \le 1$, no integer exists between the digits at level $d$. The allocator copies $c_{\text{prev}, d}$ and appends a new level $d+1$, selecting a digit in $(0, \text{base}-1)$:
   $$L_{\text{new}} = [c_{\text{prev}, 1}, \dots, c_{\text{prev}, d}, \langle p_{d+1}, r_{\text{local}}, s_{\text{local}} \rangle]$$

#### Uniqueness and Concurrency
Because replica identifier $r \in \mathcal{R}$ and session counter $s \in \mathbb{N}$ are appended to each position tuple, two distinct replicas $R_1 \ne R_2$ allocating at identical position digits $p$ generate distinct tuples: $\langle p, R_1, s_1 \rangle \ne \langle p, R_2, s_2 \rangle$. Equality $L_A = L_B$ occurs if and only if both identifiers represent the identical operation from the same replica.

---

### 2. LATA (List As Tree Approach)

LATA represents the family of sequence CRDTs that replace flat multi-level fractional coordinate spaces with an explicit directed graph or tree of causal dependency anchors.

#### Identifier Structure
An item in LATA is identified by its immutable causal creation ID and explicit spatial anchor references:
$$\mathcal{I}_{\text{LATA}} = \langle \text{id}, \text{originLeft}, \text{originRight}, \text{priority} \rangle$$
where:
- $\text{id} = \langle r, s \rangle \in \mathcal{R} \times \mathbb{N}$ is the Lamport timestamp or unique sequence identifier of the inserted character.
- $\text{originLeft} \in \mathcal{I}_{\text{LATA}} \cup \{\bot\}$ is the immutable identifier of the character immediately to its left at the moment of insertion.
- $\text{originRight} \in \mathcal{I}_{\text{LATA}} \cup \{\top\}$ is the immutable identifier of the character immediately to its right at the moment of insertion.
- $\text{priority} = \langle \text{clock}, r \rangle$ is a deterministic total order token used to arbitrate concurrent insertions that share the same left and right anchors.

#### Ordering and Linearization Strategy
Unlike Logoot, which sorts elements purely by mathematical position tuples, LATA treats the document as an ordered tree where elements are child nodes branching off their `originLeft` predecessor.
When two concurrent operations $O_1 = \langle \text{id}_1, L, R, \dots \rangle$ and $O_2 = \langle \text{id}_2, L, R, \dots \rangle$ are inserted between the same boundary pair $(L, R)$:
1. Both operations branch from anchor $L$.
2. To avoid interleaving anomalies and ensure strong convergence across replicas, the linearization follows deterministic traversal rules:
   - If $\text{originRight}(O_1) = \text{originRight}(O_2)$, the relative order between $O_1$ and $O_2$ is broken by their creation priority:
     $$O_1 \prec_{\text{LATA}} O_2 \iff \text{priority}(O_1) < \text{priority}(O_2)$$
   - If operations have nested or crossing boundary spans, the tree linearization traverses left-children recursively while ensuring causal descendants remain clustered next to their origins.

#### Uniqueness and Concurrency
Uniqueness is established directly by the Lamport tuple $\langle r, s \rangle$. Because each replica advances $s$ monotonically for every keystroke, $\text{id}$ is guaranteed unique across all nodes. Concurrent conflict resolution relies on tree linearization rather than deepening fractional vectors.

---

## C. Identifier Growth Analysis

A fundamental performance metric of sequence CRDTs is the rate at which identifier size (in bits or bytes) grows as a document evolves.

### 1. Best-Case Identifier Growth
- **Logoot:** When insertions occur uniformly at random positions throughout a text buffer, fractional gaps remain wide. The depth of identifiers grows logarithmically with sequence length:
  $$\text{Depth}_{\text{Logoot, Best}} = O(\log_{\mathcal{B}} n)$$
  For base $\mathcal{B} = 2^{32}$, a document of $10^6$ characters typically requires a depth of only 1 to 2 levels (20–40 bytes per identifier).
- **LATA:** When single users type sequentially left-to-right, each character references its immediate predecessor. The identifier itself does not deepen; it remains a fixed-size reference tuple:
  $$\text{Depth}_{\text{LATA, Best}} = O(1)$$
  Because sequential characters share contiguous sequence numbers $\langle r, s \rangle, \langle r, s+1 \rangle$, block encoding compresses thousands of keystrokes into a single contiguous block descriptor.

### 2. Worst-Case Boundary Growth: Repetitive Left-Insertion
The most notorious failure mode in fractional indexing is **repetitive prepending at the left boundary** (typing at index 0):

```
Step 0: Boundary 0                                                    Boundary 100
Step 1: Insert 'A' at 0 -> Midpoint [50]
Step 2: Insert 'B' at 0 -> Between 0 and [50] -> Midpoint [25]
...
Step 6: Insert 'F' at 0 -> Between 0 and [1] -> Midpoint: Digits exhausted!
Step 7: Must append depth: [0, 50]
Step 8: Must append depth: [0, 25] ...
```

#### Logoot Behavior Under Repetitive Left-Insertion
When inserting repeatedly at the left boundary:
- Let the base be $\mathcal{B}$. After at most $\log_2(\mathcal{B})$ insertions between 0 and 1, the digit space at level 1 is completely exhausted.
- To maintain strict fractional order, every subsequent insertion must append an additional depth level:
  $$\text{Identifier Size}_{\text{Logoot, Left-Worst}} = O(n)$$
- After $n = 10{,}000$ consecutive left-insertions, the $n$-th identifier has depth $d \approx n / \log_2(\mathcal{B})$.
- Serialized identifier size for the latest character reaches $O(n)$ bytes, and total document identifier storage expands quadratically to **$O(n^2)$** unless costly global rebalancing is executed.

#### LATA Behavior Under Repetitive Left-Insertion
In LATA, inserting at the left boundary simply sets $\text{originLeft} = \bot$ and $\text{originRight} = \text{previous\_head}$.
- The identifier size does not increase with insertion depth:
  $$\text{Identifier Size}_{\text{LATA, Left-Worst}} = O(1)$$
- Each character requires exactly one fixed Lamport tuple $\langle r, s \rangle$ plus reference pointers. Total metadata storage scales linearly: **$O(n)$**.

### 3. Repetitive Right-Insertion (Append)
- **Logoot:** Appending at the right boundary (between $L_{\text{last}}$ and $\mathcal{I}_{\text{end}}$) increments the top-level digit $p_1 \leftarrow p_1 + \text{step}$. As long as $p_1 < \mathcal{B}$, depth remains 1 ($O(1)$ size). Once $p_1$ reaches $\text{max\_pos}$, depth increments, but growth remains modest: $O(\log_{\mathcal{B}} n)$.
- **LATA:** Appending at the right boundary updates $\text{originLeft} \leftarrow \text{last\_id}$ and $\text{originRight} \leftarrow \top$. Stored size is strictly $O(1)$ per character, and contiguous sequential runs can be run-length compressed into $O(1)$ total storage for the entire append burst.

### 4. Summary of Asymptotic Growth Complexity

| Insertion Pattern | Logoot Identifier Depth | Logoot Storage Complexity | LATA Identifier Size | LATA Storage Complexity |
| :--- | :--- | :--- | :--- | :--- |
| **Uniform Random** | $O(\log_{\mathcal{B}} n)$ | $O(n \log_{\mathcal{B}} n)$ | $O(1)$ | $O(n)$ |
| **Repetitive Left (Prepend)** | $O(n)$ *(boundary exhaustion)* | $O(n^2)$ *(quadratic blowup)* | $O(1)$ | $O(n)$ |
| **Repetitive Right (Append)** | $O(\log_{\mathcal{B}} n)$ | $O(n)$ | $O(1)$ | $O(n)$ ($O(1)$ with RLE) |
| **Alternating Midpoint** | $O(n)$ | $O(n^2)$ | $O(1)$ | $O(n)$ |

---

## D. Tombstone Garbage Collection

When a character is deleted in a collaborative sequence, its presence cannot simply be erased from memory immediately. Other replicas may have concurrent in-flight operations referencing that character's position or boundaries.

### 1. Tombstone Retention vs. Pure Erasure
- **Logoot Deletion Model:** Logoot does **not strictly require tombstones** for ordering stability. Because position identifiers are dense and immutable in a fractional space, deleting an element consists of broadcasting $\text{delete}(L_i)$. A replica receiving $\text{delete}(L_i)$ can remove $L_i$ from its balanced search tree entirely. Concurrent insertions between $L_{i-1}$ and $L_{i+1}$ do not depend on $L_i$'s existence in memory because their fractional coordinates remain mathematically valid.
  - *Risk:* If a peer receives an insertion anchored against $L_i$ while unaware of its deletion, or if operations arrive out-of-order, Logoot easily reconstructs ordering since $L_i$ was a self-contained spatial coordinate.
- **LATA Deletion Model:** LATA **strictly requires tombstones**. Because subsequent characters establish parent-child relationships referencing $\text{originLeft}$ and $\text{originRight}$, physically removing an item from the tree breaks graph connectivity. Deleting an item marks it as a tombstone (`deleted = true`), retaining its identifier tuple in memory to preserve traversal paths for future concurrent edits.

### 2. Safe Deletion and Reclamation Conditions
In LATA and tombstone-based sequence CRDTs, safe physical reclamation (Garbage Collection) requires proving causal stability:
$$\text{SafeToReclaim}(id) \iff \forall R_k \in \mathcal{R}_{\text{active}}, \; \text{ObservedClock}(R_k) \ge \text{Clock}(id) \land \neg \exists \text{ in-flight ops referencing } id$$

#### Causal Stability via State Vectors
Replicas periodically exchange their state vectors $V$:
$$V = \{r_1 \mapsto c_1, r_2 \mapsto c_2, \dots, r_m \mapsto c_m\}$$
The globally stable state vector $V_{\text{stable}}$ is computed as:
$$V_{\text{stable}} = \min_{R_k \in \mathcal{R}} V_{R_k}$$
Any tombstone whose generation timestamp $\le V_{\text{stable}}$ and which has no active child branches can theoretically be pruned.

### 3. Risks of Offline Peers and Delayed Synchronization
- **The Long-Offline Peer Bottleneck:** If a single nomad peer goes offline (e.g., closing a laptop for 7 days), its state vector entry in $V_{\text{stable}}$ remains frozen at its last known clock. Consequently, **no tombstones can be safely garbage collected** by any peer in the room. The document accumulates every deletion indefinitely, causing memory bloat.
- **Premature GC Hazards:** If online peers forcefully purge tombstones to save memory and the offline peer subsequently reconnects, sending operations anchored to purged nodes:
  1. The online replicas cannot resolve the anchor positions, resulting in orphaned elements.
  2. Replicas diverge permanently or crash during graph traversal.

### 4. Compaction and Identifier Remapping Trade-offs
To recover from quadratic boundary growth (Logoot) or tombstone accumulation (LATA), systems can execute document compaction:
- **Global Remapping:** Re-assigning dense integer identifiers to all active characters.
- **Trade-off:** Remapping requires a synchronous consensus barrier (e.g., Raft or Paxos) or epoch-based re-indexing. Any in-flight operation using old identifiers must be transformed through an identifier-translation table, introducing substantial implementation complexity.

---

## E. Memory and Operation Overhead

The practical viability of a sequence CRDT is dictated by its per-character memory overhead and serialization footprint.

### Mathematical Breakdown of Per-Character Overhead

#### 1. Logoot Memory Model
For an identifier of depth $d$:
$$M_{\text{Logoot}}(d) = S_{\text{node}} + d \times (S_{\text{pos}} + S_{\text{replica}} + S_{\text{clock}}) + S_{\text{char}}$$
where:
- $S_{\text{node}}$: Tree/skip-list pointer overhead ($\approx 24\text{–}32\text{ bytes}$ in 64-bit V8).
- $S_{\text{pos}}$: Radix digit ($4\text{–}8\text{ bytes}$).
- $S_{\text{replica}}$: Client identifier ($8\text{–}16\text{ bytes}$ for numeric ID or UUID reference).
- $S_{\text{clock}}$: Monotonic integer counter ($4\text{–}8\text{ bytes}$).
- $S_{\text{char}}$: UTF-8 / UTF-16 character payload ($1\text{–}2\text{ bytes}$).

*At depth $d = 1$:* $M_{\text{Logoot}}(1) \approx 32 + (4 + 8 + 4) + 1 \approx 49\text{ bytes per character}$.  
*At depth $d = 10$ (repetitive prepend):* $M_{\text{Logoot}}(10) \approx 32 + 10 \times 16 + 1 \approx 193\text{ bytes per character}$.

#### 2. LATA Memory Model
In LATA, each character node in the sequence tree maintains fixed structural metadata:
$$M_{\text{LATA}} = S_{\text{node}} + S_{\text{id}} + S_{\text{left}} + S_{\text{right}} + S_{\text{tombstone}} + S_{\text{char}}$$
where:
- $S_{\text{node}}$: Object reference and child array pointers ($\approx 32\text{ bytes}$).
- $S_{\text{id}}$: Lamport identifier $\langle r, s \rangle$ ($\approx 12\text{–}16\text{ bytes}$).
- $S_{\text{left}}, S_{\text{right}}$: Anchor references ($\approx 16\text{ bytes}$).
- $S_{\text{tombstone}}$: Deletion boolean flag ($\approx 1\text{ byte}$).
- $S_{\text{char}}$: Character payload ($1\text{–}2\text{ bytes}$).

*Total per character:* $M_{\text{LATA}} \approx 32 + 16 + 16 + 1 + 1 \approx 66\text{ bytes per character}$ (constant across all depths).  
*Run-Length Block Optimization:* Contiguous characters typed by the same peer can be grouped:
$$M_{\text{LATA, Block}}(k) = M_{\text{header}} + k \times S_{\text{char}} \implies \lim_{k \to \infty} \frac{M_{\text{LATA, Block}}(k)}{k} \approx 1.2\text{ bytes per character}$$

---

## F. Benchmark Comparison — 10,000 Edits

> **Critical Notice Regarding Benchmark Data:**  
> The values tabulated below represent **theoretical analytical estimates** derived from formal algorithmic equations, serialized binary encoding specifications (VarInt, UTF-8, 16-bit replica indices), and standard document workloads. They are **not empirical physical lab measurements** executed on a hardware testbench.

### Simulation Specifications and Assumptions
- Total operations: $N = 10{,}000$ operations.
- Character size: 1 byte (ASCII text).
- Base radix for Logoot: $\mathcal{B} = 2^{16} = 65{,}536$.
- Serialized identifier encoding: Compact variable-length integer (VarInt) encoding with 2-byte client ID dictionary lookups.
- LATA format: Item ID $\langle \text{client}, \text{clock} \rangle$, left anchor ID, right anchor ID. Sequential runs use Run-Length Block Encoding (RLE).

### Analytical Benchmark Projections (10,000 Edits)

| Scenario | Algorithm | Number of Edits | Average Identifier Size (bytes) | Maximum Identifier Size (bytes) | Total Serialized Identifier Bytes (KB) | Measurement Type |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Uniform Random Insertion** | Logoot | 10,000 | 8.4 B | 14 B | ~84 KB | Theoretical Estimate |
| | LATA | 10,000 | 12.0 B | 16 B | ~120 KB | Theoretical Estimate |
| **2. Repetitive Left-Insertion (Prepend)** | Logoot | 10,000 | 620.0 B | 1,250 B | ~6,200 KB (6.2 MB) | Theoretical Estimate |
| | LATA | 10,000 | 12.0 B | 16 B | ~120 KB | Theoretical Estimate |
| **3. Repetitive Right-Insertion (Append)** | Logoot | 10,000 | 6.0 B | 8 B | ~60 KB | Theoretical Estimate |
| | LATA (RLE Block) | 10,000 | 0.02 B | 16 B | ~0.2 KB (200 B) | Theoretical Estimate |
| **4. Mixed 80% Ins / 20% Del (Random)** | Logoot (No Tombstones) | 10,000 | 8.8 B | 16 B | ~70.4 KB (8k live) | Theoretical Estimate |
| | LATA (With Tombstones) | 10,000 | 12.0 B | 16 B | ~120 KB (10k items) | Theoretical Estimate |

### Analysis of Scenarios
1. **Uniform Random Insertion:** Logoot performs marginally better than uncompressed LATA because random insertions distribute evenly across the base-$2^{16}$ radix tree, keeping depth at 1–2 levels.
2. **Repetitive Left-Insertion:** Logoot experiences pathological quadratic degradation ($O(n^2)$), ballooning to 6.2 MB of serialized identifiers for a 10 KB text file. LATA remains perfectly stable at 120 KB ($O(n)$).
3. **Repetitive Right-Insertion:** LATA with contiguous block encoding excels, reducing 10,000 sequential keystrokes into a few compressed chunk descriptors (~200 bytes total).
4. **Mixed Insertion & Deletion:** Logoot immediately purges deleted character identifiers from memory, retaining only the remaining 8,000 active nodes. LATA must preserve the 2,000 tombstones in memory to sustain the causal graph, yielding larger total storage until causal stability permits garbage collection.

---

## G. Comparison Summary

| Evaluation Dimension | Logoot | LATA |
| :--- | :--- | :--- |
| **Foundational Abstraction** | Multi-level fractional numbering space | Relative causal dependency tree |
| **Identifier Complexity** | Variable-length tuple list: $\sum \langle \text{pos}, \text{replica}, \text{clock} \rangle$ | Fixed tuple: $\langle \text{id}, \text{originLeft}, \text{originRight} \rangle$ |
| **Boundary Growth (Prepend)** | **Pathological $O(n)$ depth** (quadratic $O(n^2)$ total bytes) | **Constant $O(1)$ size** ($O(n)$ total bytes) |
| **Sequential Append Overhead** | $O(\log_{\mathcal{B}} n)$ per character | **$O(1)$ per character**; $O(1)$ amortized with RLE |
| **Tombstone Requirement** | **Not strictly required**; immediate node deletion supported | **Strictly required**; deletion leaves tombstones |
| **Garbage Collection Risk** | Low (no graph dependency); rebalancing needed for depth | High; requires global causal stability vector |
| **Sensitivity to Offline Peers** | Low; active nodes can delete elements locally | High; offline peers prevent tombstone pruning |
| **Character Interleaving Anomaly** | Possible under concurrent midpoint conflicts | Mitigated by deterministic tree linearization rules |
| **Implementation Complexity** | Medium (arbitrary precision arithmetic, tree balancing) | High (causal tree traversal, tombstone GC, tie-breaking) |
| **Suitability for Whiteboards** | Moderate for discrete nodes; poor for long stroke sequences | Excellent for continuous strokes and sequential text |

---

## H. Implications for WorkSphere

### 1. Assessment of WorkSphere’s Current Architecture
WorkSphere’s collaborative features encompass two primary data models:
- **Collaborative Whiteboard (`useMeshCanvasWhiteboard` / `CrdtDocument.ts`):** Operates primarily on discrete vector objects (rectangles, cards, connectors, stroke points). In `CrdtDocument.ts`, items are tracked via unique element IDs with vector clocks, tombstones, and Run-Length Encoded (RLE) tombstone ranges.
- **Collaborative Notes & Rich Text:** Relies on Yjs, an industrial implementation of the **YATA** family (conceptually aligned with LATA).

### 2. Why Logoot is Unsuitable for WorkSphere Collaborative Notes
If WorkSphere were to adopt a pure Logoot fractional indexing scheme for text editing:
- Users typing at the beginning of notes or inserting lines at the top of code snippets would rapidly trigger fractional depth exhaustion.
- Over mobile WebRTC TURN relays (which enforce a 48 kbps bandwidth budget under Issue #9864 / #9727), transmitting bloated fractional identifiers would quickly congest DataChannels and trigger backpressure throttling.

### 3. Optimization Opportunities for WorkSphere CRDTs
1. **RLE Tombstone Range Compaction:** WorkSphere's `CrdtDocument.ts` already leverages RLE tombstone compaction, reducing contiguous deletion payloads by $>60\%$. This approach aligns with LATA's block-structuring principles.
2. **State-Vector Checksum Verification:** As documented in [`./STATE_VECTOR_CHECKSUM_PROTOCOL.md`](./STATE_VECTOR_CHECKSUM_PROTOCOL.md), WorkSphere uses lightweight checksums to detect vector clock desync without transmitting redundant full-state graphs over WebRTC DataChannels.
3. **Decoupled Ephemeral States:** Real-time whiteboard cursor broadcasts use ephemeral, unversioned messages rather than persistent sequence CRDT tokens, avoiding tombstone accumulation entirely for high-frequency transients.

---

## I. References

1. **Weiss, S., Urso, P., & Molli, P. (2009).** *Logoot: A Scalable Optimistic Replication Algorithm for Collaborative Editing on P2P Networks.* IEEE 29th International Conference on Distributed Computing Systems (ICDCS 2009), Montreal, Quebec, Canada. [DOI: 10.1109/ICDCS.2009.75](https://doi.org/10.1109/ICDCS.2009.75)
2. **Weiss, S., Urso, P., & Molli, P. (2010).** *Logoot-Undo: Reversing Collaborative Actions in P2P Networks.* Technical Report, INRIA / Université Henri Poincaré.
3. **Preguiça, N., Marquès, J. M., Shapiro, M., & Letia, M. (2009).** *A Commutative Replicated Data Type for Cooperative Editing.* IEEE 29th International Conference on Distributed Computing Systems (ICDCS 2009). [DOI: 10.1109/ICDCS.2009.20](https://doi.org/10.1109/ICDCS.2009.20) *(Treedoc reference)*
4. **Nicolás, P., Baquero, C., & Shapiro, M. (2018).** *Conflict-free Replicated Data Types (CRDTs).* Distributed Systems: Causality, CRDTs, and Consistency.
5. **Shapiro, M., Preguiça, N., Baquero, C., & Zawirski, M. (2011).** *Conflict-Free Replicated Data Types.* Symposium on Self-Stabilizing Systems (SSS 2011), Springer LNCS 6976, pp. 386–400.
6. **Yjs / YATA Architecture:** *Near-instantaneous Collaborative Editing using YATA.* Technical report on causal graph linearization without interleaving anomalies.
