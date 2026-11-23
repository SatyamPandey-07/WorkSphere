# Causal Ordering & Deterministic Conflict Resolution in WorkSphere

> **Technical Architecture Specification & Mathematical Foundations**  
> **Status:** Production Standard  
> **Target Subsystems:** Decentralized Sync (`src/core/sync/VectorClock.ts`, `src/core/sync/LamportTimestampResolver.ts`, `src/core/sync/HybridLogicalClock.ts`, `src/core/sync/CausalVectorClockEngine.ts`)  
> **Protocol Scope:** Causal Partial Ordering, Hybrid Logical Clock (HLC) Tie-Breaking, Lamport Timestamps, Network Partition Reconciliation, and Stability Horizon Pruning  

---

## 1. Executive Summary

Distributed collaboration in WorkSphere—such as real-time whiteboard drawing, offline note editing, shared floor-plan layouts, and peer-to-peer workspace reservations—operates across unreliable networks subject to high latency, transient WAN dropouts, and arbitrary partitions. 

### Why Wall-Clock Timestamps Fail
Relying solely on physical wall-clock timestamps (such as `Date.now()` or NTP-synchronized system clocks) is provably insufficient for distributed state ordering:
1. **Clock Skew & Drift:** Physical quartz clocks drift at rates of 1–10 ppm. Even with NTP, virtualized containers, mobile devices, and browser runtimes experience clock skew ranging from tens of milliseconds to seconds.
2. **Loss of Causal Precedence:** An edit on Peer A with a drifted backward clock could receive a lower timestamp than an edit on Peer B that causally depended on it, causing an invalid "time travel" overwrite.
3. **Non-Monotonicity:** Leap seconds, NTP phase adjustments, or user time changes can step physical clocks backward.

### Dual-Layer Ordering Architecture
WorkSphere separates causal tracking from deterministic conflict resolution:
- **Causal Partial Ordering via Vector Clocks:** Tracks causal dependency graphs across offline nodes. Accurately identifies whether mutation $A$ strictly preceded mutation $B$ ($A < B$), succeeded it ($A > B$), was identical ($A = B$), or was concurrent ($A \parallel B$).
- **Deterministic Total Ordering via HLC & Lamport Resolvers:** When mutations are concurrent ($A \parallel B$), vector clocks alone cannot choose a winner without branching. WorkSphere resolves concurrent conflicts deterministically across all peers using a total-ordering hierarchy:
  $$\text{Causality (Vector Clock)} \;\succ\; \text{Hybrid Logical Clock (HLC)} \;\succ\; \text{Legacy Lamport Time} \;\succ\; \text{Lexicographical Node ID} \;\succ\; \text{Mutation ID}$$

```
┌─────────────────────────────────────────────────────────────┐
│                 Incoming Mutation Comparison                │
│                 compareMutations(mutA, mutB)                │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
        ┌──────────────────────────────────────────────┐
        │ 1. Vector Clock Comparison (Causality First) │
        │        vectorClockA.compareTo(clockB)        │
        └──────┬────────────────────────────────┬──────┘
               │                                │
        [Strict Causal Order]            [CONCURRENT / EQUAL]
               │                                │
      "AFTER"  │  "BEFORE"                      ▼
    ┌──────────┴──────────┐      ┌─────────────────────────────┐
    │  Causally newer     │      │ 2. Hybrid Logical Clock     │
    │  mutation wins      │      │    compareHLC(hlcA, hlcB)   │
    │  (Decided by        │      └──────────────┬──────────────┘
    │   causality)        │                     │
    └─────────────────────┘             [hlcA != hlcB]
                                                │
                                    ┌───────────┴───────────┐
                                    │ Larger HLC wins       │
                                    │ (physical time, then  │
                                    │  logical counter,     │
                                    │  then node ID)        │
                                    └───────────────────────┘
                                                │
                                         [HLC Unavailable]
                                                │
                                                ▼
                                 ┌─────────────────────────────┐
                                 │ 3. Legacy Lamport Timestamp │
                                 │    (lamportTsA vs lamportB) │
                                 └──────────────┬──────────────┘
                                                │
                                         [Equal lamportTs]
                                                │
                                                ▼
                                 ┌─────────────────────────────┐
                                 │ 4. Deterministic Tie-Break: │
                                 │    nodeId.localeCompare()   │
                                 │    id.localeCompare()       │
                                 └─────────────────────────────┘
```

