/**
 * SeatingNegotiator.ts
 * Autonomous group seating negotiation protocol for nomad concierge agents (#6469).
 *
 * Implements a 3-round concession protocol reconciling conflicting desk preferences
 * (power proximity, natural window light, quiet zones, standing desks, peer clustering)
 * to converge on Pareto-optimal contiguous cluster seating assignments.
 */

export interface Seat {
  id: string;
  label?: string;
  x: number;
  y: number;
  hasPower: boolean;
  hasWindowLight: boolean;
  isQuietZone: boolean;
  isStandingDesk?: boolean;
}

export interface PreferenceWeights {
  powerProximity: number; // 0.0 to 1.0
  windowLight: number; // 0.0 to 1.0
  quietZone: number; // 0.0 to 1.0
  standingDesk?: number; // 0.0 to 1.0
  groupClustering: number; // Weight on physical proximity to fellow group members
}

export interface NomadAgent {
  agentId: string;
  name: string;
  preferences: PreferenceWeights;
  concessionRate?: number; // Concession factor per round (default: 0.20)
}

export interface AgentProposal {
  agentId: string;
  preferredSeatId: string;
  utility: number;
  preferenceVector: PreferenceWeights;
}

export interface NegotiationRound {
  roundNumber: number;
  proposals: AgentProposal[];
  conflictsDetected: string[]; // Seat IDs claimed by multiple agents
  concessionsApplied: Record<string, Partial<PreferenceWeights>>;
  converged: boolean;
}

export interface NegotiationResult {
  totalRounds: number;
  converged: boolean;
  assignments: Record<string, string>; // agentId -> seatId
  assignedSeats: Record<string, Seat>; // agentId -> Seat
  individualUtilities: Record<string, number>;
  averageUtility: number;
  socialWelfare: number;
  rounds: NegotiationRound[];
  clusterMetrics: {
    centroid: { x: number; y: number };
    maxInterSeatDistance: number;
    averagePeerDistance: number;
  };
}

export interface SeatingNegotiatorOptions {
  maxRounds?: number; // Default: 3
  defaultConcessionRate?: number; // Default: 0.20
  clusteringBonusMultiplier?: number;
}

export class SeatingNegotiator {
  private maxRounds: number;
  private defaultConcessionRate: number;

  constructor(options: SeatingNegotiatorOptions = {}) {
    this.maxRounds = options.maxRounds ?? 3;
    this.defaultConcessionRate = options.defaultConcessionRate ?? 0.2;
  }

  /**
   * Calculates the utility of a seat assignment for a specific agent,
   * taking into account individual feature weights and proximity to the group cluster.
   */
  public calculateUtility(
    agent: NomadAgent,
    seat: Seat,
    groupSeats: Seat[] = [],
    weightsOverride?: PreferenceWeights,
  ): number {
    const weights = weightsOverride ?? agent.preferences;

    let score = 0;
    let totalWeight = 0;

    // 1. Power outlet proximity (0 or 1)
    if (weights.powerProximity > 0) {
      score += (seat.hasPower ? 1.0 : 0.0) * weights.powerProximity;
      totalWeight += weights.powerProximity;
    }

    // 2. Natural window light (0 or 1)
    if (weights.windowLight > 0) {
      score += (seat.hasWindowLight ? 1.0 : 0.0) * weights.windowLight;
      totalWeight += weights.windowLight;
    }

    // 3. Quiet zone preference (0 or 1)
    if (weights.quietZone > 0) {
      score += (seat.isQuietZone ? 1.0 : 0.0) * weights.quietZone;
      totalWeight += weights.quietZone;
    }

    // 4. Standing desk preference
    if (weights.standingDesk && weights.standingDesk > 0) {
      score += (seat.isStandingDesk ? 1.0 : 0.0) * weights.standingDesk;
      totalWeight += weights.standingDesk;
    }

    // 5. Contiguous group clustering score (normalized inverse distance)
    if (weights.groupClustering > 0 && groupSeats.length > 0) {
      let totalDist = 0;
      let peerCount = 0;
      for (const peerSeat of groupSeats) {
        if (peerSeat.id !== seat.id) {
          const dx = peerSeat.x - seat.x;
          const dy = peerSeat.y - seat.y;
          totalDist += Math.sqrt(dx * dx + dy * dy);
          peerCount++;
        }
      }

      if (peerCount > 0) {
        const avgDist = totalDist / peerCount;
        // Exponential decay: adjacent desks (<1.5m) score ~1.0; far desks (>10m) score ~0.1
        const clusterScore = Math.exp(-avgDist / 4.0);
        score += clusterScore * weights.groupClustering;
        totalWeight += weights.groupClustering;
      }
    }

    return totalWeight > 0 ? Math.round((score / totalWeight) * 1000) / 1000 : 0;
  }

