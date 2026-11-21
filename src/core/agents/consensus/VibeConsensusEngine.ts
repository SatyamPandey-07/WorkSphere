import { VibeType } from "@/lib/venues/liveVibeTypes";

// ============================================================================
// Legacy BFT Sensor-Based Quorum Types & Implementation (Preserved for compatibility)
// ============================================================================

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
    [key: string]: unknown;
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
  const quorumThreshold =
    options?.quorumThreshold ?? WEIGHTED_QUORUM_REQUIREMENT;
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
    const baseWeight = vote.weight ?? weightsConfig[vote.nodeType] ?? 1.0;
    const confidence =
      typeof vote.confidence === "number" &&
      vote.confidence >= 0 &&
      vote.confidence <= 1
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
    vibePercentageBreakdown.lively = vibeWeightBreakdown.lively / totalWeight;
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

// ============================================================================
// Multi-Agent Debate & Consensus Engine for Venue Vibe Classification (#7234)
// ============================================================================

export type AgentPersonaId =
  "deep_worker" | "startup_founder" | "audio_engineer";

export interface VenueTelemetry {
  noiseDecibels: number; // e.g. 20 - 120 dB
  wifiSpeedMbps: number; // e.g. 0 - 1000+ Mbps
  seatingErgonomics: number; // 0 - 10 or 0 - 100
  metadata?: Record<string, unknown>;
}

export interface PersonaWeights {
  noiseWeight: number;
  wifiWeight: number;
  ergonomicsWeight: number;
  productivityWeight: number;
  energyWeight: number;
  acousticComfortWeight: number;
}

export interface AgentPersonaConfig {
  id: AgentPersonaId;
  name: string;
  roleDescription: string;
  weights: PersonaWeights;
}

export interface AgentEvaluation {
  agentId: AgentPersonaId;
  personaName: string;
  score: number; // 0 - 100
  confidence: number; // 0.0 - 1.0
  vector: number[]; // Evaluation vector representing dimensions [noiseSuitability, wifiSuitability, seatingComfort, vibeMatch]
  summary: string;
}

export interface DebateTranscriptEntry {
  round: number; // 0 for initial evaluation, 1..3 for debate iterations
  agentId: AgentPersonaId;
  personaName: string;
  score: number;
  confidence: number;
  vector: number[];
  reasoning: string;
  responseToPeers?: string;
}

export type ConsensusMethod =
  "weighted_agreement" | "median_fallback" | "unanimous_agreement";

export interface MultiAgentVibeConsensusResult {
  venueId?: string;
  finalVibeScore: number; // 0 - 100
  agentScores: Record<AgentPersonaId, number>;
  semanticAgreementScore: number; // 0 - 100
  consensusMethod: ConsensusMethod;
  debateIterations: number;
  fallbackUsed: boolean;
  transcript: DebateTranscriptEntry[];
  warnings?: string[];
  executionTimeMs?: number;
}

export interface DebateEngineConfig {
  divergenceThreshold?: number; // Maximum divergence before median fallback (semantic agreement minimum 0-100 scale, default 70)
  maxDebateIterations?: number; // Default 3
  plasticityRate?: number; // How much agents revise positions per round [0.0 - 1.0], default 0.25
}

export const DEFAULT_DEBATE_CONFIG: Required<DebateEngineConfig> = {
  divergenceThreshold: 70.0,
  maxDebateIterations: 3,
  plasticityRate: 0.25,
};

export const DEFAULT_PERSONA_CONFIGS: Record<
  AgentPersonaId,
  AgentPersonaConfig
> = {
  deep_worker: {
    id: "deep_worker",
    name: "Deep Worker",
    roleDescription:
      "Prioritizes productivity, low noise, reliable Wi-Fi, and comfortable working conditions.",
    weights: {
      noiseWeight: 0.4,
      wifiWeight: 0.3,
      ergonomicsWeight: 0.2,
      productivityWeight: 0.1,
      energyWeight: 0.0,
      acousticComfortWeight: 0.0,
    },
  },
  startup_founder: {
    id: "startup_founder",
    name: "Startup Founder",
    roleDescription:
      "Prioritizes collaboration, energy, connectivity, flexibility, and opportunities for networking.",
    weights: {
      noiseWeight: 0.15,
      wifiWeight: 0.35,
      ergonomicsWeight: 0.2,
      productivityWeight: 0.0,
      energyWeight: 0.3,
      acousticComfortWeight: 0.0,
    },
  },
  audio_engineer: {
    id: "audio_engineer",
    name: "Audio Engineer",
    roleDescription:
      "Prioritizes acoustic quality, noise characteristics, sound comfort, and the impact of environmental noise.",
    weights: {
      noiseWeight: 0.55,
      wifiWeight: 0.1,
      ergonomicsWeight: 0.1,
      productivityWeight: 0.0,
      energyWeight: 0.0,
      acousticComfortWeight: 0.25,
    },
  },
};