---

## 2. Mathematical Foundations of Vector Clocks

A **Vector Clock** is a map of logical node identifiers to non-negative counters:

$$V = \{n_1: c_1, \; n_2: c_2, \; \dots, \; n_k: c_k\}$$

Where each entry represents the number of mutations generated by node $n_i$ that have been observed by the local node. Missing entries for any node are implicitly zero:

$$\forall n \notin \text{keys}(V), \quad V[n] = 0$$

### Strict Partial Order Definitions

For two vector clocks $A$ and $B$, the partial order relationships are defined over the union of all observed nodes $U = \text{keys}(A) \cup \text{keys}(B)$:

#### 1. Equal ($A = B$)
Both clocks reflect an identical causal history across all nodes:
$$A = B \iff \forall i \in U, \quad A[i] = B[i]$$

#### 2. Happens-Before / Strictly Ancestral ($A < B$ or "BEFORE")
Clock $A$ causally preceded clock $B$. Every event known to $A$ is known to $B$, and $B$ has observed at least one additional event:
$$A < B \iff (\forall i \in U, \; A[i] \le B[i]) \;\land\; (\exists j \in U, \; A[j] < B[j])$$

#### 3. Happens-After / Strictly Descendant ($A > B$ or "AFTER")
Clock $A$ causally dominates clock $B$. $A$ contains all events known to $B$ plus at least one new mutation:
$$A > B \iff (\forall i \in U, \; A[i] \ge B[i]) \;\land\; (\exists j \in U, \; A[j] > B[j])$$

#### 4. Concurrent ($A \parallel B$ or "CONCURRENT")
Neither clock causally precedes the other. Each clock has observed events that the other has not yet seen:
$$A \parallel B \iff (\exists i \in U, \; A[i] < B[i]) \;\land\; (\exists j \in U, \; A[j] > B[j])$$

> [!IMPORTANT]
> **Partial Order vs. Total Order:** Vector clocks establish a **strict partial order** ($\mathcal{P}$). While any two real numbers can be totally ordered ($x < y$ or $x \ge y$), two vector clocks can be mutually incomparable ($A \parallel B$). Concurrency does **not** mean the states are equal; it indicates that conflicting mutations were generated independently without coordination.

### Numerical Comparison Examples

| Case | Clock $A$ | Clock $B$ | Component Evaluations | Relation | Interpretation |
|---|---|---|---|---|---|
| **1. Identical** | `{"p1": 2, "p2": 4}` | `{"p1": 2, "p2": 4}` | $A[p1]=B[p1], A[p2]=B[p2]$ | `EQUAL` | Same causal state |
| **2. Ancestral** | `{"p1": 2, "p2": 3}` | `{"p1": 2, "p2": 5}` | $A[p1]=B[p1], A[p2]<B[p2]$ | `BEFORE` ($A < B$) | $A$ happened before $B$ |
| **3. Descendant** | `{"p1": 4, "p2": 2, "p3": 1}` | `{"p1": 2, "p2": 2}` | $A[p1]>B[p1], A[p2]=B[p2], A[p3]>B[p3]$ | `AFTER` ($A > B$) | $A$ happened after $B$ |
| **4. Concurrent** | `{"p1": 3, "p2": 1}` | `{"p1": 1, "p2": 4}` | $A[p1] > B[p1]$ but $A[p2] < B[p2]$ | `CONCURRENT` ($A \parallel B$) | Independent edits |
| **5. Asymmetric** | `{"p1": 2}` | `{"p2": 1}` | $A[p1] > B[p1]$ ($2 > 0$), $A[p2] < B[p2]$ ($0 < 1$) | `CONCURRENT` ($A \parallel B$) | Disconnected generation |

---

## 3. Vector Clock Algorithms

The production implementation in [`src/core/sync/VectorClock.ts`](../../src/core/sync/VectorClock.ts) manages internal state via a native JavaScript `Map<string, number>`.

### Algorithm 1: Vector Clock Initialization
```
Algorithm: InitializeVectorClock(nodeId, initialEntries)
Input: String nodeId, Map or Record initialEntries
Output: VectorClock instance

1. Assert nodeId is a non-empty string.
2. Initialize clockMap as an empty Map<string, number>.
3. For each (k, v) in initialEntries:
     Assert k is a non-empty string.
     Assert v is a non-negative safe integer.
     clockMap.set(k, v).
4. If clockMap does not contain nodeId:
     clockMap.set(nodeId, 0).
5. Return VectorClock instance.
```
- **Complexity:** Time $\mathcal{O}(K)$, Space $\mathcal{O}(K)$ where $K$ is the number of initial entries.

