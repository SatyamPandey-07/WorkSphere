# Vector Clock and Causal Ordering Specification

## 1. Overview

WorkSphere uses logical time to coordinate operations that may arrive from
different browser tabs, offline queues, WebRTC peers, PartyKit rooms, or server
components. Wall-clock timestamps are useful for presentation and domain
policy, but they do not prove whether one edit was caused by another.

The repository implements several related mechanisms:

- Vector clocks represent the per-node event frontier for a state or operation.
- A vector is used for happens-before analysis, concurrent-edit detection,
  dependency buffering, and deterministic conflict resolution.
- Hybrid Logical Clocks (HLC) combine a physical-time maximum, a logical
  counter, and a node identifier for stable tie-breaking under clock skew.
- Lamport timestamp logic provides a scalar total-tick fallback and, in the
  legacy CRDT implementation, a tie-break for concurrent vectors.
- Yjs provides the logical clock and conflict model for the canvas
  collaboration implementation.

These mechanisms are not interchangeable. Vector clocks provide causal
information; HLC stamps provide monotonic ordering and a deterministic tie
break; Lamport-style scalar sums do not by themselves prove concurrency or
causal ancestry.

This document describes:

1. Implemented WorkSphere behavior.
2. Standard distributed-systems concepts used to explain that behavior.
3. Illustrative pseudocode and recommendations that are not yet implemented.

## 2. Distributed Ordering Fundamentals

### 2.1 Lamport logical clocks

A Lamport clock advances on local events and on receipt of remote events:

$$
L_{\text{local}} =
\begin{cases}
L_{\text{local}} + 1 & \text{local event} \\
\max(L_{\text{local}}, L_{\text{remote}}) + 1 & \text{receive event}
\end{cases}
$$

Lamport clocks are easy to store and transmit. If event $A$ happens before
event $B$, then $L(A) < L(B)$.

Lamport clocks do not independently reveal whether two events were concurrent.
For example, $L(A)=7$ and $L(B)=7$ only establishes that neither scalar value
is larger. The operations could be independent or could have arrived through
different histories.

WorkSphere uses Lamport ordering primarily as a fallback:

- `CrdtVectorClock.getLamportTime()` sums all components of a vector clock.
- `CrdtVectorClock.compare()` uses the sum only after the component-wise
  vector comparison identifies a concurrent partial order.
- `LamportTimestampResolver` falls back to `lamportTs`, then node ID, then
  mutation ID only for legacy mutations that do not carry an HLC stamp.

The sum is a scalar diagnostic and tie-break, not a vector causal proof.

### 2.2 Vector clocks

A vector clock is a map of logical-node identifiers to non-negative counters:

$$
V = \{n_1:c_1,\ n_2:c_2,\ldots,n_k:c_k\}
$$

Before a local mutation, node $n$ increments its own component:

$$
V[n] := V[n] + 1
$$

Component-wise comparison treats missing components as zero. For clocks $A$
and $B$:

$$
A \le B \iff \forall k:\ A[k] \le B[k]
$$

The strict relationships are:

$$
A < B \iff A \le B \land \exists k:\ A[k] < B[k]
$$

and:

$$
A \parallel B \iff
\exists i:\ A[i] < B[i]
\land
\exists j:\ A[j] > B[j]
$$

A merged clock is the component-wise maximum:

$$
(A \sqcup B)[k] = \max(A[k],B[k])
$$

WorkSphere's reception code commonly advances the local receive counter after
merging a remote state. That makes the result a receipt frontier, not merely
the maximum of the remote and local histories.

### 2.3 Hybrid Logical Clocks

WorkSphere has two HLC representations:

| Implementation           | Fields                             | Location                              |
| ------------------------ | ---------------------------------- | ------------------------------------- |
| Core synchronization HLC | `{ pt, lc, nodeId }`               | `src/core/sync/HybridLogicalClock.ts` |
| Local-mesh HLC           | `{ logicalTime, counter, nodeId }` | `src/party/localMesh.room.ts`         |