/**
 * Validates telemetry inputs safely, handling missing, non-finite, negative, or out-of-bounds telemetry.
 */
export function validateVenueTelemetry(telemetry: unknown): {
  valid: boolean;
  sanitized?: {
    noiseDecibels: number;
    wifiSpeedMbps: number;
    seatingErgonomics: number; // Normalized 0-100
  };
  warnings: string[];
  error?: string;
} {
  const warnings: string[] = [];

  if (!telemetry || typeof telemetry !== "object") {
    return {
      valid: false,
      warnings: ["Telemetry payload is missing or not an object."],
      error: "Telemetry payload is missing or not an object.",
    };
  }

  const raw = telemetry as Partial<VenueTelemetry>;

  if (
    typeof raw.noiseDecibels !== "number" ||
    !Number.isFinite(raw.noiseDecibels) ||
    typeof raw.wifiSpeedMbps !== "number" ||
    !Number.isFinite(raw.wifiSpeedMbps) ||
    typeof raw.seatingErgonomics !== "number" ||
    !Number.isFinite(raw.seatingErgonomics)
  ) {
    return {
      valid: false,
      warnings: [
        "Telemetry contains missing, NaN, or non-finite numeric values.",
      ],
      error: "Telemetry contains missing, NaN, or non-finite numeric values.",
    };
  }

  // Bounds and sanity checks
  if (raw.noiseDecibels < 0 || raw.noiseDecibels > 160) {
    return {
      valid: false,
      warnings: [
        `Invalid noise level: ${raw.noiseDecibels} dB is outside physical realistic bounds (0 - 160 dB).`,
      ],
      error: `Invalid noise level: ${raw.noiseDecibels} dB is outside physical realistic bounds (0 - 160 dB).`,
    };
  }

  if (raw.wifiSpeedMbps < 0) {
    return {
      valid: false,
      warnings: [
        `Invalid Wi-Fi speed: ${raw.wifiSpeedMbps} Mbps cannot be negative.`,
      ],
      error: `Invalid Wi-Fi speed: ${raw.wifiSpeedMbps} Mbps cannot be negative.`,
    };
  }

  if (raw.seatingErgonomics < 0 || raw.seatingErgonomics > 100) {
    return {
      valid: false,
      warnings: [
        `Invalid seating ergonomics score: ${raw.seatingErgonomics} is outside allowed range [0, 100].`,
      ],
      error: `Invalid seating ergonomics score: ${raw.seatingErgonomics} is outside allowed range [0, 100].`,
    };
  }

  // Normalize seating ergonomics if on 0-10 scale
  let normalizedErgonomics = raw.seatingErgonomics;
  if (raw.seatingErgonomics <= 10 && raw.seatingErgonomics > 0) {
    normalizedErgonomics = raw.seatingErgonomics * 10;
    warnings.push(
      "Seating ergonomics value detected on [0, 10] scale; normalized to [0, 100].",
    );
  }

  return {
    valid: true,
    sanitized: {
      noiseDecibels: raw.noiseDecibels,
      wifiSpeedMbps: raw.wifiSpeedMbps,
      seatingErgonomics: normalizedErgonomics,
    },
    warnings,
  };
}

/**
 * Computes vector cosine similarity between two numeric vectors.
 * Handles mismatched dimensions, empty/zero vectors, and non-finite elements safely.
 * Returns cosine similarity in [-1, 1].
 */
export function calculateCosineSimilarity(
  vecA: number[],
  vecB: number[],
): number {
  if (
    !vecA ||
    !vecB ||
    vecA.length === 0 ||
    vecB.length === 0 ||
    vecA.length !== vecB.length
  ) {
    return 0.0;
  }

  let dot = 0.0;
  let normA = 0.0;
  let normB = 0.0;

  for (let i = 0; i < vecA.length; i++) {
    const a = vecA[i];
    const b = vecB[i];

    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      return 0.0;
    }

    dot += a * b;
    normA += a * a;
    normB += b * b;
  }

  if (normA <= 0.0 || normB <= 0.0) {
    return 0.0;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator <= 0.0 || !Number.isFinite(denominator)) {
    return 0.0;
  }

  const similarity = dot / denominator;
  // Numerical precision clamping
  return Math.max(-1.0, Math.min(1.0, similarity));
}

