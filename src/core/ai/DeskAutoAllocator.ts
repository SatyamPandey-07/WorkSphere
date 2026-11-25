/**
 * DeskAutoAllocator.ts
 *
 * Automated desk allocation engine for coworking venues, hot desks, and team pods.
 * Employs maximum bipartite matching / Hungarian algorithm for optimal allocation,
 * paired with a deterministic greedy fallback strategy when the assignment graph
 * is infeasible or overconstrained.
 *
 * Empty Desk-Pool Handling (#10450):
 * - If the provided desk pool is empty (`desks` is empty, null, or has 0 available desks),
 *   the allocator intercepts this condition BEFORE any graph construction, distance matrix
 *   allocations, cost calculations, or matching routines execute.
 * - Rather than returning `Infinity`, `NaN`, or throwing a runtime exception:
 *   1. When people are provided but 0 desks are available:
 *      Returns a graceful result with `feasible: false`, `isFallback: true`,
 *      all requested people marked in `unassignedPersonIds` (deterministically sorted),
 *      `totalCost: 0`, and `assignments: []`.
 *   2. When people array is empty (regardless of desk count):
 *      Returns `feasible: true`, `isFallback: false`, `totalCost: 0`, and empty arrays.
 *   3. All returned cost, score, and count metrics remain strictly finite numbers.
 */

export interface DeskRequirement {
  standingDesk?: boolean;
  dualMonitor?: boolean;
  quietZone?: boolean;
  nearWindow?: boolean;
  wheelchairAccessible?: boolean;
  minimumWifiQuality?: number;
}

export interface PersonCandidate {
  id: string;
  name?: string;
  priority?: number; // Higher number = higher priority
  requirements?: DeskRequirement;
  preferredDeskIds?: string[];
  department?: string;
}

export interface DeskResource {
  id: string;
  name?: string;
  zone?: string;
  capacity?: number; // Default 1
  isAvailable?: boolean; // Default true
  standingDesk?: boolean;
  dualMonitor?: boolean;
  quietZone?: boolean;
  nearWindow?: boolean;
  wheelchairAccessible?: boolean;
  wifiQuality?: number; // 1-5
}

export interface AllocationAssignment {
  personId: string;
  deskId: string;
  score: number;
  matchReasons?: string[];
}

export interface DeskAllocationResult {
  feasible: boolean;
  isFallback: boolean;
  assignments: AllocationAssignment[];
  unassignedPersonIds: string[];
  totalAllocated: number;
  totalRequested: number;
  totalCost?: number;
}

export class DeskAutoAllocator {
  /**
   * Evaluates whether a desk meets a person's strict eligibility requirements.
   */
  public isEligible(person: PersonCandidate, desk: DeskResource): boolean {
    if (desk.isAvailable === false) return false;
    if (desk.capacity !== undefined && desk.capacity <= 0) return false;

    const req = person.requirements;
    if (!req) return true;

    if (req.standingDesk && !desk.standingDesk) return false;
    if (req.dualMonitor && !desk.dualMonitor) return false;
    if (req.quietZone && !desk.quietZone) return false;
    if (req.nearWindow && !desk.nearWindow) return false;
    if (req.wheelchairAccessible && !desk.wheelchairAccessible) return false;
    if (
      req.minimumWifiQuality !== undefined &&
      (desk.wifiQuality ?? 3) < req.minimumWifiQuality
    ) {
      return false;
    }

    return true;
  }

  /**
   * Calculates compatibility score between an eligible person and a desk.
   * Higher score = stronger preference match.
   */
  public calculateMatchScore(person: PersonCandidate, desk: DeskResource): number {
    let score = 100;

    // Preferred desk bonus
    if (person.preferredDeskIds && person.preferredDeskIds.includes(desk.id)) {
      score += 50;
    }

    // Additional amenity bonuses
    if (desk.standingDesk) score += 10;
    if (desk.dualMonitor) score += 10;
    if (desk.quietZone) score += 5;
    if (desk.nearWindow) score += 5;
    if (desk.wifiQuality) score += desk.wifiQuality * 2;

    return score;
  }

