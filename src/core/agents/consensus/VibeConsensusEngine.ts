import { VibeType } from "@/lib/venues/liveVibeTypes";

export const WEIGHTED_QUORUM_REQUIREMENT = 0.66; // 66% supermajority BFT threshold
export const VIBE_DAMPING_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const DEFAULT_OBSERVATION_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

export type ConsensusNodeType =
  | "acoustic_sensor"
  | "occupancy_sensor"
  | "ble_scanner"
  | "agent"
  | "verified_user"
  | "anonymous_user";

export const DEFAULT_NODE_WEIGHTS: Record<ConsensusNodeType, number> = {
  acoustic_sensor: 2.0,
  occupancy_sensor: 1.5,
  ble_scanner: 1.5,
  agent: 1.5,
  verified_user: 1.0,
  anonymous_user: 0.5,
};

export interface ConsensusVote {
  nodeId: string;
  nodeType: ConsensusNodeType;
  proposedVibe: VibeType;
  weight?: number;
  confidence?: number; // 0.0 - 1.0 (defaults to 1.0)
  timestamp: number;
  metadata?: {
    decibels?: number;
    headcount?: number;
    bleDensity?: number;
    [key: string]: any;
  };
}

export interface VenueVibeState {
  venueId: string;
  currentVibe: VibeType;
  lastFlippedAt: number;
}

export interface VibeConsensusResult {
  venueId: string;
  status:
    | "consensus_reached"
    | "reaffirmed_current"
    | "no_consensus"
    | "damped_time_window"
    | "insufficient_quorum";
  previousVibe: VibeType;
  currentVibe: VibeType;
  consensusVibe: VibeType | null;
  totalWeight: number;
  vibeWeightBreakdown: Record<VibeType, number>;
  vibePercentageBreakdown: Record<VibeType, number>;
  winnerPercentage: number;
  quorumMet: boolean;
  quorumThreshold: number;
  damped: boolean;
  remainingDampingMs: number;
  timestamp: number;
  participatingNodesCount: number;
}

export interface VibeConsensusOptions {
  quorumThreshold?: number;
  dampingWindowMs?: number;
  observationWindowMs?: number;
  defaultWeights?: Partial<Record<ConsensusNodeType, number>>;
}

/**
 * Pure evaluation function implementing BFT-style weighted quorum consensus for vibe shifts.
 * Enforces a 66% supermajority requirement and 15-minute time-window damping.
 */