Both represent a maximum physical wall-clock value plus a logical counter. The
core implementation uses `pt` and `lc`; the PartyKit room uses
`logicalTime` and `counter`.

On a local tick, a core HLC keeps the same physical value and increments `lc`
if the physical clock does not advance:

$$
\text{pt}'=\max(\text{pt},\text{physicalNow})
$$

$$
\text{lc}'=
\begin{cases}
\text{lc}+1 & \text{pt}'=\text{pt}\\
0 & \text{otherwise}
\end{cases}
$$

On receive, `pt` becomes the maximum of the local physical value, local HLC,
and remote HLC. The logical counter increases according to whether physical
time, local HLC, or remote HLC supplied the maximum. This lets an HLC remain
monotonic even if the wall clock is stagnant or moves backward.

HLC does not eliminate physical clock skew and does not prove causal ancestry.
It supplies an ordering key and is used only as a tie-break by modules that
first inspect vector-clock causality.

## 3. Clock Comparison

| Property                 | Lamport scalar                                                     | Vector clock                           | HLC                                             |
| ------------------------ | ------------------------------------------------------------------ | -------------------------------------- | ----------------------------------------------- |
| Representation           | Single integer                                                     | Map of node to counter                 | Physical component + logical counter + node ID  |
| Detects strict causality | Partial: larger value is compatible with later but cannot prove it | Yes                                    | Only for the HLC order key, not full provenance |
| Detects concurrency      | No                                                                 | Yes                                    | No                                              |
| Physical-time awareness  | No                                                                 | No                                     | Yes, by physical component                      |
| Storage overhead         | Constant                                                           | $O(n)$ for known nodes                 | Constant                                        |
| Metadata overhead        | Constant                                                           | Grows with node count                  | Constant                                        |
| Clock-skew behavior      | Logical ticks only                                                 | Independent of wall-clock drift        | Contains physical max and logical counter       |
| Appropriate use          | Scalar fallback/order key                                          | Causal delivery and conflict detection | Monotonic cross-node tie-breaking               |

## 4. Mathematical Model

### 4.1 Three-node example

Consider three nodes: A, B, and C.

The initial state is:

$$
V_0=\{A:0,B:0,C:0\}
$$

A local event on A produces:

$$
A_1=\{A:1,B:0,C:0\}
$$

A receives $A_1$, merges it, and advances local receive state:

$$
\{A:1,B:0,C:0\}\sqcup\{A:1,B:0,C:0\}
$$

then, for implementations that use receive increment, its next local A
component becomes $2$.

If B independently creates $B_1$ before receiving A, B has:

$$
B_1=\{A:0,B:1,C:0\}
$$

The clocks are concurrent:

$$
A_1 \parallel B_1
$$

because $A_1[A] > B_1[A]$ while $B_1[B] > A_1[B]$.

A C-node that receives B first with a vector containing A=1 and B=1 must wait
for A=1 from A before delivery. WorkSphere's
`CausalVectorClockEngine.canDeliver()` implements this condition.

### 4.2 HLC update example

If the core HLC state is $\{pt:2000,lc:0,nodeId:A\}$ and local physical time
is $1500$, `tick()` keeps $pt=2000$ and advances $lc$ to $1$ or, on a later
tick, to $2$. This preserves monotonicity.

If a remote stamp is $\{pt:5000,lc:3,nodeId:B\}$ and a peer observes physical
time $1100$, its receive update uses $pt=5000$ and $lc=4$ in the core HLC
implementation. A stale stamp below the resulting HLC is rejected by
`shouldApplyUpdate()`.

## 5. WorkSphere Synchronization Lifecycle

### 5.1 Implemented local CRDT lifecycle

`CrdtDocument.applyLocalOperation()` performs the following:

