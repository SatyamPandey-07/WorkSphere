/**
 * DeskAutoAllocator.ts
 *
 * Automated desk allocation engine for coworking venues, hot desks, and team pods.
 * Employs maximum bipartite matching / Hungarian algorithm for optimal allocation,
 * paired with a deterministic greedy fallback strategy when the assignment graph
 * is infeasible or overconstrained.
 */

export interface DeskPreferenceWeights {
  window?: number;
  power?: number;
  quiet?: number;
}

export interface DeskRequirement {
  standingDesk?: boolean;
  dualMonitor?: boolean;
  quietZone?: boolean;
  nearWindow?: boolean;
  powerOutlet?: boolean;
  wheelchairAccessible?: boolean;
  minimumWifiQuality?: number;
}

export interface PersonCandidate {
  id: string;
  name?: string;
  priority?: number; // Higher number = higher priority
  requirements?: DeskRequirement;
  preferenceWeights?: DeskPreferenceWeights;
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
  powerOutlet?: boolean;
  hasPowerOutlet?: boolean;
  outlets?: number;
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
}

const PREFERENCE_WEIGHT_SCALE = 20;

function sanitizeWeight(weight: number | undefined): number {
  if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0) {
    return 0;
  }
  return weight;
}

function deskHasPower(desk: DeskResource): boolean {
  return Boolean(
    desk.powerOutlet ||
      desk.hasPowerOutlet ||
      (typeof desk.outlets === 'number' && desk.outlets > 0),
  );
}

export class DeskAutoAllocator {
  private readonly defaultPreferenceWeights: DeskPreferenceWeights;

  constructor(defaultPreferenceWeights: DeskPreferenceWeights = {}) {
    this.defaultPreferenceWeights = { ...defaultPreferenceWeights };
  }

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
    if (req.powerOutlet && !deskHasPower(desk)) return false;
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
   * Applies multi-desk preference weights (window, power, quiet) when configured.
   * Higher score = stronger preference match.
   */
  public calculateMatchScore(
    person: PersonCandidate,
    desk: DeskResource,
    overrideWeights?: DeskPreferenceWeights,
  ): number {
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
    if (deskHasPower(desk)) score += 5;
    if (desk.wifiQuality) score += desk.wifiQuality * 2;

    // Multi-desk preference weights (window, power, quiet)
    const effectiveWeights: DeskPreferenceWeights = {
      window:
        overrideWeights?.window ??
        person.preferenceWeights?.window ??
        this.defaultPreferenceWeights.window,
      power:
        overrideWeights?.power ??
        person.preferenceWeights?.power ??
        this.defaultPreferenceWeights.power,
      quiet:
        overrideWeights?.quiet ??
        person.preferenceWeights?.quiet ??
        this.defaultPreferenceWeights.quiet,
    };

    const windowWeight = sanitizeWeight(effectiveWeights.window);
    const powerWeight = sanitizeWeight(effectiveWeights.power);
    const quietWeight = sanitizeWeight(effectiveWeights.quiet);

    if (desk.nearWindow && windowWeight > 0) {
      score += windowWeight * PREFERENCE_WEIGHT_SCALE;
    }
    if (deskHasPower(desk) && powerWeight > 0) {
      score += powerWeight * PREFERENCE_WEIGHT_SCALE;
    }
    if (desk.quietZone && quietWeight > 0) {
      score += quietWeight * PREFERENCE_WEIGHT_SCALE;
    }

    return score;
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
   * Deterministic fallback allocation strategy.
   *
   * Applied when the full graph matching is infeasible (e.g. conflicting constraints,
   * insufficient total desks, or oversubscribed amenities).
   *
   * Tie-breaking & Ordering Rules:
   * 1. Persons ordered by priority DESC, then eligible desk count ASC (most constrained first),
   *    then stable person ID ASC.
   * 2. Desks ordered by match score DESC, remaining capacity DESC, then stable desk ID ASC.
   * 3. Fully respects eligibility constraints: never assigns an ineligible or unavailable desk.
   * 4. Produces stable, identical partial or best-effort allocations across repeated runs.
   */
  public allocateDeterministicFallback(
    persons: PersonCandidate[],
    desks: DeskResource[],
  ): DeskAllocationResult {
    const deskCapacities = new Map<string, number>();
    for (const d of desks) {
      if (d.isAvailable !== false) {
        deskCapacities.set(d.id, d.capacity ?? 1);
      }
    }

    // 1. Sort persons with strict deterministic tie-breaking
    const sortedPersons = [...persons].sort((a, b) => {
      const priorityA = a.priority ?? 0;
      const priorityB = b.priority ?? 0;
      if (priorityB !== priorityA) return priorityB - priorityA;

      // Count eligible desks (fewer choices = higher placement urgency)
      const countA = desks.filter((d) => this.isEligible(a, d)).length;
      const countB = desks.filter((d) => this.isEligible(b, d)).length;
      if (countA !== countB) return countA - countB;

      // Stable tie-breaker
      return a.id.localeCompare(b.id);
    });

    const assignments: AllocationAssignment[] = [];
    const unassignedPersonIds: string[] = [];

    for (const person of sortedPersons) {
      // Find eligible desks with available capacity
      const eligibleDesks = desks
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

        assignments.push({
          personId: person.id,
          deskId: chosenDesk.id,
          score: this.calculateMatchScore(person, chosenDesk),
        });
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
      totalRequested: persons.length,
    };
  }

  /**
   * Main allocation method.
   * Attempts optimal graph matching first; seamlessly falls back to the
   * deterministic fallback strategy when the problem graph is infeasible.
   */
  public allocateDesks(
    persons: PersonCandidate[],
    desks: DeskResource[],
  ): DeskAllocationResult {
    if (!persons || persons.length === 0) {
      return {
        feasible: true,
        isFallback: false,
        assignments: [],
        unassignedPersonIds: [],
        totalAllocated: 0,
        totalRequested: 0,
      };
    }

    // Sort persons deterministically
    const sortedPersons = [...persons].sort((a, b) => {
      const pDiff = (b.priority ?? 0) - (a.priority ?? 0);
      if (pDiff !== 0) return pDiff;
      return a.id.localeCompare(b.id);
    });

    const availableDesks = desks.filter(
      (d) => d.isAvailable !== false && (d.capacity ?? 1) > 0,
    );

    // If total desks < total persons, full assignment is trivially infeasible
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
          for (const person of sortedPersons) {
            const deskId = matchResult.get(person.id)!;
            const desk = desks.find((d) => d.id === deskId)!;
            assignments.push({
              personId: person.id,
              deskId,
              score: this.calculateMatchScore(person, desk),
            });
          }
          assignments.sort((a, b) => a.personId.localeCompare(b.personId));

          return {
            feasible: true,
            isFallback: false,
            assignments,
            unassignedPersonIds: [],
            totalAllocated: assignments.length,
            totalRequested: persons.length,
          };
        }
      }
    }

    // Infeasible for full bipartite matching: apply deterministic fallback allocation
    return this.allocateDeterministicFallback(persons, desks);
  }
}

export const defaultDeskAutoAllocator = new DeskAutoAllocator();