/**
 * Calculates overall semantic agreement across a set of vectors.
 * Averages pairwise cosine similarity and normalizes from [-1, 1] to a [0, 100] scale.
 */
export function calculateSemanticAgreement(vectors: number[][]): number {
  if (!vectors || vectors.length < 2) {
    return 100.0;
  }

  let totalPairwiseSim = 0.0;
  let pairCount = 0;

  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      const sim = calculateCosineSimilarity(vectors[i], vectors[j]);
      totalPairwiseSim += sim;
      pairCount++;
    }
  }

  if (pairCount === 0) return 100.0;
  const avgCosine = totalPairwiseSim / pairCount;

  // Map cosine range [-1.0, 1.0] to [0.0, 100.0]
  // Cosine 1.0 -> 100, 0.0 -> 50, -1.0 -> 0
  const normalizedAgreement = ((avgCosine + 1.0) / 2.0) * 100.0;
  return Math.max(
    0.0,
    Math.min(100.0, Math.round(normalizedAgreement * 100) / 100),
  );
}

/**
 * Computes median value of an array of numbers.
 * Safe for odd and even length arrays, empty arrays, and non-finite numbers.
 */
export function calculateMedian(numbers: number[]): number {
  const valid = numbers.filter(
    (n) => typeof n === "number" && Number.isFinite(n),
  );
  if (valid.length === 0) return 50.0;

  const sorted = [...valid].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 !== 0) {
    return sorted[mid];
  } else {
    return (sorted[mid - 1] + sorted[mid]) / 2.0;
  }
}

/**
 * Persona evaluation logic for Deep Worker:
 * Highly values quiet (<50dB), fast wifi (>=50Mbps), high ergonomics.
 */
export function evaluateDeepWorker(
  sanitized: {
    noiseDecibels: number;
    wifiSpeedMbps: number;
    seatingErgonomics: number;
  },
  personaConfig: AgentPersonaConfig = DEFAULT_PERSONA_CONFIGS.deep_worker,
): AgentEvaluation {
  const { noiseDecibels, wifiSpeedMbps, seatingErgonomics } = sanitized;

  // Noise component: Optimal < 45dB (100 pts), 65dB (50 pts), > 85dB (0 pts)
  let noiseScore = 0;
  if (noiseDecibels <= 45) {
    noiseScore = 100;
  } else if (noiseDecibels >= 85) {
    noiseScore = 0;
  } else {
    noiseScore = 100 - ((noiseDecibels - 45) / (85 - 45)) * 100;
  }

  // WiFi component: Optimal >= 100Mbps (100 pts), 25Mbps (50 pts), 0Mbps (0 pts)
  let wifiScore = 0;
  if (wifiSpeedMbps >= 100) {
    wifiScore = 100;
  } else if (wifiSpeedMbps <= 0) {
    wifiScore = 0;
  } else {
    wifiScore = Math.min(100, (wifiSpeedMbps / 100) * 100);
  }

  // Ergonomics: Directly 0-100
  const ergoScore = seatingErgonomics;

  // Productivity composite: Quiet + Ergonomics harmony
  const productivityScore = noiseScore * 0.6 + ergoScore * 0.4;

  const weights = personaConfig.weights;
  const rawScore =
    noiseScore * weights.noiseWeight +
    wifiScore * weights.wifiWeight +
    ergoScore * weights.ergonomicsWeight +
    productivityScore * weights.productivityWeight;

  const finalScore = Math.max(0, Math.min(100, Math.round(rawScore * 10) / 10));

  // Confidence is high if conditions are decisive (either clearly great or clearly bad for focus)
  const confidence = Math.max(
    0.6,
    Math.min(1.0, 0.7 + (Math.abs(finalScore - 50) / 50) * 0.3),
  );

  // Evaluation vector: [noiseSuitability, wifiSuitability, seatingComfort, focusVibeMatch]
  const vector = [
    Math.round(noiseScore * 10) / 10,
    Math.round(wifiScore * 10) / 10,
    Math.round(ergoScore * 10) / 10,
    Math.round(productivityScore * 10) / 10,
  ];

  const summary = `Deep Worker prioritizes focus: Noise score ${noiseScore.toFixed(0)}, WiFi score ${wifiScore.toFixed(0)}, Ergonomics ${ergoScore.toFixed(0)}. Overall suitability ${finalScore}/100.`;

  return {
    agentId: "deep_worker",
    personaName: personaConfig.name,
    score: finalScore,
    confidence: Math.round(confidence * 100) / 100,
    vector,
    summary,
  };
}

