export type VectorClock = Record<string, number>;

export type CausalRelation = 'equal' | 'before' | 'after' | 'concurrent';

export interface CrdtMutation<TPayload = unknown> {
  mutationId: string;
  elementId: string;
  op: 'upsert' | 'remove';
  payload?: TPayload;
  peerId: string;
  lamport: number;
  vectorClock: VectorClock;
  updatedAtMs: number;
}

export interface CrdtElementEntry<TPayload = unknown> {
  elementId: string;
  deleted: boolean;
  payload?: TPayload;
  peerId: string;
  lamport: number;
  vectorClock: VectorClock;
  updatedAtMs: number;
}

export interface RoomCrdtState<TPayload = unknown> {
  roomId: string;
  clock: VectorClock;
  lamport: number;
  elements: Record<string, CrdtElementEntry<TPayload>>;
}

export function cloneVectorClock(clock: VectorClock = {}): VectorClock {
  const copy: VectorClock = {};
  for (const [peer, count] of Object.entries(clock)) {
    copy[peer] = Math.max(0, Math.floor(count));
  }
  return copy;
}

export function incrementVectorClock(
  clock: VectorClock,
  peerId: string
): VectorClock {
  const next = cloneVectorClock(clock);
  next[peerId] = (next[peerId] ?? 0) + 1;
  return next;
}

export function mergeVectorClocks(a: VectorClock, b: VectorClock): VectorClock {
  const merged: VectorClock = cloneVectorClock(a);
  for (const [peer, countB] of Object.entries(b)) {
    const safeB = Math.max(0, Math.floor(countB));
    merged[peer] = Math.max(merged[peer] ?? 0, safeB);
  }
  return merged;
}

export function compareVectorClocks(
  a: VectorClock,
  b: VectorClock
): CausalRelation {
  const peers = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
  let hasLess = false;
  let hasGreater = false;

  for (const peer of peers) {
    const valA = a[peer] ?? 0;
    const valB = b[peer] ?? 0;
    if (valA < valB) {
      hasLess = true;
    } else if (valA > valB) {
      hasGreater = true;
    }
  }

  if (!hasLess && !hasGreater) return 'equal';
  if (hasLess && !hasGreater) return 'before';
  if (hasGreater && !hasLess) return 'after';
  return 'concurrent';
}

export function isMutationNewer<TPayload>(
  candidate: CrdtMutation<TPayload>,
  current: CrdtElementEntry<TPayload>
): boolean {
  const relation = compareVectorClocks(
    candidate.vectorClock,
    current.vectorClock
  );
  if (relation === 'after') return true;
  if (relation === 'before' || relation === 'equal') return false;

  const peerCmp = candidate.peerId.localeCompare(current.peerId);
  if (peerCmp !== 0) {
    return peerCmp > 0;
  }

  if (candidate.lamport !== current.lamport) {
    return candidate.lamport > current.lamport;
  }

  if (candidate.updatedAtMs !== current.updatedAtMs) {
    return candidate.updatedAtMs > current.updatedAtMs;
  }

  const candidateDeleted = candidate.op === 'remove';
  if (candidateDeleted !== current.deleted) {
    return candidateDeleted;
  }

  return candidate.mutationId.localeCompare(`${current.peerId}:${current.lamport}`) > 0;
}

export function createInitialRoomState<TPayload = unknown>(
  roomId: string
): RoomCrdtState<TPayload> {
  return {
    roomId,
    clock: {},
    lamport: 0,
    elements: {},
  };
}

export function createLocalMutation<TPayload>(
  state: RoomCrdtState<TPayload>,
  params: {
    mutationId: string;
    elementId: string;
    op: 'upsert' | 'remove';
    payload?: TPayload;
    peerId: string;
    updatedAtMs?: number;
  }
): CrdtMutation<TPayload> {
  const nextClock = incrementVectorClock(state.clock, params.peerId);
  const nextLamport = Math.max(state.lamport, nextClock[params.peerId]) + 1;
  return {
    mutationId: params.mutationId,
    elementId: params.elementId,
    op: params.op,
    payload: params.payload,
    peerId: params.peerId,
    lamport: nextLamport,
    vectorClock: nextClock,
    updatedAtMs: params.updatedAtMs ?? Date.now(),
  };
}

export function applyMutationToState<TPayload>(
  state: RoomCrdtState<TPayload>,
  mutation: CrdtMutation<TPayload>
): RoomCrdtState<TPayload> {
  const nextClock = mergeVectorClocks(state.clock, mutation.vectorClock);
  const nextLamport = Math.max(state.lamport, mutation.lamport);
  const existing = state.elements[mutation.elementId];

  const shouldApply = !existing || isMutationNewer(mutation, existing);
  const nextElements: Record<string, CrdtElementEntry<TPayload>> = {
    ...state.elements,
  };

  if (shouldApply) {
    nextElements[mutation.elementId] = {
      elementId: mutation.elementId,
      deleted: mutation.op === 'remove',
      payload: mutation.op === 'upsert' ? mutation.payload : undefined,
      peerId: mutation.peerId,
      lamport: mutation.lamport,
      vectorClock: cloneVectorClock(mutation.vectorClock),
      updatedAtMs: mutation.updatedAtMs,
    };
  }

  return {
    roomId: state.roomId,
    clock: nextClock,
    lamport: nextLamport,
    elements: nextElements,
  };
}

export function mergeRoomStates<TPayload>(
  left: RoomCrdtState<TPayload>,
  right: RoomCrdtState<TPayload>
): RoomCrdtState<TPayload> {
  const mergedClock = mergeVectorClocks(left.clock, right.clock);
  const mergedLamport = Math.max(left.lamport, right.lamport);
  const allElementIds = new Set<string>([
    ...Object.keys(left.elements),
    ...Object.keys(right.elements),
  ]);

  const mergedElements: Record<string, CrdtElementEntry<TPayload>> = {};

  for (const elementId of allElementIds) {
    const lEntry = left.elements[elementId];
    const rEntry = right.elements[elementId];

    if (lEntry && !rEntry) {
      mergedElements[elementId] = {
        ...lEntry,
        vectorClock: cloneVectorClock(lEntry.vectorClock),
      };
    } else if (!lEntry && rEntry) {
      mergedElements[elementId] = {
        ...rEntry,
        vectorClock: cloneVectorClock(rEntry.vectorClock),
      };
    } else if (lEntry && rEntry) {
      const candidateFromRight: CrdtMutation<TPayload> = {
        mutationId: `${rEntry.peerId}:${rEntry.lamport}`,
        elementId,
        op: rEntry.deleted ? 'remove' : 'upsert',
        payload: rEntry.payload,
        peerId: rEntry.peerId,
        lamport: rEntry.lamport,
        vectorClock: rEntry.vectorClock,
        updatedAtMs: rEntry.updatedAtMs,
      };

      const winner = isMutationNewer(candidateFromRight, lEntry)
        ? rEntry
        : lEntry;

      mergedElements[elementId] = {
        ...winner,
        vectorClock: cloneVectorClock(winner.vectorClock),
      };
    }
  }

  return {
    roomId: left.roomId || right.roomId,
    clock: mergedClock,
    lamport: mergedLamport,
    elements: mergedElements,
  };
}

export function getActiveElements<TPayload>(
  state: RoomCrdtState<TPayload>
): CrdtElementEntry<TPayload>[] {
  return Object.values(state.elements).filter((item) => !item.deleted);
}
