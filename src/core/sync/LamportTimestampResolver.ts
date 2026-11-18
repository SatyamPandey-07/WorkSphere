import { ClockMap, VectorClock } from './VectorClock';

export interface MutationPayload<T = any> {
  id: string;
  entityId: string;
  data: T;
  clock: ClockMap;
  lamportTs: number;
  nodeId: string;
}

/**
 * Contains the deterministic merge logic to resolve conflicting 
 * concurrent edits across multiple offline devices.
 */
export class LamportTimestampResolver {
  
  /**
   * Resolves a conflict between two concurrent mutations.
   * Strategy: Highest Lamport timestamp wins. 
   * Tie-breaker: Lexicographical comparison of Node IDs.
   */
  public static resolveConflict<T>(
    mutationA: MutationPayload<T>, 
    mutationB: MutationPayload<T>
  ): MutationPayload<T> {
    if (mutationA.lamportTs > mutationB.lamportTs) {
      return mutationA;
    }
    if (mutationB.lamportTs > mutationA.lamportTs) {
      return mutationB;
    }
    
    // Tie-breaker: deterministic node ID comparison
    return mutationA.nodeId > mutationB.nodeId ? mutationA : mutationB;
  }

  /**
   * Replays a queue of offline mutations against a base state, 
   * resolving conflicts using Vector Clocks and Lamport timestamps.
   */
  public static replayMutations<T>(
    baseState: Record<string, T>,
    baseClock: ClockMap,
    mutations: MutationPayload<T>[],
    localNodeId: string
  ): { state: Record<string, T>; clock: ClockMap } {
    
    const vectorClock = new VectorClock(localNodeId, baseClock);
    const currentState = { ...baseState };
    
    // Sort mutations by Lamport timestamp to ensure deterministic replay order
    const sortedMutations = [...mutations].sort((a, b) => {
      if (a.lamportTs !== b.lamportTs) return a.lamportTs - b.lamportTs;
      return a.nodeId.localeCompare(b.nodeId);
    });

    for (const mutation of sortedMutations) {
      const entityId = mutation.entityId;
      
      // Merge the incoming clock
      vectorClock.merge(mutation.clock);

      // If the entity doesn't exist yet, just apply it
      if (!currentState[entityId]) {
        currentState[entityId] = mutation.data;
        continue;
      }

      // Conflict resolution for existing entities
      // In a full CRDT system, we would merge the data structures.
      // Here we use Last-Writer-Wins (LWW) based on Lamport timestamps.
      const existingMutation: MutationPayload<T> = {
        id: 'existing',
        entityId,
        data: currentState[entityId],
        clock: baseClock, // Simplified for LWW
        lamportTs: 0,    // Base state has lowest priority
        nodeId: 'server',
      };

      const winner = this.resolveConflict(mutation, existingMutation);
      currentState[entityId] = winner.data;
    }

    return { state: currentState, clock: vectorClock.getClock() };
  }
}