### Algorithm 2: Local Event Increment
When a node generates a local mutation, it advances its own logical counter:
$$V_{\text{local}}[n_{\text{local}}] \leftarrow V_{\text{local}}[n_{\text{local}}] + 1$$

```typescript
// Production reference: src/core/sync/VectorClock.ts
public increment(): ClockMap {
  this.clock.set(this.nodeId, (this.clock.get(this.nodeId) ?? 0) + 1);
  return this.getClock();
}
```
- **Complexity:** Time $\mathcal{O}(1)$, Space $\mathcal{O}(1)$.

### Algorithm 3: Clock Comparison (`compareTo`)
```
Algorithm: CompareVectorClocks(clockA, clockB)
Input: VectorClock A, VectorClockInput B
Output: Relation in {"BEFORE", "AFTER", "CONCURRENT", "EQUAL"}

1. Let otherMap = ReadEntries(clockB).
2. Let allNodes = Set(keys(clockA) U keys(otherMap)).
3. Let isLess = false, isGreater = false.
4. For each nodeId in allNodes:
     Let aVal = clockA.get(nodeId) ?? 0
     Let bVal = otherMap.get(nodeId) ?? 0
     If aVal < bVal: isLess = true
     If aVal > bVal: isGreater = true
     If isLess AND isGreater:
       Return "CONCURRENT"   // Early exit
5. If isLess: Return "BEFORE"
6. If isGreater: Return "AFTER"
7. Return "EQUAL"
```
- **Complexity:** Time $\mathcal{O}(|A \cup B|)$, Space $\mathcal{O}(|A \cup B|)$.

### Algorithm 4: Clock Merge (`merge`)
When receiving a remote state, the local clock takes the component-wise supremum (maximum) across all keys and increments its local node counter to record receipt:
$$V_{\text{merged}}[i] = \max(V_{\text{local}}[i], \; V_{\text{incoming}}[i]), \quad \forall i \in \text{keys}(V_{\text{local}}) \cup \text{keys}(V_{\text{incoming}})$$
$$V_{\text{merged}}[n_{\text{local}}] \leftarrow V_{\text{merged}}[n_{\text{local}}] + 1$$

```typescript
// Production reference: src/core/sync/VectorClock.ts
public merge(incomingClock: VectorClockInput): ClockMap {
  for (const [nodeId, incomingCounter] of readEntries(incomingClock, "Incoming vector clock")) {
    this.clock.set(
      nodeId,
      Math.max(this.clock.get(nodeId) ?? 0, incomingCounter),
    );
  }
  this.clock.set(this.nodeId, (this.clock.get(this.nodeId) ?? 0) + 1);
  return this.getClock();
}
```
- **Complexity:** Time $\mathcal{O}(|V_{\text{incoming}}|)$, Space $\mathcal{O}(|V_{\text{local}} \cup V_{\text{incoming}}|)$.

---

## 4. Lamport Timestamps & Hybrid Logical Clocks

### Scalar Lamport Clocks
A standard Lamport clock maintains a single monotonically increasing integer counter $L$.
- **Local event:** $L_{\text{local}} \leftarrow L_{\text{local}} + 1$
- **Message receipt:** $L_{\text{local}} \leftarrow \max(L_{\text{local}}, L_{\text{received}}) + 1$

**Fundamental Property:** If event $A$ causally precedes event $B$ ($A \to B$), then $L(A) < L(B)$. However, the converse does not hold: $L(A) < L(B)$ does **not** imply $A \to B$.

### Hybrid Logical Clock (HLC) Integration
To preserve causality while closely tracking physical wall-clock time without unbounded drift, WorkSphere implements a **Hybrid Logical Clock (HLC)** in [`src/core/sync/HybridLogicalClock.ts`](../../src/core/sync/HybridLogicalClock.ts).

An HLC timestamp tuple is structured as:
$$\text{HLC} = (pt, \; lc, \; \text{nodeId})$$
- $pt$ (physical time): Maximum physical epoch time in milliseconds observed so far.
- $lc$ (logical counter): Incremented when multiple events share the exact same physical millisecond.
- $\text{nodeId}$: Unique deterministic string tie-breaker.

