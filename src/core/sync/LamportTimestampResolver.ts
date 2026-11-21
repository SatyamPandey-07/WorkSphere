import { compareHLC, type HLCState } from "./HybridLogicalClock";
import { ClockMap, VectorClock } from "./VectorClock";

export interface MutationPayload<T = any> {
  id: string;
  entityId: string;
  data: T;
  clock: ClockMap;
  lamportTs: number;
  /** Optional Hybrid Logical Clock stamp for deterministic concurrent-edit ordering. */
  hlc?: HLCState;
  nodeId: string;
}

function compareMutations<T>(
  mutationA: MutationPayload<T>,
  mutationB: MutationPayload<T>,
): number {
  const causalOrder = new VectorClock(
    mutationA.nodeId,
    mutationA.clock,
  ).compareTo(mutationB.clock);

  // Causal ancestry always wins over wall-clock-derived ordering.
  if (causalOrder === "AFTER") return 1;
  if (causalOrder === "BEFORE") return -1;

  // Concurrent or identical vectors need a stable total-order tie-break.
  if (mutationA.hlc && mutationB.hlc) {
    const hlcOrder = compareHLC(mutationA.hlc, mutationB.hlc);
    if (hlcOrder !== 0) return hlcOrder;
  }

  // Backward-compatible fallback for older queued mutations without HLC stamps.
  if (mutationA.lamportTs !== mutationB.lamportTs) {
    return mutationA.lamportTs < mutationB.lamportTs ? -1 : 1;
  }

  const nodeOrder = mutationA.nodeId.localeCompare(mutationB.nodeId);
  if (nodeOrder !== 0) return nodeOrder;
  return mutationA.id.localeCompare(mutationB.id);
}

/**
 * Resolves offline mutations using causal history first, then HLC ordering for
 * concurrent/equal versions, with legacy Lamport and node-ID fallbacks.
 */
export class LamportTimestampResolver {
  /**
   * Resolves two versions of the same entity.
   *
   * A causally newer vector always wins. For concurrent or identical vectors,
   * the larger HLC stamp wins; legacy mutations without HLC use lamportTs and
   * finally a stable node/id comparison.
   */
  public static resolveConflict<T>(
    mutationA: MutationPayload<T>,
    mutationB: MutationPayload<T>,
  ): MutationPayload<T> {
    return compareMutations(mutationA, mutationB) >= 0
      ? mutationA
      : mutationB;
  }

  /**
   * Replays a queue of offline mutations against a base state. The final state
   * is selected per entity using causal order before deterministic HLC fallback.
   */
  public static replayMutations<T>(
    baseState: Record<string, T>,
    baseClock: ClockMap,
    mutations: MutationPayload<T>[],
    localNodeId: string,
  ): { state: Record<string, T>; clock: ClockMap } {
    const vectorClock = new VectorClock(localNodeId, baseClock);
    const currentState = { ...baseState };
    const winningMutations = new Map<string, MutationPayload<T>>();

    const sortedMutations = [...mutations].sort(compareMutations);

    for (const mutation of sortedMutations) {
      vectorClock.merge(mutation.clock);
      const entityId = mutation.entityId;

      const existingMutation = winningMutations.get(entityId) ?? {
        id: `base:${entityId}`,
        entityId,
        data: currentState[entityId],
        clock: baseClock,
        lamportTs: 0,
        nodeId: "server",
      };

      const hasExistingValue = Object.prototype.hasOwnProperty.call(
        currentState,
        entityId,
      );
      if (!hasExistingValue) {
        currentState[entityId] = mutation.data;
        winningMutations.set(entityId, mutation);
        continue;
      }

      const winner = this.resolveConflict(mutation, existingMutation);
      if (winner === mutation) {
        currentState[entityId] = mutation.data;
        winningMutations.set(entityId, mutation);
      }
    }

    return { state: currentState, clock: vectorClock.getClock() };
  }
}