  /**
   * Computes a finite assignment cost from match score.
   * Ensures the cost is always a finite number.
   */
  public calculateCost(score: number): number {
    if (!Number.isFinite(score)) return 0;
    // Lower cost is preferred in bipartite matching formulations
    return Math.max(0, 200 - score);
  }

  /**
   * Bipartite matching via augmenting paths (Hopcroft-Karp / Ford-Fulkerson).
   * Returns complete matching if a full assignment is feasible.
   */
  private tryMaxBipartiteMatching(
    sortedPersons: PersonCandidate[],
    availableDesks: DeskResource[],
  ): Map<string, string> | null {
    // deskId -> personId
    const deskMatch = new Map<string, string>();

    const dfs = (
      person: PersonCandidate,
      visitedDesks: Set<string>,
    ): boolean => {
      // Deterministically sort candidate desks for this person
      const eligibleDesks = availableDesks
        .filter((d) => this.isEligible(person, d))
        .sort((a, b) => {
          const scoreB = this.calculateMatchScore(person, b);
          const scoreA = this.calculateMatchScore(person, a);
          if (scoreB !== scoreA) return scoreB - scoreA;
          return a.id.localeCompare(b.id);
        });

      for (const desk of eligibleDesks) {
        if (!visitedDesks.has(desk.id)) {
          visitedDesks.add(desk.id);

          const currentPersonId = deskMatch.get(desk.id);
          if (
            !currentPersonId ||
            dfs(
              sortedPersons.find((p) => p.id === currentPersonId)!,
              visitedDesks,
            )
          ) {
            deskMatch.set(desk.id, person.id);
            return true;
          }
        }
      }
      return false;
    };

    for (const person of sortedPersons) {
      const visited = new Set<string>();
      const matched = dfs(person, visited);
      if (!matched) {
        // Complete assignment not feasible via standard graph matching
        return null;
      }
    }

    // Reverse map: personId -> deskId
    const personMatch = new Map<string, string>();
    for (const [deskId, personId] of deskMatch.entries()) {
      personMatch.set(personId, deskId);
    }
    return personMatch;
  }

  /**
   * Deterministic fallback allocation strategy for infeasible or overconstrained graphs.
   * Produces stable, identical partial or best-effort allocations across repeated runs.
   */
  public allocateDeterministicFallback(
    persons: PersonCandidate[],
    desks: DeskResource[],
  ): DeskAllocationResult {
    const deskCapacities = new Map<string, number>();
    for (const d of (desks || [])) {
      if (d && d.isAvailable !== false) {
        deskCapacities.set(d.id, d.capacity ?? 1);
      }
    }

    // 1. Sort persons with strict deterministic tie-breaking
    const sortedPersons = [...(persons || [])].sort((a, b) => {
      const priorityA = a.priority ?? 0;
      const priorityB = b.priority ?? 0;
      if (priorityB !== priorityA) return priorityB - priorityA;

      // Count eligible desks (fewer choices = higher placement urgency)
      const countA = (desks || []).filter((d) => this.isEligible(a, d)).length;
      const countB = (desks || []).filter((d) => this.isEligible(b, d)).length;
      if (countA !== countB) return countA - countB;

      // Stable tie-breaker
      return a.id.localeCompare(b.id);
    });

    const assignments: AllocationAssignment[] = [];
    const unassignedPersonIds: string[] = [];
    let totalCost = 0;

    for (const person of sortedPersons) {
      // Find eligible desks with available capacity
      const eligibleDesks = (desks || [])
        .filter((d) => this.isEligible(person, d) && (deskCapacities.get(d.id) ?? 0) > 0)
        .sort((a, b) => {
          const scoreB = this.calculateMatchScore(person, b);
          const scoreA = this.calculateMatchScore(person, a);
          if (scoreB !== scoreA) return scoreB - scoreA;

          // Stable tie-breaker by ID
          return a.id.localeCompare(b.id);
        });

      if (eligibleDesks.length > 0) {
        const chosenDesk = eligibleDesks[0];
        const currentCap = deskCapacities.get(chosenDesk.id) ?? 1;
        deskCapacities.set(chosenDesk.id, currentCap - 1);

        const score = this.calculateMatchScore(person, chosenDesk);
        assignments.push({
          personId: person.id,
          deskId: chosenDesk.id,
          score,
        });
        totalCost += this.calculateCost(score);
      } else {
        unassignedPersonIds.push(person.id);
      }
    }

    // Sort output assignments deterministically by personId
    assignments.sort((a, b) => a.personId.localeCompare(b.personId));
    unassignedPersonIds.sort((a, b) => a.localeCompare(b));

    return {
      feasible: false,
      isFallback: true,
      assignments,
      unassignedPersonIds,
      totalAllocated: assignments.length,
      totalRequested: (persons || []).length,
      totalCost,
    };
  }