1. Copies the document state and creates `CrdtVectorClock`.
2. Increments the local node counter.
3. Adds or updates the operation in `elements`.
4. Merges the operation clock into document state.
5. Records the operation for undo, redo, replay, and duplicate detection.
6. Adds parent/dependency metadata for local operations.

`CrdtOperation` carries:

```typescript
interface CrdtOperation {
  id: string;
  type: "DRAW_STROKE" | "ADD_TEXT" | "UPDATE_TEXT" | "DELETE_ELEMENT";
  nodeId: string;
  timestamp: number;
  vectorClock: Record<string, number>;
  payload: Record<string, unknown>;
  parentOpId?: string;
  dependencies?: Record<string, number>;
  hopCount?: number;
  relayedBy?: string[];
}
```

### 5.2 Remote reception

`CrdtDocument.mergeRemoteOperation()`:

1. Checks whether the parent operation is available.
2. Checks transitive `dependencies`.
3. Buffers the operation if its dependencies are missing.
4. Replays buffered operations when their prerequisites arrive.
5. Compares the incoming and existing clocks for the same operation ID.
6. Rejects older, duplicate, or lexicographically losing operations.
7. Merges the incoming and dependency clocks into document state.
8. Records and rebroadcasts the canonical operation.

This is implemented buffering, duplicate rejection, and replay, not merely a
theoretical lifecycle.

### 5.3 Causal message delivery

`CausalVectorClockEngine` implements an independent in-memory causal message
engine:

- `createLocalEvent()` increments its local counter.
- `receive()` adds incoming messages to a buffer.
- `canDeliver()` checks immediate sender sequence and all remote dependencies.
- `applyDelivery()` advances the local clock and peer knowledge.
- `getBufferedMessages()` exposes pending messages.
- `computeStabilityHorizon()` calculates the component-wise minimum across
  active peers.

The same ID may be delivered only if the sender's next counter equals
`localClock[sender] + 1`, and no foreign component exceeds the local frontier.

### 5.4 Offline booking replay

`DraftStore` stores booking drafts in IndexedDB and advances the local node
component in `updateDraftPayload()`.

`LamportTimestampResolver.replayMutations()`:

1. Merges every mutation clock into a replay clock.
2. Sorts mutations by causal/HLC/Lamport/node/ID order.
3. Selects a winning mutation per entity.
4. Returns replayed state and the merged vector clock.

The `ConflictResolver` normalizes missing clocks, detects strict dominance,
concurrency, and equality, and then applies domain policy.

## 6. Concurrent Editing and Partition Recovery

```mermaid
sequenceDiagram
    autonumber
    participant A as Node A
    participant Net as Network
    participant B as Node B
    participant C as Node C

    Note over A,B,C: Shared causal frontier V = {A:1,B:0,C:0}
    A->>A: Partition: local edit A1
    A->>A: Increment A clock
    B->>B: Partition: local edit B1
    B->>B: Increment B clock

    Note over A: State contains {A:2,B:0,C:0}
    Note over B: State contains {A:1,B:1,C:0}
    A-->>Net: A1 unavailable
    B-->>Net: B1 unavailable

    Net->>C: Partition heals
    C->>C: Request state and pending operations
    C-->>A: Exchange clocks and operations
    C-->>B: Exchange clocks and operations

    A->>C: Send A1 and vector {A:2,B:0,C:0}
    B->>C: Send B1 and vector {A:1,B:1,C:0}
    C->>C: Compare vectors: CONCURRENT
    C->>C: Buffer or replay missing dependencies
    C->>C: Apply documented merge/CRDT conflict policy
    C-->>A: Propagate converged state
    C-->>B: Propagate converged state
    A->>A: Merge converged frontier
    B->>B: Merge converged frontier

    Note over A,B,C: State vectors converge; no partition-only winner
```

No single diagram stage should be interpreted as a guarantee that every
WorkSphere transport carries this exact replay protocol. The diagram combines
the implemented CRDT buffering and the general partition-recovery lifecycle.

