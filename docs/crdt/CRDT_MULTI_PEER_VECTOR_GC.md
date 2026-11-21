# Multi-peer State-Vector Garbage Collection under Network Partitions

- **Related issue:** [#7770](https://github.com/SatyamPandey-07/WorkSphere/issues/7770)
- **Status:** Formal design and proof obligations. This document does not claim that Yjs delete-set garbage collection or retention-epoch peer eviction is implemented.
- **Implementation baseline:** Yjs 13.6.33, `y-protocols` 1.0.7, WorkSphere canvas journal and PartyKit transport.
- **Related implementation:** [`canvasProvider.ts`](../../src/lib/crdt/canvasProvider.ts), [`snapshotManager.ts`](../../src/lib/crdt/snapshotManager.ts), [`tombstoneCompactor.ts`](../../src/lib/offline/tombstoneCompactor.ts).

## 1. Scope and safety boundary

A network partition creates replicas that can continue to accept edits without observing one another's updates. A tombstone is safe to reclaim only after every replica that is still entitled to rejoin from its old history has acknowledged the deletion and the snapshot that supersedes it.

This specification separates three operations:

1. **Journal compaction:** fold an acknowledged set of update records into a verified base snapshot.
2. **Application-record tombstone pruning:** remove an application-level deleted record from IndexedDB after its causal dependencies are stable.
3. **Yjs document garbage collection:** rewrite or discard Yjs delete-set information inside an encoded document.

The first operation is implemented by `CanvasChangeJournal.compact` and `NomadCanvasProvider.runCompaction`. The second has a frontier-gated library in `tombstoneCompactor.ts`, but the repository's CRDT documentation records that it has no production call site. The third is **not implemented**: the PartyKit room uses `gc: false`, and Yjs does not expose a public API for selectively removing delete-set entries. Never infer that a snapshot's state vector alone makes Yjs delete-set rewriting safe.

## 2. Model and clock convention

Let:

- (P_e) be the set of peers retained at retention epoch (e).
- (V_p(c)) be peer (p)'s Yjs state vector entry for client (c).
- (V_u(c)) be the state vector of update (u).
- (D_p) be the delete-set information known by peer (p).
- (d) be an application tombstone with deletion update (u_d).
- (F_e) be the component-wise stable frontier for the retained peer set.

WorkSphere follows the Yjs **half-open / next-expected-clock** convention:

[
V_p(c)=	ext{the first clock not yet decided by peer }p.
]

A peer has the contiguous struct prefix represented by update (u) only when:

[
orall c:quad V_p(c)ge V_u(c).
]

The component-wise stable frontier is:

[
F_e(c)=min_{pin P_e}V_p(c).
]

Thus (F_e) is the greatest vector dominated by every retained peer. The minimum is taken over the *retained* membership set, not merely the peers currently connected to the WebSocket.

### Important limitation of state vectors

State vectors summarize integrated struct clocks; they do not, by themselves, prove that every peer has applied a particular delete-set entry. A safe delete protocol therefore needs an acknowledgement for the deletion update (or an equivalent explicit delete-set version) in addition to ordinary state-vector domination.

For a tombstone with deletion vector (V_d), a necessary clock condition is:

[
orall pin P_e,quad V_psucceq V_d.
]

The protocol must also record that each retained peer acknowledged the deletion itself. The predicate `V_p >= V_u` is a necessary prefix condition, not a standalone proof that a delete set may be discarded. See [the detailed squash counterexample and proof obligations](./CRDT_VECTOR_COMPACTION_SPECIFICATION.md#3-the-squash-invariant).

## 3. Tombstone reclamation invariant

A tombstone may be reclaimed from an application-level store only when **all** of the following are true:

1. It is a tombstone record, not an ordinary live record.
2. Its minimum retention age has elapsed.
3. Every peer in (P_e) has acknowledged the deletion update and its causal prefix.
4. The durable snapshot/checkpoint that subsumes that deletion has been written and verified.
5. The peer-membership epoch used to compute (F_e) is still current when the prune transaction commits.
6. The record has no pending conflict, in-flight sync, or unmerged branch marker.

For a tombstone created by a struct at client (c), clock (k), the half-open clock test is (k < F_e(c)). For a multi-client deletion update, compare the full vector component-wise. A missing component is zero; it must not be treated as an acknowledgement.

The existing `isVectorClockMerged` helper and `isTombstoneCompactionSafe` implement conservative parts of this policy for **application-level records**. They do not rewrite Yjs documents or prove that an external peer's delete set has been acknowledged.

## 4. Partition and peer-retention state machine

A peer's transport presence is not its durable acknowledgement. The current 15-second awareness timeout is a liveness signal only; it must not automatically remove that peer from (P_e).

A future peer-retention manager should use the following states:

| State | Meaning | May hold back the stable frontier? |
|---|---|---|
| `ACTIVE` | Heartbeat is current and the peer is exchanging vectors | Yes |
| `SUSPECT` | Heartbeat timed out; peer may be partitioned | Yes |
| `EVICTION_PENDING` | Retention grace elapsed; a durable rebase/eviction decision is being recorded | Yes, until the decision commits |
| `EVICTED` | Peer is no longer allowed to submit old-epoch deltas | No, after the eviction epoch is durable |

### Retention-epoch handshake

1. The coordinator increments the room's retention epoch and persists the complete checkpoint and membership decision before changing the active peer set.
2. A peer that acknowledges the new epoch records the checkpoint state vector and deletion watermark.
3. A peer that reconnects with an older epoch must first download and apply the current checkpoint, then send its post-checkpoint updates. It must not be allowed to send an old state-vector delta directly into the compacted room.
4. Any locally authored updates that were never durably uploaded before eviction must be preserved for an explicit rebase/reconciliation path. Eviction must not silently discard offline work.
5. Only after the eviction record and rebase policy are durable may the peer be removed from (P_e) and the frontier recomputed.

A retention grace period is an operational configuration, not a mathematical proof. Choosing a timeout does not prove that a peer has no unsent local updates.

## 5.1 Monotonicity of peer state vectors and the stable frontier

For a fixed peer (p), integrating an update can only add previously missing structs; it does not decrement a client clock. Therefore, for every client (c):

[
V'_p(c) \ge V_p(c).
]

While the retained peer set (P_e) is fixed, the component-wise minimum frontier is also monotonic:

[
F'_e(c)=\min_{p\in P_e} V'_p(c)
\ge \min_{p\in P_e}V_p(c)=F_e(c).
]

This argument depends on keeping the membership set fixed for the comparison. Adding a new peer can lower a component of the minimum frontier. WorkSphere therefore treats peer-set changes as a new retention epoch: the new peer must bootstrap from the committed checkpoint, and the new frontier is computed and compared only within that epoch. A removal may advance the frontier only after the eviction decision and checkpoint are durable. No code should compare frontiers across different membership epochs as though they were one uninterrupted monotone sequence.

## 5. Convergence argument

Assume:

- Yjs update application is idempotent, commutative, and associative for the same struct identities.
- Every peer retained in (P_e) has acknowledged all updates up to the stable frontier.
- A deletion acknowledgement refers to the actual delete update, not only a larger unrelated struct clock.
- The checkpoint is a verified encoding of the union of acknowledged updates.
- A peer evicted from (P_e) cannot merge an old-epoch replica directly; it must rebase against the new checkpoint.

Then every retained peer's causal history is represented by the checkpoint. Reclaiming an application tombstone whose delete update is below the stable frontier cannot remove the only copy of a live value or allow a retained peer to reintroduce a pre-delete state: every retained peer already knows the deletion, and any later update is merged with that history.

If any retained peer lacks the deletion acknowledgement, the premise fails. That peer may reconnect with an earlier value and cause a semantic resurrection in an application-level store. The safe action is to keep the tombstone or perform the explicit eviction/rebase protocol—not to prune by wall-clock age alone.

## 6. Atomicity and failure handling

The acknowledgement frontier, room epoch, and snapshot boundary used by a prune must be read as one logical version. A prune should:

1. Read the current retention epoch and acknowledged frontier.
2. Select only tombstones that pass the full predicate above.
3. Re-check the epoch/frontier inside the same IndexedDB readwrite transaction that deletes the selected application records.
4. Abort rather than prune if the epoch changed or any peer acknowledgement regressed/missing.
5. Emit counts for scanned, pruned, too-young, and unmerged records.

Journal snapshot compaction already captures a sequence boundary before encoding and commits the snapshot plus deletion of superseded records atomically. The multi-peer acknowledgement/retention-epoch transaction remains a separate extension; do not treat journal sequence numbers as a peer stability frontier.

## 7. Failure cases covered

| Failure | Required safe behavior |
|---|---|
| Peer is temporarily offline | Keep it in (P_e); do not advance the frontier past its acknowledgement |
| Delayed update arrives after another peer's delete | Apply the delete-aware merge; keep tombstone until stability is proven |
| Peer returns after eviction epoch | Require checkpoint bootstrap and explicit rebase |
| Snapshot checksum/state-vector mismatch | Reject snapshot and retain source journal records |
| Delete-set acknowledgement missing | Retain tombstone even if the struct state vector dominates |
| Retention coordinator crashes before commit | Old membership epoch remains authoritative; no prune occurs |

## 8. Implementation status and follow-up

- **Implemented:** Yjs journal compaction, snapshot round-trip checks, state-vector domination helper, stale awareness pruning, transport-epoch full-state fallback, and conservative application-level tombstone safety predicates.
- **Not implemented:** A durable multi-peer acknowledgement registry, retention-epoch peer eviction manager, and Yjs document delete-set rewriter/collector.
- **Required before enabling Yjs document GC:** A tested delete-set acknowledgement protocol, epoch-checked durable frontier, stale-peer rebase enforcement, and cross-partition tests proving no deleted value can reappear.

This is a formal safety specification, not a claim that the not-implemented parts have shipped.