#### HLC Comparison Algorithm
```typescript
export function compareHLC(a: HLCState, b: HLCState): number {
  if (a.pt !== b.pt) return a.pt < b.pt ? -1 : 1;
  if (a.lc !== b.lc) return a.lc < b.lc ? -1 : 1;
  if (a.nodeId === b.nodeId) return 0;
  return a.nodeId < b.nodeId ? -1 : 1;
}
```

---

## 5. Deterministic Conflict Resolution & Tie-Breaking

When two mutations to the same entity arrive concurrently ($A \parallel B$), the system must select a single deterministic winner without human intervention.

### Resolver Precedence Hierarchy

In [`src/core/sync/LamportTimestampResolver.ts`](../../src/core/sync/LamportTimestampResolver.ts), the comparator `compareMutations` executes the following evaluation pipeline:

```typescript
function compareMutations<T>(
  mutationA: MutationPayload<T>,
  mutationB: MutationPayload<T>,
): number {
  // 1. Causal ancestry always wins over wall-clock or logical stamps
  const causalOrder = new VectorClock(
    mutationA.nodeId,
    mutationA.clock,
  ).compareTo(mutationB.clock);

  if (causalOrder === "AFTER") return 1;    // Mutation A is newer
  if (causalOrder === "BEFORE") return -1;  // Mutation B is newer

  // 2. For concurrent or identical vectors: compare Hybrid Logical Clocks
  if (mutationA.hlc && mutationB.hlc) {
    const hlcOrder = compareHLC(mutationA.hlc, mutationB.hlc);
    if (hlcOrder !== 0) return hlcOrder;
  }

  // 3. Fallback for legacy mutations without HLC stamps
  if (mutationA.lamportTs !== mutationB.lamportTs) {
    return mutationA.lamportTs < mutationB.lamportTs ? -1 : 1;
  }

  // 4. Deterministic node ID lexicographical ordering
  const nodeOrder = mutationA.nodeId.localeCompare(mutationB.nodeId);
  if (nodeOrder !== 0) return nodeOrder;

  // 5. Ultimate tie-break: unique mutation ID
  return mutationA.id.localeCompare(mutationB.id);
}
```

### Analysis of Tie-Breaking Heuristics

1. **Causality Dominance:** If Mutation $B$ incorporates Mutation $A$'s clock (`$A < B$`), Mutation $B$ **always wins**, even if Mutation $A$ had a higher physical or HLC timestamp due to local clock skew.
2. **Node ID Lexicographical Tie-Breaking:** If two concurrent mutations share the exact same physical time ($pt$) and logical counter ($lc$), the node identifier with the higher lexicographical value wins (`localeCompare`).
3. **State Hash Inspection:**
   > [!NOTE]
   > While the GitHub issue suggests SHA-256 state hashing for tie-breaking, **inspection of `LamportTimestampResolver.ts` confirms that SHA-256 state hashes are NOT evaluated in the conflict comparator.**
   > State hashing in WorkSphere is implemented separately for CRDT integrity checks (`DeltaCRDTLog.computeStateHash()`) and fraud proofs (`VerifiableRollupFraudBisectionProver.ts`). The resolver relies strictly on the tuple:
   > $$T = (\text{VectorClock}, \; \text{HLC.pt}, \; \text{HLC.lc}, \; \text{nodeId}, \; \text{mutationId})$$

### Concrete Conflict Resolution Scenarios

#### Scenario 1: Causally Newer Overrides Higher Physical Stamp
- Mutation A: `clock = {"peer-a": 2}`, `HLC.pt = 900`
- Mutation B: `clock = {"peer-a": 2, "peer-b": 1}`, `HLC.pt = 100`
- **Result:** Mutation B wins. Vector clock comparison returns `BEFORE` ($A < B$). Causal ancestry dominates physical clock inversion.

#### Scenario 2: Concurrent Edits Resolved by HLC
- Mutation A: `clock = {"peer-a": 1}`, `HLC.pt = 1000`, `nodeId = "peer-a"`
- Mutation B: `clock = {"peer-b": 1}`, `HLC.pt = 2000`, `nodeId = "peer-b"`
- **Result:** Mutation B wins. Vector clocks are `CONCURRENT` ($A \parallel B$). `compareHLC` evaluates physical time ($2000 > 1000$).