The PartyKit local-mesh room also sends `SYNC_REQUEST` and `SYNC_RESPONSE`
messages and maintains an update log of at most 1000 entries.

## 7. Network Partitions

### 7.1 Temporary disconnection

WorkSphere supports disconnected local operation in several modules:

- `CrdtDocument.pendingOperations` buffers remote operations.
- `CrdtDocument.isOperationCausallyReady()` verifies parent and transitive
  dependencies.
- `CausalVectorClockEngine.bufferedQueue` buffers out-of-order causal messages.
- `DraftStore` persists booking drafts in IndexedDB.
- `LocalMeshRoom.updateLog` retains recent reconciliation updates.

During a partition:

1. Each node continues incrementing local counters.
2. Independent branches become concurrent in vector space.
3. Operations remain available for later replay.
4. Conflicting application values require a domain merge policy.

### 7.2 Reconnection

On recovery, a node should exchange clocks and operations or request a sync
response. `CrdtDocument.replayPendingOperations()` is an implemented example:

```typescript
// Illustrative use of the verified API
const replayed = document.replayPendingOperations();
const state = document.getState();
```

The following pseudocode illustrates a transport sequence but is not a complete
verified WorkSphere API:

```text
onReconnect(peer):
  localClock = localState.vectorClock
  exchange state vectors
  send operations where operation.clock has unknown/unacknowledged components
  receive remote operations
  buffer operations with missing dependencies
  replay ready operations
  merge state and frontier
  rebroadcast the canonical result
```

### 7.3 Duplicate and stale delivery

The CRDT document checks operation IDs and author ticks before duplicate
delivery. `CausalVectorClockEngine.receive()` ignores sender counters below the
expected next counter. The local-mesh room carries an update log and can return
missed entries from a HLC or timestamp request.

An idempotency ledger for every room transport is not universally implemented.
Callers must inspect the feature-specific store and protocol rather than assume
an application-wide duplicate ledger.

## 8. Clock Skew Handling

### 8.1 Core HLC

`src/core/sync/HybridLogicalClock.ts`:

- Keeps `pt` at the maximum of prior, physical, and remote physical values.
- Uses `lc` to advance beyond a stagnant physical clock.
- Serializes as `pt:lc:nodeId`.
- `parseHLC()` validates numeric fields and a non-empty node ID.
- `compareHLC()` compares `pt`, then `lc`, then node ID.
- `shouldApplyUpdate()` rejects an incoming HLC that does not advance the
  current applied stamp.

### 8.2 Local-mesh HLC

`src/party/localMesh.room.ts` uses `logicalTime`, `counter`, and `nodeId`.
`now()` advances by wall-clock maximum and logical counter. `update()` merges
local, remote, and physical values.

The room also has a keyed state map. Incoming keyed updates are accepted only
when their HLC is greater than or equal to the stored keyed HLC. This mitigates
wall-clock drift for that reconciliation path.

### 8.3 Practical skew example

Suppose Node A has physical time `1000` and Node B has physical time `5000`.
Node B's HLC is allowed to pull A's received stamp forward past `5000`; A will
not rewind on a later local call to `1100`. The logical counter distinguishes
events that occur after the remote maximum.

This is monotonic recovery, not a guarantee that all physical clocks are
correct or that a wrong clock has a trustworthy wall-time position.

## 9. Conflict Resolution Strategies

### 9.1 Causally ordered updates

The new core `VectorClock` API gives strict causality precedence:

- `AFTER` selects local.
- `BEFORE` selects remote.
- HLC is consulted only for `CONCURRENT` or `EQUAL`.

`LamportTimestampResolver` follows the same hierarchy:

1. Vector causality.
2. HLC stamp for concurrent/equal vectors.
3. Legacy `lamportTs`.
4. Node ID.
5. Mutation ID.

### 9.2 CRDT document operations