/**
 * Persona evaluation logic for Startup Founder:
 * Values vibrant atmosphere (moderate noise 55-70dB), strong wifi for calls/demos, and seating flexibility.
 */
export function evaluateStartupFounder(
  sanitized: {
    noiseDecibels: number;
    wifiSpeedMbps: number;
    seatingErgonomics: number;
  },
  personaConfig: AgentPersonaConfig = DEFAULT_PERSONA_CONFIGS.startup_founder,
): AgentEvaluation {
  const { noiseDecibels, wifiSpeedMbps, seatingErgonomics } = sanitized;

  // Energy & Buzz: Optimal around 55 - 70dB (sweet spot for lively collaboration).
  // Too quiet (<40dB) feels dead (50 pts); too loud (>85dB) prevents calls (20 pts).
  let energyScore = 0;
  if (noiseDecibels >= 55 && noiseDecibels <= 70) {
    energyScore = 100;
  } else if (noiseDecibels < 55) {
    energyScore = Math.max(30, 100 - (55 - noiseDecibels) * 2.5);
  } else {
    energyScore = Math.max(10, 100 - (noiseDecibels - 70) * 4.0);
  }

  // WiFi: Critical for video pitches, demos, and collaboration (>= 80Mbps ideal)
  let wifiScore = 0;
  if (wifiSpeedMbps >= 80) {
    wifiScore = 100;
  } else if (wifiSpeedMbps <= 0) {
    wifiScore = 0;
  } else {
    wifiScore = Math.min(100, (wifiSpeedMbps / 80) * 100);
  }

  // Ergonomics & seating
  const ergoScore = seatingErgonomics;

  // General noise tolerance (more forgiving than deep worker, but penalizes extreme roar)
  let noiseToleranceScore = 0;
  if (noiseDecibels <= 72) {
    noiseToleranceScore = 90;
  } else {
    noiseToleranceScore = Math.max(15, 90 - (noiseDecibels - 72) * 3);
  }

  const weights = personaConfig.weights;
  const rawScore =
    noiseToleranceScore * weights.noiseWeight +
    wifiScore * weights.wifiWeight +
    ergoScore * weights.ergonomicsWeight +
    energyScore * weights.energyWeight;

  const finalScore = Math.max(0, Math.min(100, Math.round(rawScore * 10) / 10));
  const confidence = Math.max(
    0.6,
    Math.min(1.0, 0.75 + (wifiScore >= 70 ? 0.2 : -0.1)),
  );

  // Evaluation vector: [noiseTolerance, wifiSuitability, seatingComfort, collaborationEnergy]
  const vector = [
    Math.round(noiseToleranceScore * 10) / 10,
    Math.round(wifiScore * 10) / 10,
    Math.round(ergoScore * 10) / 10,
    Math.round(energyScore * 10) / 10,
  ];

  const summary = `Startup Founder seeks energy and connectivity: Collaboration energy ${energyScore.toFixed(0)}, WiFi ${wifiScore.toFixed(0)}, Ergonomics ${ergoScore.toFixed(0)}. Overall score ${finalScore}/100.`;

  return {
    agentId: "startup_founder",
    personaName: personaConfig.name,
    score: finalScore,
    confidence: Math.round(confidence * 100) / 100,
    vector,
    summary,
  };
}

/**
 * Persona evaluation logic for Audio Engineer:
 * Rigorously evaluates acoustic comfort, noise spectrum / dB thresholds, focused listening suitability.
 */