#### Scenario 3: Identical Timestamps Resolved by Node ID
- Mutation A: `clock = {"peer-a": 1}`, `HLC.pt = 1500`, `HLC.lc = 0`, `nodeId = "node-alpha"`
- Mutation B: `clock = {"peer-b": 1}`, `HLC.pt = 1500`, `HLC.lc = 0`, `nodeId = "node-beta"`
- **Result:** Mutation B wins (`"node-beta".localeCompare("node-alpha") > 0`).

---

## 6. Concurrent Mutation Reconciliation Case Studies

### Case Study A: Sequential Updates (No Conflict)
1. **Initial State:** Note `"note-1" = "Hello"`, `clock = {"p1": 1}`.
2. Peer 1 updates to `"Hello World"`. `clock = {"p1": 2}`.
3. Peer 1 syncs with Peer 2. Peer 2 updates to `"Hello World!"`. `clock = {"p1": 2, "p2": 1}`.
4. **Outcome:** Causally ordered ($A < B$). Peer 2's mutation applied cleanly without tie-breaking.

### Case Study B: Concurrent Disconnected Edits (2 Peers)
1. **Baseline State:** Note `"note-1" = "Draft"`, `clock = {"p1": 1, "p2": 1}`.
2. **Partition:** Peer 1 and Peer 2 disconnect.
   - Peer 1 changes text to `"Draft (Revised by P1)"`. `clock = {"p1": 2, "p2": 1}`, `HLC = (1716380000, 0, "p1")`.
   - Peer 2 changes text to `"Draft (Final by P2)"`. `clock = {"p1": 1, "p2": 2}`, `HLC = (1716380050, 0, "p2")`.
3. **Reconnection & Replay:**
   - Vector clock comparison evaluates `{"p1": 2, "p2": 1}` vs. `{"p1": 1, "p2": 2}` $\to$ **`CONCURRENT`**.
   - HLC comparison checks physical time: $1716380050 > 1716380000$.
   - **Winner:** Peer 2's mutation wins deterministically across all nodes.
   - **Merged Vector Clock:** `{"p1": 2, "p2": 2, "server": 1}`.

### Case Study C: Multi-Peer Partition (3 Peers)
1. Baseline: Note `"title" = "Project"`, `clock = {"p1": 1}`.
2. Three-way partition:
   - Peer 1 sets `"title" = "Project Alpha"`, `clock = {"p1": 2}`, `HLC.pt = 500`.
   - Peer 2 sets `"title" = "Project Beta"`, `clock = {"p1": 1, "p2": 1}`, `HLC.pt = 600`.
   - Peer 3 sets `"title" = "Project Gamma"`, `clock = {"p1": 1, "p3": 1}`, `HLC.pt = 600`.
3. Reconnection:
   - $P1$ vs $P2$: Concurrent $\to P2$ wins ($600 > 500$).
   - $P2$ vs $P3$: Concurrent, physical times identical ($600 = 600$).
   - Node ID tie-break: `"p3".localeCompare("p2") > 0` $\to P3$ wins.
4. **Final Converged State:** `"Project Gamma"` on all three peers.

---

## 7. Vector Clock Compaction & Stability Horizons

In collaborative sessions with frequent peer turnover (users joining, disconnecting, and leaving cafe workspaces), the size of the clock vector map grows unboundedly:

$$\mathcal{O}(N) \quad \text{where } N \text{ is total historical participants}$$

### Stability Horizon Implementation
In [`src/core/sync/CausalVectorClockEngine.ts`](../../src/core/sync/CausalVectorClockEngine.ts), WorkSphere implements **Stability Horizon Matrix Clock Pruning**:

```typescript
export class CausalVectorClockEngine<TPayload = unknown> {
  private localClock: VectorClockMap = {};
  private activePeers: Set<string> = new Set();
  // Matrix clock: peerClocks[i][j] = what node knows that node i knows about node j
  private peerClocks: Map<string, VectorClockMap> = new Map();

  public computeStabilityHorizon(): StabilityHorizon {
    const allNodes = Object.keys(this.localClock);
    const horizonClock: VectorClockMap = {};

    for (const node of allNodes) {
      let minVal = Infinity;
      for (const peer of this.activePeers) {
        const peerClock = this.peerClocks.get(peer);
        const val = peerClock ? peerClock[node] || 0 : 0;
        if (val < minVal) {
          minVal = val;
        }
      }
      horizonClock[node] = minVal === Infinity ? 0 : minVal;
    }

    return { horizonClock, lastUpdated: Date.now() };
  }

  public removePeer(peerId: string): void {
    if (peerId === this.nodeId) return;
    this.activePeers.delete(peerId);
    this.peerClocks.delete(peerId);
  }
}
```