`CrdtDocument` currently combines:

- Vector/parent/dependency readiness.
- Operation-ID duplicate handling.
- Lamport sum tie-breaking for the legacy `CrdtVectorClock.compare()`.
- Node-ID and timestamp tie-breaking for concurrent/equal operations.
- Deterministic replay of causal children.

The implementation comment describes the state tree as LWW; it keeps
element operations in a map, and a winning operation replaces the same element
ID according to the implemented comparison.

### 9.3 Booking conflict resolver

The booking resolver implements field-aware domain policy:

- Cancelled server status prevents offline resurrection.
- Offline cancellation can propagate a cancellation tombstone.
- Critical fields such as status, venue, user, schedule, and seats remain
  server-authoritative.
- Additive fields use set union.
- Other divergent fields use timestamp/Lamport/node ID last-write-wins.
- The resolved vector is the pairwise maximum, optionally incremented for the
  resolver node.
- Critical conflicts set `requiresUserInput=true`.

This is deterministic merge logic for the booking domain, not a generic
application-wide CRDT merge.

### 9.4 PartyKit local-mesh state

The local-mesh room uses:

- HLC ordering for keyed state.
- Incoming update rebroadcast for `SYNC_UPDATE`.
- HLC or timestamp filtering for `SYNC_REQUEST`.
- An update log retained for the most recent 1000 entries.

The actual keyed reconciliation is a last-writer-wins register. It does not
preserve concurrent values automatically; preserving concurrent information
would require a separate application-specific representation.

## 10. Data Structures and API Reference

### 10.1 Core vector clock

```typescript
export type ClockMap = Record<string, number>;
export type VectorClockInput = ClockMap | ReadonlyMap<string, number>;
export type VectorClockRelation = "BEFORE" | "AFTER" | "CONCURRENT" | "EQUAL";
```

Relevant methods in `src/core/sync/VectorClock.ts` include:

- `new VectorClock(nodeId, initialClock)`
- `increment(): ClockMap`
- `merge(incomingClock): ClockMap`
- `compareTo(otherClock): VectorClockRelation`
- `isConcurrentWith(otherClock): boolean`
- `descendsFrom(ancestorClock): boolean`
- `compareWithHLC(...): VectorClockMergeDecision`
- `getClock(): ClockMap`

The implementation validates non-empty node IDs and non-negative safe integer
counter values.

### 10.2 Core HLC

```typescript
export interface HLCState {
  pt: number;
  lc: number;
  nodeId: string;
}
```

In `src/core/sync/HybridLogicalClock.ts`:

- `tick(physicalNowMs?)`
- `receive(remote, physicalNowMs?)`
- `shouldApplyUpdate(incoming, currentApplied)`
- `now()`
- `serializeHLC(state)`
- `parseHLC(encoded)`

The serialization format is `pt:lc:nodeId`.

### 10.3 Legacy CRDT clock

```typescript
export type VectorClock = Record<string, number>;
```

`CrdtVectorClock` in `src/core/crdt/CrdtVectorClock.ts` provides:

- `increment(nodeId)`
- `merge(otherClock)`
- `compare(otherClock)`
- `getLamportTime()`
- `CrdtVectorClock.getLamportTime(clock)`
- `CrdtVectorClock.serialize(clock)`
- `CrdtVectorClock.deserialize(serialized)`

Serialization is JSON object text. `deserialize()` currently returns `{}` for
invalid JSON.

### 10.4 Causal message engine

```typescript
export type CausalOrder =
  "HAPPENED_BEFORE" | "HAPPENED_AFTER" | "CONCURRENT" | "IDENTICAL";

export interface CausalMessage<TPayload = unknown> {
  id: string;
  senderId: string;
  vectorClock: Record<string, number>;
  payload: TPayload;
  timestamp: number;
}
```

`CausalVectorClockEngine<T>` provides static `compare()` and `merge()`, local
event creation, receive/buffer delivery, callbacks, peer tracking, stability
horizon calculation, and peer removal.