export function evaluateAudioEngineer(
  sanitized: {
    noiseDecibels: number;
    wifiSpeedMbps: number;
    seatingErgonomics: number;
  },
  personaConfig: AgentPersonaConfig = DEFAULT_PERSONA_CONFIGS.audio_engineer,
): AgentEvaluation {
  const { noiseDecibels, wifiSpeedMbps, seatingErgonomics } = sanitized;

  // Acoustic comfort curve: Critical curve.
  // <40dB studio grade (100 pts), 40-50dB quiet (85 pts), 50-65dB acceptable (55 pts), >75dB harsh (10 pts)
  let acousticScore = 0;
  if (noiseDecibels <= 40) {
    acousticScore = 100;
  } else if (noiseDecibels >= 80) {
    acousticScore = Math.max(0, 10 - (noiseDecibels - 80) * 1.0);
  } else {
    acousticScore = 100 - Math.pow((noiseDecibels - 40) / 40, 1.5) * 90;
  }
  acousticScore = Math.max(0, Math.min(100, acousticScore));

  // Sound comfort component
  const soundComfortScore =
    noiseDecibels <= 60
      ? 90 - (noiseDecibels - 30)
      : Math.max(5, 60 - (noiseDecibels - 60) * 2.5);

  // WiFi: Secondary for audio work, but needed for cloud DAW/stems
  const wifiScore = Math.min(100, (wifiSpeedMbps / 50) * 100);

  // Ergonomics: Long mixing/monitoring sessions require decent chair
  const ergoScore = seatingErgonomics;

  const weights = personaConfig.weights;
  const rawScore =
    acousticScore * weights.noiseWeight +
    wifiScore * weights.wifiWeight +
    ergoScore * weights.ergonomicsWeight +
    soundComfortScore * weights.acousticComfortWeight;

  const finalScore = Math.max(0, Math.min(100, Math.round(rawScore * 10) / 10));
  const confidence = Math.max(
    0.7,
    Math.min(
      1.0,
      0.8 + (noiseDecibels < 50 || noiseDecibels > 75 ? 0.15 : 0.05),
    ),
  );

  // Evaluation vector: [acousticScore, wifiSuitability, seatingComfort, soundComfort]
  const vector = [
    Math.round(acousticScore * 10) / 10,
    Math.round(wifiScore * 10) / 10,
    Math.round(ergoScore * 10) / 10,
    Math.round(soundComfortScore * 10) / 10,
  ];

  const summary = `Audio Engineer evaluates acoustics: Acoustic rating ${acousticScore.toFixed(0)}, Sound comfort ${soundComfortScore.toFixed(0)}, Noise ${noiseDecibels} dB. Overall score ${finalScore}/100.`;

  return {
    agentId: "audio_engineer",
    personaName: personaConfig.name,
    score: finalScore,
    confidence: Math.round(confidence * 100) / 100,
    vector,
    summary,
  };
}

/**
 * Stateful Multi-Agent Vibe Consensus Engine.
 * Supports:
 * 1. Multi-agent debate & consensus engine across Deep Worker, Startup Founder, Audio Engineer (#7234).
 * 2. BFT weighted sensor-based quorum consensus with 15-minute hysteresis damping (legacy compatibility #6471).
 */
export class VibeConsensusEngine {
  // Legacy sensor state tracking
  private venueStates: Map<string, VenueVibeState> = new Map();
  private venueVotes: Map<string, ConsensusVote[]> = new Map();
  private options: VibeConsensusOptions;

  // Debate configuration
  private debateConfig: Required<DebateEngineConfig>;
  private personaConfigs: Record<AgentPersonaId, AgentPersonaConfig>;

  constructor(
    options?: VibeConsensusOptions,
    debateConfig?: DebateEngineConfig,
    personaConfigs?: Partial<Record<AgentPersonaId, AgentPersonaConfig>>,
  ) {
    this.options = {
      quorumThreshold: WEIGHTED_QUORUM_REQUIREMENT,
      dampingWindowMs: VIBE_DAMPING_WINDOW_MS,
      observationWindowMs: DEFAULT_OBSERVATION_WINDOW_MS,
      defaultWeights: DEFAULT_NODE_WEIGHTS,
      ...options,
    };

    this.debateConfig = {
      ...DEFAULT_DEBATE_CONFIG,
      ...debateConfig,
    };

    this.personaConfigs = {
      ...DEFAULT_PERSONA_CONFIGS,
      ...personaConfigs,
    };
  }

  // ==========================================================================
  // Multi-Agent Debate & Consensus Orchestration (#7234)
  // ==========================================================================