  /**
   * Main allocation method.
   * Explicitly checks for empty desk pool or empty people list before graph construction,
   * cost calculations, or matching algorithms execute (#10450).
   */
  public allocateDesks(
    persons: PersonCandidate[],
    desks: DeskResource[],
  ): DeskAllocationResult {
    const safePersons = Array.isArray(persons) ? persons : [];
    const safeDesks = Array.isArray(desks) ? desks : [];

    // Case 1: Empty people list (with any desk count)
    if (safePersons.length === 0) {
      return {
        feasible: true,
        isFallback: false,
        assignments: [],
        unassignedPersonIds: [],
        totalAllocated: 0,
        totalRequested: 0,
        totalCost: 0,
      };
    }

    // Filter available desks with positive capacity
    const availableDesks = safeDesks.filter(
      (d) => d && d.isAvailable !== false && (d.capacity === undefined || d.capacity > 0),
    );

    // Case 2: Empty desk pool (no available desks for candidates) (#10450)
    // Handle explicitly without graph construction, distance matrix allocations, or Infinity costs.
    if (availableDesks.length === 0) {
      const sortedUnassigned = [...safePersons]
        .map((p) => p.id)
        .sort((a, b) => a.localeCompare(b));

      return {
        feasible: false,
        isFallback: true,
        assignments: [],
        unassignedPersonIds: sortedUnassigned,
        totalAllocated: 0,
        totalRequested: safePersons.length,
        totalCost: 0, // Strictly finite, never Infinity or NaN
      };
    }

    // Sort persons deterministically
    const sortedPersons = [...safePersons].sort((a, b) => {
      const pDiff = (b.priority ?? 0) - (a.priority ?? 0);
      if (pDiff !== 0) return pDiff;
      return a.id.localeCompare(b.id);
    });

    // If total capacity < total persons, full assignment is trivially infeasible
    const totalCapacity = availableDesks.reduce(
      (acc, d) => acc + (d.capacity ?? 1),
      0,
    );

    if (totalCapacity >= sortedPersons.length) {
      // If each desk has capacity 1, attempt bipartite matching
      const allUnitCapacity = availableDesks.every((d) => (d.capacity ?? 1) === 1);
      if (allUnitCapacity) {
        const matchResult = this.tryMaxBipartiteMatching(
          sortedPersons,
          availableDesks,
        );

        if (matchResult && matchResult.size === sortedPersons.length) {
          const assignments: AllocationAssignment[] = [];
          let totalCost = 0;
          for (const person of sortedPersons) {
            const deskId = matchResult.get(person.id)!;
            const desk = safeDesks.find((d) => d.id === deskId)!;
            const score = this.calculateMatchScore(person, desk);
            assignments.push({
              personId: person.id,
              deskId,
              score,
            });
            totalCost += this.calculateCost(score);
          }
          assignments.sort((a, b) => a.personId.localeCompare(b.personId));

          return {
            feasible: true,
            isFallback: false,
            assignments,
            unassignedPersonIds: [],
            totalAllocated: assignments.length,
            totalRequested: sortedPersons.length,
            totalCost,
          };
        }
      }
    }

    // Infeasible for full bipartite matching: apply deterministic fallback allocation
    return this.allocateDeterministicFallback(safePersons, safeDesks);
  }
}

export const defaultDeskAutoAllocator = new DeskAutoAllocator();