## 11. Complexity and Performance

For $n$ known logical nodes and a clock containing $k$ components:

| Operation            | Complexity                                                        |
| -------------------- | ----------------------------------------------------------------- |
| Increment            | $O(1)$ for a known node; snapshot copying is $O(k)$               |
| Snapshot             | $O(k)$                                                            |
| Component compare    | $O(k)$                                                            |
| Component merge      | $O(k_A+k_B)$                                                      |
| Causal receive check | $O(k)$                                                            |
| Causal queue cascade | $O(mn)$ in a queue scan in the worst case for $m$ pending entries |
| Stability horizon    | $O(n_p n_c)$ across peer count and known clock components         |

Vector metadata grows with the number of nodes that contribute to the state.
Avoiding unbounded node growth requires explicit peer eviction or snapshot
frontiers. WorkSphere's stability-horizon API can support pruning after a
caller proves all active peers have acknowledged a frontier.

HLC serialization and Lamport scalar fallback remain constant or nearly
constant in node count. They do not replace vector clocks when concurrency
must be detected.

## 12. Failure Scenarios and Edge Cases

| Scenario                                | Implemented behavior or existing protection                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| Missing parent operation                | CRDT document buffers the child; replay runs when the parent arrives                 |
| Missing transitive dependencies         | Document checks every non-author dependency and keeps the operation pending          |
| Duplicate message                       | Sender-counter checks and operation-ID/author-tick deduplication reject repeats      |
| Delayed message                         | Causal engine buffers; CRDT document buffers pending operations                      |
| Out-of-order delivery                   | Causal cascade delivery waits for prerequisites                                      |
| Concurrent updates                      | Vector comparison detects concurrency; feature policy determines merge               |
| Network partition                       | Independent local increments and replay logs preserve disconnected branches          |
| Clock drift                             | Core HLC and local-mesh HLC keep logical monotonicity                                |
| Restarted node                          | HLC initial state can be restored; CRDT state constructors accept initial state      |
| Stale replicas                          | Causal dominance rejects older CRDT operations; stale keyed HLC updates are rejected |
| Invalid HLC encoding                    | `parseHLC()` throws for malformed fields                                             |
| Invalid vector counter                  | Core `VectorClock` rejects negative, non-integer, or unsafe counters                 |
| Invalid/old CRDT JSON vector            | Legacy deserializer may return `{}` on invalid JSON                                  |
| Stability horizon across departed peers | `removePeer()` removes it from the active peer set                                   |
| Duplicate peer list entries             | Set and peer map operations prevent local duplicate peer state                       |

Not implemented as a repository-wide guarantee:

- Automatic garbage collection of every vector component.
- A universal exactly-once transport ledger across every protocol.
- Preserved concurrent values for every keyed LWW state.
- Byzantine clock validation.
- A global snapshot that is authoritative for every replica.
- Completion of the in-progress core synchronization files that currently
  contain unresolved branch-text fragments.

The last limitation is source-level: at the time this specification was
authored, `src/core/sync/VectorClock.ts`,
`src/core/sync/__tests__/VectorClock.test.ts`, and
`src/core/sync/__tests__/HybridLogicalClock.test.ts` contain unresolved
branch-text fragments such as `fix/vector-clock-atomic-tick` and `main`.
Those fragments prevent some core suites from compiling. The document describes
the intended public APIs and implemented behavior that can be established from
the surrounding source and other complete test files; it does not claim that
the broken core files are currently executable.

## 13. Testing and Verification

### 13.1 Core vector and HLC tests

`src/core/sync/__tests__/VectorClock.test.ts` verifies:

- Defensive snapshots.
- Local increment.
- Before/after/equal/concurrent relationships across three peers.
- Missing-node-as-zero behavior.
- Strict descendant detection.
- Merge and local receive increment.
- HLC tie-break behavior.
- Invalid node and counter rejection.