### Compaction Safety Invariant
An entry $V[n] = k$ is **safe to prune** if and only if it has crossed the stability horizon:

$$\forall p \in \text{ActivePeers}, \quad \text{peerClock}_p[n] \ge k$$

If an entry is pruned prematurely while an inactive peer is still disconnected, the system risks **causal amnesia**: when the peer reconnects, its historical counter (e.g. 5) will be compared against a pruned clock (0), incorrectly classifying obsolete operations as new mutations.

---

## 8. Network Partition Recovery Case Studies

### Partition Topology Analysis

```
       [Before Partition]                   [During Partition]                  [After Reconnection]
┌───────────────────────────────┐   ┌───────────────────────────────┐   ┌───────────────────────────────┐
│  Peer A       ⇄       Peer B  │   │  Peer A               Peer B  │   │  Peer A       ⇄       Peer B  │
│ {"A": 1}              {"A": 1}│   │ {"A": 2}              {"B": 1}│   │ {"A": 2, "B": 1} {"A": 2, "B": 1}│
└───────────────────────────────┘   └───────────────────────────────┘   └───────────────────────────────┘
```

#### Delayed and Duplicated Updates
Because WebRTC and IndexedDB sync queues are subject to at-least-once delivery:
1. When duplicate mutations arrive with identical IDs (`mutationA.id === mutationB.id`), `compareMutations` returns `0`.
2. `replayMutations()` treats duplicate mutations as idempotent no-ops because the existing state in `winningMutations` already reflects the mutation's key and clock vector.

---

## 9. Consistency Guarantees & Formal Proof

### Theoretical Model: Strong Eventual Consistency (SEC)
WorkSphere achieves **Strong Eventual Consistency (SEC)** under the following formal assumptions:

#### Assumptions:
1. **At-Least-Once Delivery:** All generated mutations eventually reach all non-faulty replicas via WebRTC mesh flooding, PartyKit relay, or IndexedDB offline sync reconciliation.
2. **Deterministic Total Ordering:** The comparator function `compareMutations` induces a strict, anti-symmetric, transitive total order over concurrent mutation tuples:
   $$\forall X, Y \in \mathcal{M}, \quad X \neq Y \implies (X \prec Y) \oplus (Y \prec X)$$
3. **Monotonic Clock Evolution:** `VectorClock.merge` computes the mathematical join (least upper bound $\sqcup$) on a bounded semi-lattice:
   $$V_1 \sqcup V_2 = (\max(V_1[i], V_2[i]))_{i \in U}$$

#### Mathematical Theorem: Replica Convergence
> **Theorem:** Let $\mathcal{R}_A$ and $\mathcal{R}_B$ be two independent replicas that have observed the exact same set of mutations $\mathcal{M} = \{m_1, m_2, \dots, m_k\}$, potentially received in different permutations $\pi_A$ and $\pi_B$. Under `LamportTimestampResolver.replayMutations`, the resolved state of both replicas is identical:
> $$\text{State}(\mathcal{R}_A) = \text{State}(\mathcal{R}_B)$$

#### Proof Sketch:
1. `replayMutations` sorts all incoming mutations using `compareMutations`.
2. Because `compareMutations` relies exclusively on immutable payload attributes (`VectorClock`, `HLCState`, `nodeId`, `id`) and does not depend on local arrival order or local system time, the sorted order of mutations is invariant under any arrival permutation:
   $$\text{sort}(\pi_A(\mathcal{M})) = \text{sort}(\pi_B(\mathcal{M})) = [m_{(1)}, m_{(2)}, \dots, m_{(k)}]$$
3. State mutation application iterates deterministically through this canonically sorted list.
4. For each entity $E$, the resolved winner is the maximum element under $\prec$:
   $$\text{Winner}(E) = \max_{\prec} \{m \in \mathcal{M} \mid m.\text{entityId} = E\}$$
5. Hence, both replicas converge to the exact same value for all entities. $\blacksquare$

---

## 10. Complexity Analysis

