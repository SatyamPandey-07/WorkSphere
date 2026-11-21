import {
  DEFAULT_THRESHOLDS,
  type GossipSubPeerScorer,
  type PeerScoreThresholds,
} from "./GossipSubPeerScorer";

export type PeerHealth = "good" | "neutral" | "penalized" | "blacklisted";

export interface ColocationConfig {
  weight: number;
  threshold: number;
}

/** Same defaults the scorer uses when none are passed. */
export const DEFAULT_COLOCATION: ColocationConfig = { weight: -5.0, threshold: 2 };

export interface PeerScoreBreakdown {
  p1: number; // time in mesh
  p2: number; // first message deliveries
  p3: number; // mesh delivery deficit + delivery failures
  p4: number; // invalid messages
  sybil: number; // IP colocation penalty
  appSpecific: number;
}

export interface PeerHealthRow {
  peerId: string;
  score: number;
  health: PeerHealth;
  inMesh: boolean;
  sybilPenalized: boolean;
  breakdown: PeerScoreBreakdown;
}

export interface MeshSnapshot {
  peers: PeerHealthRow[];
  connected: number;
  meshMembers: number;
  sybilPenalized: number;
}

/**
 * Good: score >= acceptPXThreshold
 * Neutral: gossipThreshold <= score < acceptPXThreshold
 * Penalized: graylistThreshold <= score < gossipThreshold
 * Blacklisted: score < graylistThreshold (matches scorer.isGraylisted)
 */
export function getPeerHealth(
  score: number,
  thresholds: PeerScoreThresholds = DEFAULT_THRESHOLDS,
): PeerHealth {
  if (score < thresholds.graylistThreshold) return "blacklisted";
  if (score < thresholds.gossipThreshold) return "penalized";
  if (score >= thresholds.acceptPXThreshold) return "good";
  return "neutral";
}

export function buildMeshSnapshot(
  scorer: GossipSubPeerScorer,
  thresholds: PeerScoreThresholds = DEFAULT_THRESHOLDS,
  colocation: ColocationConfig = DEFAULT_COLOCATION,
): MeshSnapshot {
  const scores = scorer.getAllPeerScores();

  const ipCounts = new Map<string, number>();
  for (const peerId of scores.keys()) {
    const ip = scorer.getPeerStats(peerId)?.ip;
    if (ip) ipCounts.set(ip, (ipCounts.get(ip) ?? 0) + 1);
  }

  const peers: PeerHealthRow[] = [];
  for (const [peerId, score] of scores.entries()) {
    const stats = scorer.getPeerStats(peerId);
    if (!stats) continue;

    let p1 = 0, p2 = 0, p3 = 0, p4 = 0;
    let inMesh = false;
    for (const [topic, state] of stats.topics.entries()) {
      const params = scorer.getTopicParams(topic);
      const w = params.topicWeight;
      if (state.inMesh) {
        inMesh = true;
        const quanta = Math.floor(state.meshTimeMs / params.timeInMeshQuantumMs);
        p1 += Math.min(quanta * params.timeInMeshWeight, params.timeInMeshCap) * w;
        if (state.meshMessageDeliveries < params.meshMessageDeliveriesThreshold) {
          const deficit = params.meshMessageDeliveriesThreshold - state.meshMessageDeliveries;
          p3 += deficit * deficit * params.meshMessageDeliveriesWeight * w;
        }
      }
      p2 +=
        Math.min(state.firstMessageDeliveries, params.firstMessageDeliveriesCap) *
        params.firstMessageDeliveriesWeight * w;
      p3 += state.meshFailures * params.meshFailureWeight * w;
      if (state.invalidMessages > 0) {
        p4 += state.invalidMessages ** 2 * params.invalidMessageDeliveriesWeight * w;
      }
    }

    const ipCount = stats.ip ? ipCounts.get(stats.ip) ?? 0 : 0;
    const excess = Math.max(0, ipCount - colocation.threshold);
    const sybil = excess > 0 ? excess * excess * colocation.weight : 0;

    peers.push({
      peerId,
      score,
      health: getPeerHealth(score, thresholds),
      inMesh,
      sybilPenalized: sybil < 0,
      breakdown: { p1, p2, p3, p4, sybil, appSpecific: stats.appSpecificScore },
    });
  }

  peers.sort((a, b) => a.score - b.score); // worst first

  return {
    peers,
    connected: peers.length,
    meshMembers: peers.filter((p) => p.inMesh).length,
    sybilPenalized: peers.filter((p) => p.sybilPenalized).length,
  };
}