export function resolveVibeConsensus(
  venueId: string,
  votes: ConsensusVote[],
  currentState: VenueVibeState,
  options?: VibeConsensusOptions & { currentTime?: number },
): VibeConsensusResult {
  const now = options?.currentTime ?? Date.now();
  const quorumThreshold = options?.quorumThreshold ?? WEIGHTED_QUORUM_REQUIREMENT;
  const dampingWindowMs = options?.dampingWindowMs ?? VIBE_DAMPING_WINDOW_MS;
  const observationWindowMs =
    options?.observationWindowMs ?? DEFAULT_OBSERVATION_WINDOW_MS;
  const weightsConfig = {
    ...DEFAULT_NODE_WEIGHTS,
    ...options?.defaultWeights,
  };

  const validVotes = votes.filter(
    (v) => now - v.timestamp <= observationWindowMs && v.timestamp <= now,
  );

  const vibeWeightBreakdown: Record<VibeType, number> = {
    silent_focus: 0,
    moderate_buzz: 0,
    lively: 0,
  };

  let totalWeight = 0;

  for (const vote of validVotes) {
    const baseWeight =
      vote.weight ?? weightsConfig[vote.nodeType] ?? 1.0;
    const confidence =
      typeof vote.confidence === "number" && vote.confidence >= 0 && vote.confidence <= 1
        ? vote.confidence
        : 1.0;
    const effectiveWeight = baseWeight * confidence;

    if (effectiveWeight > 0 && vote.proposedVibe in vibeWeightBreakdown) {
      vibeWeightBreakdown[vote.proposedVibe] += effectiveWeight;
      totalWeight += effectiveWeight;
    }
  }

  const vibePercentageBreakdown: Record<VibeType, number> = {
    silent_focus: 0,
    moderate_buzz: 0,
    lively: 0,
  };

  if (totalWeight > 0) {
    vibePercentageBreakdown.silent_focus =
      vibeWeightBreakdown.silent_focus / totalWeight;
    vibePercentageBreakdown.moderate_buzz =
      vibeWeightBreakdown.moderate_buzz / totalWeight;
    vibePercentageBreakdown.lively =
      vibeWeightBreakdown.lively / totalWeight;
  }

  // Find candidate with highest weighted proportion
  let winnerVibe: VibeType | null = null;
  let highestPercentage = 0;

  for (const key of ["silent_focus", "moderate_buzz", "lively"] as VibeType[]) {
    if (vibePercentageBreakdown[key] > highestPercentage) {
      highestPercentage = vibePercentageBreakdown[key];
      winnerVibe = key;
    }
  }

  const quorumMet =
    totalWeight > 0 &&
    winnerVibe !== null &&
    highestPercentage >= quorumThreshold;

  const timeSinceLastFlip = now - (currentState.lastFlippedAt || 0);
  const remainingDampingMs = Math.max(0, dampingWindowMs - timeSinceLastFlip);
  const isWithinDampingWindow = timeSinceLastFlip < dampingWindowMs;

  // Case 1: Insufficient votes or no quorum
  if (!quorumMet || !winnerVibe) {
    return {
      venueId,
      status: totalWeight === 0 ? "insufficient_quorum" : "no_consensus",
      previousVibe: currentState.currentVibe,
      currentVibe: currentState.currentVibe,
      consensusVibe: winnerVibe,
      totalWeight,
      vibeWeightBreakdown,
      vibePercentageBreakdown,
      winnerPercentage: highestPercentage,
      quorumMet: false,
      quorumThreshold,
      damped: false,
      remainingDampingMs,
      timestamp: now,
      participatingNodesCount: validVotes.length,
    };
  }

  // Case 2: Consensus reached on current vibe (reaffirmed, damping does not apply)
  if (winnerVibe === currentState.currentVibe) {
    return {
      venueId,
      status: "reaffirmed_current",
      previousVibe: currentState.currentVibe,
      currentVibe: currentState.currentVibe,
      consensusVibe: winnerVibe,
      totalWeight,
      vibeWeightBreakdown,
      vibePercentageBreakdown,
      winnerPercentage: highestPercentage,
      quorumMet: true,
      quorumThreshold,
      damped: false,
      remainingDampingMs,
      timestamp: now,
      participatingNodesCount: validVotes.length,
    };
  }

  // Case 3: Consensus reached on a different vibe, but dampened by the 15-minute window
  if (isWithinDampingWindow) {
    return {
      venueId,
      status: "damped_time_window",
      previousVibe: currentState.currentVibe,
      currentVibe: currentState.currentVibe, // preserved
      consensusVibe: winnerVibe,
      totalWeight,
      vibeWeightBreakdown,
      vibePercentageBreakdown,
      winnerPercentage: highestPercentage,
      quorumMet: true,
      quorumThreshold,
      damped: true,
      remainingDampingMs,
      timestamp: now,
      participatingNodesCount: validVotes.length,
    };
  }

  // Case 4: Consensus reached and damping window elapsed -> flip permitted
  return {
    venueId,
    status: "consensus_reached",
    previousVibe: currentState.currentVibe,
    currentVibe: winnerVibe,
    consensusVibe: winnerVibe,
    totalWeight,
    vibeWeightBreakdown,
    vibePercentageBreakdown,
    winnerPercentage: highestPercentage,
    quorumMet: true,
    quorumThreshold,
    damped: false,
    remainingDampingMs: 0,
    timestamp: now,
    participatingNodesCount: validVotes.length,
  };
}

/**
 * Stateful Multi-Agent Vibe Consensus Engine.
 * Manages active votes, venue states, 66% weighted quorum verification, and 15-minute damping.
 */