  /**
   * Evaluates venue vibe telemetry through multi-agent debate and consensus.
   * Orchestrates 3 personas (Deep Worker, Startup Founder, Audio Engineer).
   * Calculates semantic agreement via vector cosine similarity.
   * Performs up to 3 debate iterations; uses median voting fallback if divergence exceeds threshold.
   */
  public evaluateVibeTelemetry(
    telemetry: VenueTelemetry,
    venueId?: string,
  ): MultiAgentVibeConsensusResult {
    const startTime = Date.now();

    // 1. Validate Telemetry
    const validation = validateVenueTelemetry(telemetry);
    if (!validation.valid || !validation.sanitized) {
      throw new Error(`Telemetry validation failed: ${validation.error}`);
    }

    const sanitized = validation.sanitized;
    const warnings = [...validation.warnings];

    // 2. Initial Evaluation Phase (Round 0)
    const initialEvaluations: Record<AgentPersonaId, AgentEvaluation> = {
      deep_worker: evaluateDeepWorker(
        sanitized,
        this.personaConfigs.deep_worker,
      ),
      startup_founder: evaluateStartupFounder(
        sanitized,
        this.personaConfigs.startup_founder,
      ),
      audio_engineer: evaluateAudioEngineer(
        sanitized,
        this.personaConfigs.audio_engineer,
      ),
    };

    const transcript: DebateTranscriptEntry[] = [];
    const agentIds: AgentPersonaId[] = [
      "deep_worker",
      "startup_founder",
      "audio_engineer",
    ];

    for (const agentId of agentIds) {
      const evaluation = initialEvaluations[agentId];
      transcript.push({
        round: 0,
        agentId,
        personaName: evaluation.personaName,
        score: evaluation.score,
        confidence: evaluation.confidence,
        vector: [...evaluation.vector],
        reasoning: evaluation.summary,
      });
    }

    // Current working scores & vectors
    const currentScores: Record<AgentPersonaId, number> = {
      deep_worker: initialEvaluations.deep_worker.score,
      startup_founder: initialEvaluations.startup_founder.score,
      audio_engineer: initialEvaluations.audio_engineer.score,
    };

    const currentVectors: Record<AgentPersonaId, number[]> = {
      deep_worker: [...initialEvaluations.deep_worker.vector],
      startup_founder: [...initialEvaluations.startup_founder.vector],
      audio_engineer: [...initialEvaluations.audio_engineer.vector],
    };

    const currentConfidences: Record<AgentPersonaId, number> = {
      deep_worker: initialEvaluations.deep_worker.confidence,
      startup_founder: initialEvaluations.startup_founder.confidence,
      audio_engineer: initialEvaluations.audio_engineer.confidence,
    };

    // Calculate initial semantic agreement
    let agreementScore = calculateSemanticAgreement(
      Object.values(currentVectors),
    );
    let iterationCount = 0;
    const maxIterations = this.debateConfig.maxDebateIterations;
    const threshold = this.debateConfig.divergenceThreshold;
    const plasticity = this.debateConfig.plasticityRate;

    // Check if initial agreement already satisfies the threshold
    let converged = agreementScore >= threshold;

    // 3. Structured Debate Iterations (Rounds 1..3)
    while (!converged && iterationCount < maxIterations) {
      iterationCount++;

      // In each round, each agent inspects peer positions and reconciles differences
      for (const agentId of agentIds) {
        const peerIds = agentIds.filter((id) => id !== agentId);
        const myScore = currentScores[agentId];
        const myVector = currentVectors[agentId];
        const peerScores = peerIds.map((id) => currentScores[id]);
        const peerAvgScore =
          peerScores.reduce((sum, s) => sum + s, 0) / peerScores.length;

        // Revise score: move towards peer consensus influenced by confidence and plasticity
        const peerDelta = peerAvgScore - myScore;
        const shift =
          peerDelta * plasticity * (1.0 - currentConfidences[agentId] * 0.4);
        const revisedScore = Math.max(
          0,
          Math.min(100, Math.round((myScore + shift) * 10) / 10),
        );

        // Revise evaluation vector towards shared semantic manifold
        const revisedVector = myVector.map((val, dimIdx) => {
          const peerDimAvg =
            peerIds.reduce((sum, id) => sum + currentVectors[id][dimIdx], 0) /
            peerIds.length;
          const dimShift = (peerDimAvg - val) * plasticity * 0.5;
          return Math.round((val + dimShift) * 10) / 10;
        });

        currentScores[agentId] = revisedScore;
        currentVectors[agentId] = revisedVector;

        const peerNames = peerIds
          .map((id) => this.personaConfigs[id].name)
          .join(" and ");
        const direction = shift >= 0 ? "increased" : "lowered";
        const responseToPeers = `Responding to ${peerNames}: ${this.personaConfigs[agentId].name} ${direction} score by ${Math.abs(shift).toFixed(1)} points (revised to ${revisedScore}/100) after weighing peer perspectives.`;
        const reasoning = `Round ${iterationCount} revision: Adjusted evaluation vector towards collective balance while maintaining core persona priorities.`;

        transcript.push({
          round: iterationCount,
          agentId,
          personaName: this.personaConfigs[agentId].name,
          score: revisedScore,
          confidence: currentConfidences[agentId],
          vector: revisedVector,
          reasoning,
          responseToPeers,
        });
      }

      // Recalculate semantic agreement after round
      agreementScore = calculateSemanticAgreement(
        Object.values(currentVectors),
      );
      if (agreementScore >= threshold) {
        converged = true;
        break;
      }
    }

    // 4. Final Consensus Aggregation & Fallback Determination
    let finalVibeScore: number;
    let consensusMethod: ConsensusMethod;
    let fallbackUsed = false;

    if (converged) {
      // Confidence-weighted consensus aggregation
      const totalWeight =
        currentConfidences.deep_worker +
        currentConfidences.startup_founder +
        currentConfidences.audio_engineer;

      if (totalWeight > 0) {
        const weightedSum =
          currentScores.deep_worker * currentConfidences.deep_worker +
          currentScores.startup_founder * currentConfidences.startup_founder +
          currentScores.audio_engineer * currentConfidences.audio_engineer;
        finalVibeScore = Math.max(
          0,
          Math.min(100, Math.round((weightedSum / totalWeight) * 10) / 10),
        );
      } else {
        finalVibeScore = calculateMedian(Object.values(currentScores));
      }

      consensusMethod =
        agreementScore >= 98.0 ? "unanimous_agreement" : "weighted_agreement";
    } else {
      // Divergence threshold exceeded after 3 iterations -> Median Voting Fallback
      fallbackUsed = true;
      consensusMethod = "median_fallback";
      finalVibeScore =
        Math.round(calculateMedian(Object.values(currentScores)) * 10) / 10;
      warnings.push(
        `Debate did not reach divergence threshold (${threshold}) after ${iterationCount} iterations (final agreement: ${agreementScore.toFixed(1)}). Median fallback activated.`,
      );
    }

    const executionTimeMs = Date.now() - startTime;

    return {
      venueId,
      finalVibeScore,
      agentScores: { ...currentScores },
      semanticAgreementScore: agreementScore,
      consensusMethod,
      debateIterations: iterationCount,
      fallbackUsed,
      transcript,
      warnings: warnings.length > 0 ? warnings : undefined,
      executionTimeMs,
    };
  }