`src/core/sync/__tests__/HybridLogicalClock.test.ts` verifies:

- Monotonicity during physical clock stall/backward movement.
- Receive progress past a remote physical maximum.
- Stale-update rejection.
- HLC serialization round trips.

`src/core/sync/__tests__/LamportTimestampResolver.test.ts` verifies:

- Causal dominance over an older HLC.
- HLC concurrent-resolution.
- Legacy Lamport/node-ID fallback.
- Multi-peer replay.
- Falsy entity values.

### 13.2 Causal message engine tests

`src/__tests__/sync/CausalVectorClockEngine.test.ts` verifies:

- Static causal comparison.
- Local event generation.
- Immediate, out-of-order, and transitive causal delivery.
- Duplicate and stale delivery rejection.
- Stability horizon calculation.
- Peer removal.

### 13.3 CRDT partition tests

`src/__tests__/core/crdt/CrdtVectorClockDesync.test.ts` verifies:

- Scalar Lamport sums.
- Strict vector dominance.
- Concurrent-clock Lamport/LWW reconciliation.
- Rapid reconnect convergence.
- Duplicate operation rejection.

`src/__tests__/core/crdt/CrdtAsymmetricMeshPartition.test.ts` verifies:

- Transitive dependencies across three nodes.
- Missing-parent buffering and replay.
- Chained grandchild/child/parent replay.
- Automated partition convergence.

### 13.4 Local-mesh HLC tests

`src/__tests__/party/localMeshHlcReconciliation.test.ts` verifies:

- HLC local and receive advancement.
- Vector dominance/concurrency helpers.
- Partitioned keyed-state reconciliation.
- Stale skewed update rejection.
- Peer connection and update-log behavior.

Relevant commands:

```bash
npx jest src/core/sync/__tests__/VectorClock.test.ts --runInBand
npx jest src/core/sync/__tests__/LamportTimestampResolver.test.ts --runInBand
npx jest src/core/sync/__tests__/HybridLogicalClock.test.ts --runInBand
npx jest src/__tests__/sync/CausalVectorClockEngine.test.ts --runInBand
npx jest src/__tests__/core/crdt/CrdtVectorClockDesync.test.ts --runInBand
npx jest src/__tests__/core/crdt/CrdtAsymmetricMeshPartition.test.ts --runInBand
npx jest src/__tests__/party/localMeshHlcReconciliation.test.ts --runInBand
```

Run only these documented suites unless the repository changes. At the time of
this specification:

- `CrdtVectorClockDesync.test.ts` and
  `CrdtAsymmetricMeshPartition.test.ts` passed.
- `CausalVectorClockEngine.test.ts` had a stability-horizon assertion failure.
- `localMeshHlcReconciliation.test.ts` had a partition reconciliation assertion
  failure and a sync-request filtering assertion failure.
- The core VectorClock, Lamport resolver, and HLC suites could not compile
  because of unresolved source/test branch-text fragments.

No test should be claimed passed until its command executes successfully.

## 14. References and Further Reading

- Lamport, Leslie. _Time, Clocks, and the Ordering of Events in a Distributed
  System._ Communications of the ACM, 1978.
- Fidge, Colin J. _Timestamps in Message-Passing Systems That Preserve the
  Partial Ordering._ Australian Computer Science Communications, 1988.
- Mattern, Friedemann. _Virtual Time and Global States of Distributed Systems._ 1989.
- Kulkarni, Sandeep S., et al. _Logical Physical Clocks and Consistent Snapshots
  in Distributed Systems._ 2014.
- Baquero, Carlos. "Version vectors: a practical primer."
- Kleppmann, Martin. _Designing Data-Intensive Applications_, logical clocks and
  CRDT chapters.
- Yjs documentation: <https://docs.yjs.dev/>
- Partykit server documentation: <https://docs.partykit.io/>