  /**
   * Executes the 3-round concession negotiation protocol between agents to converge
   * on a Pareto-optimal contiguous cluster seating arrangement.
   */
  public negotiate(
    availableSeats: Seat[],
    agents: NomadAgent[],
  ): NegotiationResult {
    if (agents.length === 0 || availableSeats.length === 0) {
      throw new Error("Cannot negotiate seating without agents and seats");
    }

    if (availableSeats.length < agents.length) {
      throw new Error("Insufficient available seats for agent group size");
    }

    const rounds: NegotiationRound[] = [];
    const activeWeights: Map<string, PreferenceWeights> = new Map();

    // Initialize agent preference weights
    for (const agent of agents) {
      activeWeights.set(agent.agentId, { ...agent.preferences });
    }

    let converged = false;
    let finalPermutation: { assignments: Record<string, Seat>; score: number } | null = null;

    for (let roundNum = 1; roundNum <= this.maxRounds; roundNum++) {
      const proposals: AgentProposal[] = [];
      const claimedSeatMap = new Map<string, string[]>(); // seatId -> agentIds

      // 1. Each agent evaluates optimal standalone seat based on current round weights
      for (const agent of agents) {
        const currentWeights = activeWeights.get(agent.agentId)!;
        let bestSeat = availableSeats[0];
        let maxUtil = -1;

        for (const seat of availableSeats) {
          const util = this.calculateUtility(agent, seat, [], currentWeights);
          if (util > maxUtil) {
            maxUtil = util;
            bestSeat = seat;
          }
        }

        proposals.push({
          agentId: agent.agentId,
          preferredSeatId: bestSeat.id,
          utility: maxUtil,
          preferenceVector: { ...currentWeights },
        });

        if (!claimedSeatMap.has(bestSeat.id)) {
          claimedSeatMap.set(bestSeat.id, []);
        }
        claimedSeatMap.get(bestSeat.id)!.push(agent.agentId);
      }

      // Check for conflicts (multiple agents demanding the same seat)
      const conflictsDetected: string[] = [];
      for (const [seatId, claimerIds] of claimedSeatMap.entries()) {
        if (claimerIds.length > 1) {
          conflictsDetected.push(seatId);
        }
      }

      const concessionsApplied: Record<string, Partial<PreferenceWeights>> = {};

      if (conflictsDetected.length === 0) {
        // Zero conflict: instant natural convergence in current round
        converged = true;
      } else if (roundNum < this.maxRounds) {
        // Concession step: agents concede on secondary preferences
        for (const agent of agents) {
          const currentWeights = activeWeights.get(agent.agentId)!;
          const rate = agent.concessionRate ?? this.defaultConcessionRate;

          // Relax individual non-dominant weights while increasing clustering cooperativeness
          const conceded: PreferenceWeights = {
            powerProximity: Math.max(0.1, currentWeights.powerProximity * (1 - rate * 0.5)),
            windowLight: Math.max(0.1, currentWeights.windowLight * (1 - rate * 0.5)),
            quietZone: Math.max(0.1, currentWeights.quietZone * (1 - rate * 0.5)),
            standingDesk: currentWeights.standingDesk
              ? Math.max(0.1, currentWeights.standingDesk * (1 - rate * 0.5))
              : undefined,
            groupClustering: Math.min(1.0, currentWeights.groupClustering * (1 + rate * 0.4)),
          };

          activeWeights.set(agent.agentId, conceded);
          concessionsApplied[agent.agentId] = conceded;
        }
      }

      rounds.push({
        roundNumber: roundNum,
        proposals,
        conflictsDetected,
        concessionsApplied,
        converged,
      });

      if (converged) break;
    }

    // Solve Pareto-optimal global assignment maximizing joint group utility & cluster contiguity
    finalPermutation = this.findParetoOptimalAssignment(
      availableSeats,
      agents,
      activeWeights,
    );

    const assignments: Record<string, string> = {};
    const assignedSeats: Record<string, Seat> = {};
    const individualUtilities: Record<string, number> = {};
    const seatList = Object.values(finalPermutation.assignments);

    let socialWelfare = 0;

    for (const agent of agents) {
      const assignedSeat = finalPermutation.assignments[agent.agentId];
      assignments[agent.agentId] = assignedSeat.id;
      assignedSeats[agent.agentId] = assignedSeat;

      // Calculate utility using original agent preferences
      const finalUtil = this.calculateUtility(agent, assignedSeat, seatList);
      individualUtilities[agent.agentId] = finalUtil;
      socialWelfare += finalUtil;
    }

    const averageUtility =
      Math.round((socialWelfare / agents.length) * 1000) / 1000;

    const clusterMetrics = this.computeClusterMetrics(seatList);

    return {
      totalRounds: rounds.length,
      converged: true,
      assignments,
      assignedSeats,
      individualUtilities,
      averageUtility,
      socialWelfare: Math.round(socialWelfare * 1000) / 1000,
      rounds,
      clusterMetrics,
    };
  }