export class VibeConsensusEngine {
  private venueStates: Map<string, VenueVibeState> = new Map();
  private venueVotes: Map<string, ConsensusVote[]> = new Map();
  private options: VibeConsensusOptions;

  constructor(options?: VibeConsensusOptions) {
    this.options = {
      quorumThreshold: WEIGHTED_QUORUM_REQUIREMENT,
      dampingWindowMs: VIBE_DAMPING_WINDOW_MS,
      observationWindowMs: DEFAULT_OBSERVATION_WINDOW_MS,
      defaultWeights: DEFAULT_NODE_WEIGHTS,
      ...options,
    };
  }

  /**
   * Initializes or gets the state of a venue.
   */
  public getVenueState(venueId: string, initialVibe: VibeType = "silent_focus"): VenueVibeState {
    let state = this.venueStates.get(venueId);
    if (!state) {
      state = {
        venueId,
        currentVibe: initialVibe,
        lastFlippedAt: 0,
      };
      this.venueStates.set(venueId, state);
    }
    return { ...state };
  }

  /**
   * Updates state attributes for a venue.
   */
  public setVenueState(venueId: string, stateUpdate: Partial<VenueVibeState>): VenueVibeState {
    const existing = this.getVenueState(venueId);
    const updated: VenueVibeState = {
      ...existing,
      ...stateUpdate,
    };
    this.venueStates.set(venueId, updated);
    return { ...updated };
  }

  /**
   * Submits a consensus vote from a sensor agent or user report.
   */
  public submitVote(
    venueId: string,
    vote: Omit<ConsensusVote, "timestamp"> & { timestamp?: number },
  ): void {
    const fullVote: ConsensusVote = {
      ...vote,
      timestamp: vote.timestamp ?? Date.now(),
    };

    let votes = this.venueVotes.get(venueId);
    if (!votes) {
      votes = [];
      this.venueVotes.set(venueId, votes);
    }

    // Replace previous vote from the same node if within 5 minutes, or append
    const existingIndex = votes.findIndex(
      (v) => v.nodeId === fullVote.nodeId && Math.abs(fullVote.timestamp - v.timestamp) < 5 * 60 * 1000,
    );
    if (existingIndex >= 0) {
      votes[existingIndex] = fullVote;
    } else {
      votes.push(fullVote);
    }
  }

  /**
   * Batch submits multiple votes.
   */
  public submitVotes(
    venueId: string,
    votes: Array<Omit<ConsensusVote, "timestamp"> & { timestamp?: number }>,
  ): void {
    for (const v of votes) {
      this.submitVote(venueId, v);
    }
  }

  /**
   * Evaluates consensus across all active votes for a venue and updates status if consensus is achieved.
   */
  public evaluateConsensus(venueId: string, currentTime?: number): VibeConsensusResult {
    const now = currentTime ?? Date.now();
    const currentState = this.getVenueState(venueId);
    const votes = this.venueVotes.get(venueId) || [];

    const result = resolveVibeConsensus(venueId, votes, currentState, {
      ...this.options,
      currentTime: now,
    });

    // If a legitimate consensus flip occurred, update internal state
    if (result.status === "consensus_reached" && result.currentVibe !== currentState.currentVibe) {
      this.setVenueState(venueId, {
        currentVibe: result.currentVibe,
        lastFlippedAt: now,
      });
    }

    // Prune stale votes beyond observation window
    const obsWindow = this.options.observationWindowMs ?? DEFAULT_OBSERVATION_WINDOW_MS;
    this.venueVotes.set(
      venueId,
      votes.filter((v) => now - v.timestamp <= obsWindow),
    );

    return result;
  }

  /**
   * Resets internal states and votes.
   */
  public reset(venueId?: string): void {
    if (venueId) {
      this.venueStates.delete(venueId);
      this.venueVotes.delete(venueId);
    } else {
      this.venueStates.clear(this.venueVotes.clear() as any);
    }
  }
}

export const defaultVibeConsensusEngine = new VibeConsensusEngine();
