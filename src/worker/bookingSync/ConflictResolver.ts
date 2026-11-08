/**
 * ConflictResolver.ts
 * Vector Clock CRDT conflict resolution engine for offline booking drafts.
 * Resolves causal divergence, concurrent offline edits, and domain invariants
 * using vector clocks, Lamport timestamps, field-level Last-Write-Wins (LWW),
 * and monotonic state convergence.
 */

import { BookingDraft } from './DraftStore';
import { CrdtVectorClock, type VectorClock } from '../../core/crdt/CrdtVectorClock';

export type CausalOrder = 'before' | 'after' | 'concurrent' | 'equal';

export type ResolutionStrategy =
  | 'LWW_DRAFT'
  | 'LWW_SERVER'
  | 'SET_UNION'
  | 'TOMBSTONE'
  | 'SERVER_AUTHORITY'
  | 'CAUSAL_DOMINANCE_DRAFT'
  | 'CAUSAL_DOMINANCE_SERVER';

export interface FieldConflict {
  field: string;
  serverValue: unknown;
  draftValue: unknown;
  resolvedValue: unknown;
  strategy: ResolutionStrategy;
  reason: string;
}

export interface ServerState {
  id: string;
  version: number;
  payload: Record<string, unknown>;
  vectorClock?: VectorClock;
  updatedAt?: number;
  nodeId?: string;
  fieldClocks?: Record<
    string,
    { timestamp: number; clock: VectorClock; lamport: number; nodeId: string }
  >;
}

export interface MergeResult {
  resolvedPayload: Record<string, unknown>;
  action: 'USE_SERVER' | 'USE_DRAFT' | 'MERGED';
  requiresUserInput: boolean;
  causalOrder: CausalOrder;
  resolvedVectorClock: VectorClock;
  fieldConflicts: FieldConflict[];
  resolutionLog: string[];
}

const CRITICAL_BOOKING_FIELDS = [
  'status',
  'venueId',
  'userId',
  'date',
  'startTime',
  'endTime',
  'seatId',
  'deskId',
  'roomId',
];

const ADDITIVE_SET_FIELDS = [
  'amenities',
  'equipment',
  'tags',
  'attendees',
  'addOns',
  'perks',
  'specialRequirements',
];

function isDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function mergeSetUnion(arrA: unknown[], arrB: unknown[]): unknown[] {
  const seen = new Set<string>();
  const result: unknown[] = [];

  for (const item of [...arrA, ...arrB]) {
    const key =
      typeof item === 'object' && item !== null && 'id' in item
        ? String((item as { id: unknown }).id)
        : JSON.stringify(item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }

  return result;
}

export class ConflictResolver {
  private localNodeId: string;

  constructor(localNodeId: string = 'worker-node') {
    this.localNodeId = localNodeId;
  }

  /**
   * Compares two vector clocks to determine strict causal ordering.
   * Returns 'before' (clockA < clockB), 'after' (clockA > clockB),
   * 'equal' (clockA == clockB), or 'concurrent' (clockA || clockB).
   */
  public compareVectorClocks(
    clockA: VectorClock,
    clockB: VectorClock,
  ): CausalOrder {
    let hasLess = false;
    let hasGreater = false;

    const allKeys = new Set([...Object.keys(clockA), ...Object.keys(clockB)]);
    for (const key of allKeys) {
      const valA = clockA[key] || 0;
      const valB = clockB[key] || 0;
      if (valA < valB) hasLess = true;
      if (valA > valB) hasGreater = true;
    }

    if (!hasLess && !hasGreater) return 'equal';
    if (hasLess && !hasGreater) return 'before';
    if (hasGreater && !hasLess) return 'after';
    return 'concurrent';
  }

  /**
   * Computes the supremum (pairwise maximum) of two vector clocks.
   * Optionally increments the resolving node's component.
   */
  public mergeVectorClocks(
    clockA: VectorClock,
    clockB: VectorClock,
    incrementNode?: string,
  ): VectorClock {
    const merged: VectorClock = {};
    const allKeys = new Set([...Object.keys(clockA), ...Object.keys(clockB)]);

    for (const key of allKeys) {
      merged[key] = Math.max(clockA[key] || 0, clockB[key] || 0);
    }

    if (incrementNode) {
      merged[incrementNode] = (merged[incrementNode] || 0) + 1;
    }

    return merged;
  }

  /**
   * Normalizes vector clocks for both draft and server state,
   * synthesizing clocks from version/timestamp metadata if not explicitly provided.
   */
  private normalizeClocks(
    draft: BookingDraft,
    serverState: ServerState,
  ): { draftClock: VectorClock; serverClock: VectorClock } {
    const draftNode = draft.nodeId || draft.userId || 'client';
    const serverNode = serverState.nodeId || 'server';

    let draftClock: VectorClock;
    if (draft.vectorClock && Object.keys(draft.vectorClock).length > 0) {
      draftClock = { ...draft.vectorClock };
    } else {
      const baseVersion = draft.serverVersion || 0;
      draftClock = {
        [serverNode]: baseVersion,
        [draftNode]: 1,
      };
    }

    let serverClock: VectorClock;
    if (
      serverState.vectorClock &&
      Object.keys(serverState.vectorClock).length > 0
    ) {
      serverClock = { ...serverState.vectorClock };
    } else {
      serverClock = {
        [serverNode]: serverState.version || 1,
      };
    }

    return { draftClock, serverClock };
  }

  /**
   * Resolves discrepancies between an offline booking draft and the current server state
   * using Vector Clock causal analysis and deterministic CRDT register/set merging.
   */
  public resolve(
    draft: BookingDraft,
    currentServerState: ServerState,
  ): MergeResult {
    const { draftClock, serverClock } = this.normalizeClocks(
      draft,
      currentServerState,
    );
    const causalOrder = this.compareVectorClocks(draftClock, serverClock);

    const resolutionLog: string[] = [
      `Causal relationship determined: ${causalOrder} (Draft clock: ${JSON.stringify(
        draftClock,
      )}, Server clock: ${JSON.stringify(serverClock)})`,
    ];
    const fieldConflicts: FieldConflict[] = [];

    // 1. Tombstone / Monotonic Cancellation Invariant
    // Cancellation is a terminal status. If the booking was cancelled on the server,
    // a stale or concurrent offline draft cannot unilaterally revive it without user intervention.
    if (
      currentServerState.payload.status === 'CANCELLED' &&
      draft.payload.status !== 'CANCELLED'
    ) {
      const mergedClock = this.mergeVectorClocks(
        draftClock,
        serverClock,
        this.localNodeId,
      );
      fieldConflicts.push({
        field: 'status',
        serverValue: 'CANCELLED',
        draftValue: draft.payload.status,
        resolvedValue: 'CANCELLED',
        strategy: 'TOMBSTONE',
        reason:
          'Booking was cancelled on the server; offline draft cannot resurrect booking without explicit user intervention.',
      });
      resolutionLog.push(
        'Terminal invariant: Server status is CANCELLED. Flagging user input requirement.',
      );

      return {
        resolvedPayload: { ...currentServerState.payload },
        action: 'USE_SERVER',
        requiresUserInput: true,
        causalOrder,
        resolvedVectorClock: mergedClock,
        fieldConflicts,
        resolutionLog,
      };
    }

    // If draft cancelled offline, cancellation tombstone takes precedence monotonically
    if (
      draft.payload.status === 'CANCELLED' &&
      currentServerState.payload.status !== 'CANCELLED'
    ) {
      const mergedClock = this.mergeVectorClocks(
        draftClock,
        serverClock,
        this.localNodeId,
      );
      const resolvedPayload = {
        ...currentServerState.payload,
        status: 'CANCELLED',
      };
      fieldConflicts.push({
        field: 'status',
        serverValue: currentServerState.payload.status,
        draftValue: 'CANCELLED',
        resolvedValue: 'CANCELLED',
        strategy: 'TOMBSTONE',
        reason:
          'User cancelled booking offline; cancellation tombstone propagated.',
      });
      resolutionLog.push(
        'Terminal invariant: Offline draft cancelled booking. Applying CANCELLED tombstone.',
      );

      return {
        resolvedPayload,
        action: 'MERGED',
        requiresUserInput: false,
        causalOrder,
        resolvedVectorClock: mergedClock,
        fieldConflicts,
        resolutionLog,
      };
    }

    // 2. Strict Causal Dominance: Draft is strictly newer (Draft > Server)
    if (causalOrder === 'after') {
      resolutionLog.push(
        'Draft causally dominates server state. Applying full draft mutations.',
      );
      return {
        resolvedPayload: {
          ...currentServerState.payload,
          ...draft.payload,
        },
        action: 'USE_DRAFT',
        requiresUserInput: false,
        causalOrder,
        resolvedVectorClock: draftClock,
        fieldConflicts,
        resolutionLog,
      };
    }

    // 3. Strict Causal Dominance: Server is strictly newer (Draft < Server)
    if (causalOrder === 'before') {
      // Check if draft has non-conflicting new delta fields that server lacks
      const resolvedPayload = { ...currentServerState.payload };
      let hasDeltaField = false;

      for (const [key, draftVal] of Object.entries(draft.payload)) {
        if (currentServerState.payload[key] === undefined) {
          resolvedPayload[key] = draftVal;
          hasDeltaField = true;
          fieldConflicts.push({
            field: key,
            serverValue: undefined,
            draftValue: draftVal,
            resolvedValue: draftVal,
            strategy: 'CAUSAL_DOMINANCE_SERVER',
            reason: 'Preserved draft delta field absent on server.',
          });
        }
      }

      resolutionLog.push(
        hasDeltaField
          ? 'Server dominates, but retained disjoint draft delta fields.'
          : 'Server strictly dominates draft. Adopting server state.',
      );

      return {
        resolvedPayload,
        action: hasDeltaField ? 'MERGED' : 'USE_SERVER',
        requiresUserInput: false,
        causalOrder,
        resolvedVectorClock: serverClock,
        fieldConflicts,
        resolutionLog,
      };
    }

    // 4. Equal Vector Clocks: States are identical
    if (causalOrder === 'equal') {
      resolutionLog.push('Clocks are identical; no divergence detected.');
      return {
        resolvedPayload: { ...currentServerState.payload },
        action: 'USE_SERVER',
        requiresUserInput: false,
        causalOrder,
        resolvedVectorClock: serverClock,
        fieldConflicts,
        resolutionLog,
      };
    }

    // 5. Concurrent Divergence (Draft || Server): CRDT Field Resolution
    resolutionLog.push(
      'Concurrent divergence detected. Applying CRDT LWW register, Add-Wins set union, and schedule authority.',
    );

    const mergedClock = this.mergeVectorClocks(
      draftClock,
      serverClock,
      this.localNodeId,
    );
    const resolvedPayload = { ...currentServerState.payload };
    let hasMerged = false;
    let criticalConflictDetected = false;

    const allFieldKeys = new Set([
      ...Object.keys(currentServerState.payload),
      ...Object.keys(draft.payload),
    ]);

    const draftTime = draft.timestamp || 0;
    const serverTime = currentServerState.updatedAt || 0;
    const draftLamport = CrdtVectorClock.getLamportTime(draftClock);
    const serverLamport = CrdtVectorClock.getLamportTime(serverClock);

    for (const key of allFieldKeys) {
      const serverVal = currentServerState.payload[key];
      const draftVal = draft.payload[key];

      // Field only present in server
      if (draftVal === undefined) {
        resolvedPayload[key] = serverVal;
        continue;
      }

      // Field only present in draft
      if (serverVal === undefined) {
        resolvedPayload[key] = draftVal;
        hasMerged = true;
        fieldConflicts.push({
          field: key,
          serverValue: undefined,
          draftValue: draftVal,
          resolvedValue: draftVal,
          strategy: 'LWW_DRAFT',
          reason: 'Added new field introduced by offline draft.',
        });
        continue;
      }

      // Values are identical across both states
      if (isDeepEqual(serverVal, draftVal)) {
        resolvedPayload[key] = draftVal;
        continue;
      }

      // CONFLICT: Values differ for key
      // Check A: Critical booking parameter conflict (capacity, schedule, venue)
      if (CRITICAL_BOOKING_FIELDS.includes(key)) {
        criticalConflictDetected = true;
        resolvedPayload[key] = serverVal;
        fieldConflicts.push({
          field: key,
          serverValue: serverVal,
          draftValue: draftVal,
          resolvedValue: serverVal,
          strategy: 'SERVER_AUTHORITY',
          reason: `Critical booking field '${key}' conflicted concurrently; server authority preserved to prevent scheduling collision.`,
        });
        resolutionLog.push(
          `Critical field conflict on '${key}': Server authority enforced.`,
        );
        continue;
      }

      // Check B: Additive collection / Set field (OR-Set / Add-Wins union)
      if (
        ADDITIVE_SET_FIELDS.includes(key) &&
        Array.isArray(serverVal) &&
        Array.isArray(draftVal)
      ) {
        const unionArray = mergeSetUnion(serverVal, draftVal);
        resolvedPayload[key] = unionArray;
        hasMerged = true;
        fieldConflicts.push({
          field: key,
          serverValue: serverVal,
          draftValue: draftVal,
          resolvedValue: unionArray,
          strategy: 'SET_UNION',
          reason: `Unified additive collection items for '${key}'.`,
        });
        resolutionLog.push(
          `Set union applied for '${key}': ${unionArray.length} items merged.`,
        );
        continue;
      }

      // Check C: Field-level Last-Write-Wins (LWW) Register with Lamport tie-breaking
      const draftWins =
        draftTime !== serverTime
          ? draftTime > serverTime
          : draftLamport !== serverLamport
            ? draftLamport > serverLamport
            : (draft.nodeId || 'draft') >=
              (currentServerState.nodeId || 'server');

      if (draftWins) {
        resolvedPayload[key] = draftVal;
        hasMerged = true;
        fieldConflicts.push({
          field: key,
          serverValue: serverVal,
          draftValue: draftVal,
          resolvedValue: draftVal,
          strategy: 'LWW_DRAFT',
          reason: `Field '${key}' resolved to draft via LWW register (Draft time/Lamport: ${draftTime}/${draftLamport} >= Server: ${serverTime}/${serverLamport}).`,
        });
      } else {
        resolvedPayload[key] = serverVal;
        fieldConflicts.push({
          field: key,
          serverValue: serverVal,
          draftValue: draftVal,
          resolvedValue: serverVal,
          strategy: 'LWW_SERVER',
          reason: `Field '${key}' resolved to server via LWW register (Server time/Lamport: ${serverTime}/${serverLamport} > Draft: ${draftTime}/${draftLamport}).`,
        });
      }
    }

    if (criticalConflictDetected) {
      return {
        resolvedPayload,
        action: 'USE_SERVER',
        requiresUserInput: true,
        causalOrder,
        resolvedVectorClock: mergedClock,
        fieldConflicts,
        resolutionLog,
      };
    }

    return {
      resolvedPayload,
      action: hasMerged ? 'MERGED' : 'USE_SERVER',
      requiresUserInput: false,
      causalOrder,
      resolvedVectorClock: mergedClock,
      fieldConflicts,
      resolutionLog,
    };
  }
}