  /**
   * Searches permutations to find the assignment maximizing joint utility (Social Welfare).
   */
  private findParetoOptimalAssignment(
    seats: Seat[],
    agents: NomadAgent[],
    activeWeights: Map<string, PreferenceWeights>,
  ): { assignments: Record<string, Seat>; score: number } {
    let bestScore = -Infinity;
    let bestAssignments: Record<string, Seat> = {};

    const generatePermutations = (
      agentIdx: number,
      usedSeatIds: Set<string>,
      currentAssignments: Record<string, Seat>,
    ) => {
      if (agentIdx === agents.length) {
        const assignedList = Object.values(currentAssignments);
        let jointUtility = 0;

        for (const ag of agents) {
          const s = currentAssignments[ag.agentId];
          const w = activeWeights.get(ag.agentId);
          jointUtility += this.calculateUtility(ag, s, assignedList, w);
        }

        if (jointUtility > bestScore) {
          bestScore = jointUtility;
          bestAssignments = { ...currentAssignments };
        }
        return;
      }

      const agent = agents[agentIdx];
      for (const seat of seats) {
        if (!usedSeatIds.has(seat.id)) {
          usedSeatIds.add(seat.id);
          currentAssignments[agent.agentId] = seat;

          generatePermutations(agentIdx + 1, usedSeatIds, currentAssignments);

          usedSeatIds.delete(seat.id);
          delete currentAssignments[agent.agentId];
        }
      }
    };

    generatePermutations(0, new Set(), {});

    return { assignments: bestAssignments, score: bestScore };
  }

  private computeClusterMetrics(seats: Seat[]) {
    if (seats.length === 0) {
      return {
        centroid: { x: 0, y: 0 },
        maxInterSeatDistance: 0,
        averagePeerDistance: 0,
      };
    }

    let sumX = 0;
    let sumY = 0;
    for (const s of seats) {
      sumX += s.x;
      sumY += s.y;
    }
    const centroid = {
      x: Math.round((sumX / seats.length) * 100) / 100,
      y: Math.round((sumY / seats.length) * 100) / 100,
    };

    let maxDist = 0;
    let totalDist = 0;
    let count = 0;

    for (let i = 0; i < seats.length; i++) {
      for (let j = i + 1; j < seats.length; j++) {
        const dx = seats[i].x - seats[j].x;
        const dy = seats[i].y - seats[j].y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > maxDist) maxDist = d;
        totalDist += d;
        count++;
      }
    }

    return {
      centroid,
      maxInterSeatDistance: Math.round(maxDist * 100) / 100,
      averagePeerDistance:
        count > 0 ? Math.round((totalDist / count) * 100) / 100 : 0,
    };
  }
}

export default SeatingNegotiator;