| Operation | Implementation Function | Time Complexity | Space Complexity | Complexity Justification |
|---|---|---|---|---|
| **Local Increment** | `VectorClock.increment()` | $\mathcal{O}(1)$ | $\mathcal{O}(1)$ | Hash map key lookup and integer addition |
| **Vector Clock Comparison** | `VectorClock.compareTo()` | $\mathcal{O}(|A \cup B|)$ | $\mathcal{O}(|A \cup B|)$ | Set union of node keys and single loop comparison |
| **Vector Clock Merge** | `VectorClock.merge()` | $\mathcal{O}(|B|)$ | $\mathcal{O}(|A \cup B|)$ | Iterates over incoming clock entries; updates local Map |
| **HLC Comparison** | `compareHLC()` | $\mathcal{O}(1)$ | $\mathcal{O}(1)$ | Three numeric comparisons and one string compare |
| **Conflict Resolution** | `resolveConflict()` | $\mathcal{O}(|A \cup B|)$ | $\mathcal{O}(|A \cup B|)$ | Dominated by VectorClock comparison |
| **Mutation Batch Replay** | `replayMutations(M)` | $\mathcal{O}(M \log M \cdot K)$ | $\mathcal{O}(M \cdot K)$ | Sorting $M$ mutations where each comparison costs $\mathcal{O}(K)$ |
| **Stability Horizon** | `computeStabilityHorizon()` | $\mathcal{O}(N \cdot P)$ | $\mathcal{O}(N)$ | $N$ nodes evaluated across $P$ active peers |

*$K = |A \cup B|$ is the number of distinct node IDs in the vector clocks; $M$ is the number of mutations in the sync queue.*

---

## 11. Troubleshooting & Diagnostics

| Diagnostic Symptom | Probable Cause | Source File & Function | Diagnostic & Resolution Step |
|---|---|---|---|
| **Mutation overwritten by an older edit** | Local system physical clock stepped backward; node lacked vector clock context | `LamportTimestampResolver.ts` (`compareMutations`) | Verify that the mutation payload includes `clock` and `hlc`. Check if `VectorClock.compareTo()` was bypassed. |
| **Unbounded Vector Clock growth** | High peer churn without stability horizon pruning | `CausalVectorClockEngine.ts` (`computeStabilityHorizon`) | Check `engine.getActivePeers()`. Call `engine.removePeer(peerId)` when peers permanently leave the room. |
| **Replicas fail to converge after reconnection** | Partial mutation drops or unhandled network exceptions | `stateSyncWorker.ts` / `OfflineMutationQueue.ts` | Verify sync response status. Inspect `OfflineMutationQueue` for failed mutations in the IndexedDB dead-letter queue. |
| **`TypeError: clock must be a clock map or record`** | Malformed JSON deserialization of clock payload | `VectorClock.ts` (`readEntries`) | Ensure `clock` is an `Object` or `Map`, not an array or string. Inspect serialized WebSocket frames. |
| **Stale deleted items reappearing** | Premature tombstone compaction before all offline peers synced | `src/lib/offline/tombstoneCompactor.ts` | Check tombstone retention policy. Ensure tombstones persist for at least 30 days (`maxAgeMs: 30 * 86400000`). |

---

## 12. References

- [Vector Clock Core Implementation (`src/core/sync/VectorClock.ts`)](../../src/core/sync/VectorClock.ts)
- [Lamport Timestamp Resolver (`src/core/sync/LamportTimestampResolver.ts`)](../../src/core/sync/LamportTimestampResolver.ts)
- [Hybrid Logical Clock (`src/core/sync/HybridLogicalClock.ts`)](../../src/core/sync/HybridLogicalClock.ts)
- [Causal Vector Clock Engine (`src/core/sync/CausalVectorClockEngine.ts`)](../../src/core/sync/CausalVectorClockEngine.ts)
- [Resolver Test Suite (`src/core/sync/__tests__/LamportTimestampResolver.test.ts`)](../../src/core/sync/__tests__/LamportTimestampResolver.test.ts)
- [Offline Mutation Queue (`src/core/sync/OfflineMutationQueue.ts`)](../../src/core/sync/OfflineMutationQueue.ts)
- [Collaborative Sync Guide (`docs/COLLABORATIVE_SYNC.md`)](../COLLABORATIVE_SYNC.md)
- [Vector Clock Specification (`docs/architecture/VECTOR_CLOCK_SPEC.md`)](VECTOR_CLOCK_SPEC.md)
