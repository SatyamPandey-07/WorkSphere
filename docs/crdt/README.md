# CRDT documentation

Design notes, protocols, and formal specifications for WorkSphere's
collaborative data layer. All documents describe the Yjs 13.6.33 /
`y-protocols` 1.0.7 toolchain used by the canvas, notes, and mesh transports.

## Documents

| Document                                                                               | Kind                 | Scope                                                                                                                                                          |
| -------------------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`CRDT_VECTOR_COMPACTION_SPECIFICATION.md`](./CRDT_VECTOR_COMPACTION_SPECIFICATION.md) | Formal specification | State-vector domination for squashing update chunks into a base snapshot, convergence proofs, tombstone reclamation, and retention-epoch peer eviction.        |
| [`CRDT_VECTOR_COMPACTION.md`](./CRDT_VECTOR_COMPACTION.md)                             | Protocol             | Two-phase state-vector handshake, differential update generation, checkpoint lifecycle, compaction heuristics, offline reconnect, and the invariant checklist. |
| [`CRDT_VECTOR_MATHEMATICAL_SPEC.md`](./CRDT_VECTOR_MATHEMATICAL_SPEC.md)               | Theory               | State-vector algebra, the missing-update function, Lamport ordering, and the tombstone GC sketch.                                                              |
| [`state-based-resolution.md`](./state-based-resolution.md)                             | Theory               | The separate vector-clock state-based engine: semilattice join, conflict resolution, and resolution proofs.                                                    |
| [`whiteboard-architecture.md`](./whiteboard-architecture.md)                           | Architecture         | Canvas schema, connection lifecycle, snapshot persistence, and the `gc: false` server configuration.                                                           |
| [`CRDT_DATACHANNEL_FRAMING.md`](./CRDT_DATACHANNEL_FRAMING.md)                         | Protocol             | Binary framing for CRDT updates sent over WebRTC data channels.                                                                                                |

## Reading order

1. [`whiteboard-architecture.md`](./whiteboard-architecture.md) for the system
   shape and where persistence happens.
2. [`CRDT_VECTOR_COMPACTION.md`](./CRDT_VECTOR_COMPACTION.md) for the wire
   protocol and operational compaction flow.
3. [`CRDT_VECTOR_COMPACTION_SPECIFICATION.md`](./CRDT_VECTOR_COMPACTION_SPECIFICATION.md)
   for the formal model, the squash-eligibility predicate, and the proofs.
4. [`CRDT_VECTOR_MATHEMATICAL_SPEC.md`](./CRDT_VECTOR_MATHEMATICAL_SPEC.md) and
   [`state-based-resolution.md`](./state-based-resolution.md) for the underlying
   algebra.

## Implementation status

Journal compaction, snapshot round-trip verification, and stale-presence
pruning are implemented in
[`src/lib/crdt/canvasProvider.ts`](../../src/lib/crdt/canvasProvider.ts),
[`src/lib/crdt/snapshotManager.ts`](../../src/lib/crdt/snapshotManager.ts), and
[`src/core/crdt/AwarenessProtocol.ts`](../../src/core/crdt/AwarenessProtocol.ts).
Frontier-gated pruning of application-level tombstone records exists as a
library in [`src/lib/offline/tombstoneCompactor.ts`](../../src/lib/offline/tombstoneCompactor.ts)
but has no production call site. Retention-epoch peer eviction and
delete-set rewriting inside Yjs documents are specified but not implemented;
see §12 of the specification for the proof obligations.

## Conventions

- State vectors in the specification use the half-open Yjs convention,
  $V(c) = $ next expected clock, returned by `Y.encodeStateVector`. The older
  theory documents use the largest-observed-clock convention; they differ by
  one.
- Every parameter quoted in these documents is verified against the source.
  Constants live in `canvasProvider.ts`, `snapshotManager.ts`,
  `AwarenessProtocol.ts`, and `party/server.ts`.

## Related documents

- [`../YJS_CRDT_COMPRESSION.md`](../YJS_CRDT_COMPRESSION.md): compressed binary
  update framing.
- [`../CRDT_REALTIME_SYNC_PROTOCOL.md`](../CRDT_REALTIME_SYNC_PROTOCOL.md):
  realtime sync wire format.
- [`../WEBRTC_MESH_CRDT_SYNC_SPECIFICATION.md`](../WEBRTC_MESH_CRDT_SYNC_SPECIFICATION.md):
  mesh transport, partitioning, and healing.