  // ==========================================================================
  // Legacy Sensor Voting Integration (#6471)
  // ==========================================================================

  /**
   * Initializes or gets the state of a venue.
   */
  public getVenueState(
    venueId: string,
    initialVibe: VibeType = "silent_focus",
  ): VenueVibeState {
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
  public setVenueState(
    venueId: string,
    stateUpdate: Partial<VenueVibeState>,
  ): VenueVibeState {
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
      (v) =>
        v.nodeId === fullVote.nodeId &&
        Math.abs(fullVote.timestamp - v.timestamp) < 5 * 60 * 1000,
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
  public evaluateConsensus(
    venueId: string,
    currentTime?: number,
  ): VibeConsensusResult {
    const now = currentTime ?? Date.now();
    const currentState = this.getVenueState(venueId);
    const votes = this.venueVotes.get(venueId) || [];

    const result = resolveVibeConsensus(venueId, votes, currentState, {
      ...this.options,
      currentTime: now,
    });

    // If a legitimate consensus flip occurred, update internal state
    if (
      result.status === "consensus_reached" &&
      result.currentVibe !== currentState.currentVibe
    ) {
      this.setVenueState(venueId, {
        currentVibe: result.currentVibe,
        lastFlippedAt: now,
      });
    }

    // Prune stale votes beyond observation window
    const obsWindow =
      this.options.observationWindowMs ?? DEFAULT_OBSERVATION_WINDOW_MS;
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
      this.venueStates.clear();
      this.venueVotes.clear();
    }
  }
}

export const defaultVibeConsensusEngine = new VibeConsensusEngine();
