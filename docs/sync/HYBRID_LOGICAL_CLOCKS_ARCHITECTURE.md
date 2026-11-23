# Hybrid Logical Clocks (HLC) & Causal Synchronization Architecture

## 1. HLC State & Invariants
Each client or server node $i$ maintains:
- $pt_i$: physical timestamp (milliseconds since epoch)
- $l_i$: logical counter ($\mathbb{Z}_{\ge 0}$)

**Invariants:**
1. **Monotonicity:** For consecutive events $e_1 \to e_2$ on node $i$, $\text{HLC}(e_1) < \text{HLC}(e_2)$ lexicographically on $(pt, l, \text{actorId})$.
2. **Causal Bound:** If event $a$ causally precedes event $b$ ($a \to b$), then $\text{HLC}(a) < \text{HLC}(b)$.
3. **Clock Proximity:** Under bounded clock drift $\varepsilon$, $pt_i$ tracks physical time within bounded drift without regressing when local wall clocks jump backward.

## 2. Formal Proof Sketch
- **Local Send / Update:** Let $pt' = \max(pt_i, \text{now}_i())$. If $pt' = pt_i$, set $l'_i = l_i + 1$; else set $pt_i = pt', l_i = 0$. Since $(pt'_i, l'_i) >_{\text{lex}} (pt_i, l_i)$, strict local progression holds.
- **Receive $(pt_m, l_m)$:** Let $pt_{\max} = \max(pt_i, pt_m, \text{now}_i())$.
  - If $pt_{\max} = pt_i = pt_m$: $l_i = \max(l_i, l_m) + 1$.
  - Else if $pt_{\max} = pt_i$: $l_i = l_i + 1$.
  - Else if $pt_{\max} = pt_m$: $l_i = l_m + 1$.
  - Else ($pt_{\max} = \text{now}_i()$): $l_i = 0$.
  - Set $pt_i = pt_{\max}$.
  In all cases $\text{HLC}_{\text{after}} >_{\text{lex}} \text{HLC}_{\text{before}}$ and $\text{HLC}_{\text{after}} >_{\text{lex}} (pt_m, l_m)$, establishing $a \to b \implies \text{HLC}(a) < \text{HLC}(b)$ by induction.

## 3. Pseudocode
```ts
export interface HlcTimestamp {
  pt: number;
  l: number;
  actorId: string;
}

export function compareHlc(a: HlcTimestamp, b: HlcTimestamp): number {
  if (a.pt !== b.pt) return a.pt - b.pt;
  if (a.l !== b.l) return a.l - b.l;
  return a.actorId.localeCompare(b.actorId);
}

export function tickLocalHlc(
  current: HlcTimestamp,
  physicalNowMs: number
): HlcTimestamp {
  const nextPt = Math.max(current.pt, physicalNowMs);
  if (nextPt === current.pt) {
    return { pt: nextPt, l: current.l + 1, actorId: current.actorId };
  }
  return { pt: nextPt, l: 0, actorId: current.actorId };
}

export function receiveRemoteHlc(
  current: HlcTimestamp,
  remote: HlcTimestamp,
  physicalNowMs: number
): HlcTimestamp {
  const nextPt = Math.max(current.pt, remote.pt, physicalNowMs);
  if (nextPt === current.pt && nextPt === remote.pt) {
    return {
      pt: nextPt,
      l: Math.max(current.l, remote.l) + 1,
      actorId: current.actorId,
    };
  }
  if (nextPt === current.pt) {
    return { pt: nextPt, l: current.l + 1, actorId: current.actorId };
  }
  if (nextPt === remote.pt) {
    return { pt: nextPt, l: remote.l + 1, actorId: current.actorId };
  }
  return { pt: nextPt, l: 0, actorId: current.actorId };
}
#### `docs/architecture/CAUSAL_ORDERING_AND_TIEBREAKING.md`

```markdown
# Causal Ordering and Deterministic Tie-Breaking

## Causal Ordering Rules
- Local operations advance `(pt, l)` monotonically via `tickLocalHlc`.
- Remote state or mutation batches advance `(pt, l)` via `receiveRemoteHlc`.
- Causal precedence across partitions is evaluated using `compareHlc`, falling back to `mutationId` when two events share identical `(pt, l, actorId)`.

## Seat Reservation & Workspace Conflict Resolution
- **Seat holds / bookings:** Concurrent offline claims on the same seat and time window resolve deterministically using total-order comparison on `(pt, l, actorId, mutationId)` plus server-side conflict/idempotency checks on sync.
- **Collaborative workspace edits:** Non-conflicting fields merge cleanly; conflicting updates on the same entity/field apply the deterministic total-order winner so all nodes converge to identical state.

## Related Documentation
- See `docs/sync/HYBRID_LOGICAL_CLOCKS_ARCHITECTURE.md` for formal invariants, proofs, pseudocode, clock edge cases, and `OfflineMutationQueue.ts` integration.