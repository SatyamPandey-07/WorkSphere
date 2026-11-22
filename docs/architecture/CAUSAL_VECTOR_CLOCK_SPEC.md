# Causal Vector Clock Specification for Offline Notes

## Scope and terminology

WorkSphere's application-level vector clock is implemented in `src/core/sync/VectorClock.ts`. It is distinct from Yjs state vectors and from the SHA-256 snapshot checksum protocol. A vector clock tracks per-node logical counters and provides a partial order over mutations from offline peers.

A clock is a finite mapping from a non-empty node identifier to a non-negative safe integer:

[
V : NodeId \rightarrow \mathbb{N}_0
]

An omitted component is interpreted as zero. The implementation serializes clocks as sorted JSON-compatible records while storing them internally in a `Map`.

## Causality relation

For clocks (A) and (B), define component-wise comparison over the union of their node identifiers:

[
A \leq B \iff \forall n, A(n) \leq B(n)
]

[
A < B \iff A \leq B \land \exists n : A(n) < B(n)
]

[
A \parallel B \iff (\exists i : A(i) < B(i)) \land (\exists j : A(j) > B(j))
]

The implementation returns:

| Relation | Meaning |
|---|---|
| `BEFORE` | (A < B); B causally includes A |
| `AFTER` | (A > B); A causally includes B |
| `CONCURRENT` | Neither clock dominates the other |
| `EQUAL` | Every component is equal |

For example, (A = \{a:2,b:1\}) and (B = \{a:3,b:1\}) gives (A < B). (C = \{a:3,b:1\}) and (D = \{a:2,b:2\}) are concurrent.

## Algorithms

### Increment

```text
increment(V, localNode):
  validate localNode
  V[localNode] = V.get(localNode, 0) + 1
  return sorted snapshot(V)
```

A local mutation increments the local component before the new state is recorded.

### Merge / receive

```text
merge(V, incoming, localNode):
  validate every incoming node id and counter
  for each (node, counter) in incoming:
    V[node] = max(V.get(node, 0), counter)
  V[localNode] = V.get(localNode, 0) + 1
  return sorted snapshot(V)
```

WorkSphere's current `merge` method takes component-wise maxima and then increments the local component to record receipt of the remote state. This receipt increment is part of the implementation contract; callers should not add another increment for the same receive event.

### Compare

```text
compare(A, B):
  less = false
  greater = false
  for node in union(keys(A), keys(B)):
    less |= A.get(node, 0) < B.get(node, 0)
    greater |= A.get(node, 0) > B.get(node, 0)
    if less and greater: return CONCURRENT
  if less: return BEFORE
  if greater: return AFTER
  return EQUAL
```

### Prune / compaction safety

The current `VectorClock` class does not expose a `prune` method. Removing an inactive node's component merely because it has not been seen recently is unsafe: a disconnected peer may later return with an old mutation whose causal history depends on that component.

A future pruning protocol must use a durable acknowledgement frontier or retention epoch:

1. Track the highest clock each active peer has acknowledged.
2. Compute a component-wise stable frontier that every peer allowed to rejoin has observed.
3. Prune a node component only when its value is dominated by that stable frontier and the system has a defined policy for peers outside the retention window.
4. On a peer returning after eviction, require a fresh snapshot / epoch rebase; do not merge an arbitrarily stale clock as if it belonged to the current epoch.
5. Preserve pending local mutations until they have been reconciled against the new epoch.

This is a safety specification, not a claim that vector-component garbage collection is implemented by `VectorClock.ts`. See the existing CRDT vector-GC and compaction specifications for Yjs-specific retention behavior.

## Deterministic conflict resolution

Causality has priority over timestamp ordering:

1. If one vector is strictly AFTER the other, the causally newer mutation wins.
2. For concurrent or equal vectors, compare HLC stamps when both mutations contain one.
3. If HLC is absent or equal, compare the legacy `lamportTs`.
4. If those are equal, compare `nodeId` lexicographically, then mutation `id`.

The current resolver therefore uses HLC first for concurrent/equal versions, with Lamport timestamp and stable node/id ordering as compatibility fallbacks. A timestamp is never treated as proof of causal ancestry.

## Invariants

- Node identifiers are non-empty strings.
- Counters are non-negative safe integers.
- Missing node components equal zero.
- Merge is component-wise maximum followed by one local receipt increment.
- Comparison is a partial order; concurrent clocks must not be mistaken for before/after.
- A causal descendant wins before HLC or legacy timestamp tie-breaking.
- Equal input clocks compare as `EQUAL`; equality alone does not establish a strict descendant.
- Pruning must never discard history still needed by a peer that the system permits to reconnect.

## Verification

The source tests should cover increment, merge, component-wise maxima, missing components, all four comparison outcomes, malformed identifiers/counters, causal conflict precedence, HLC fallback, legacy Lamport fallback, and stable node/id tie-breaking. Any future pruning implementation requires separate tests for acknowledgement frontiers, stale-peer eviction, epoch rebasing, and prevention of stale update resurrection.

## Implementation references

- `src/core/sync/VectorClock.ts`
- `src/core/sync/LamportTimestampResolver.ts`
- `src/core/sync/__tests__/VectorClock.test.ts`
- [Offline sync flow](./offline-sync-flow.md)
- [CRDT vector GC specifications](../crdt/CRDT_MULTI_PEER_VECTOR_GC.md)
