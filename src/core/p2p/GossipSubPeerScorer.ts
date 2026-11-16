/**
 * GossipSubPeerScorer.ts
 * libp2p GossipSub v1.1 Peer Scoring and Sybil Attack Mitigation Engine.
 *
 * Implements multi-parameter topic scoring (P1 time-in-mesh, P2 first-delivery,
 * P3 message-delivery deficit, P3b delivery failure, P4 invalid message penalty),
 * IP colocation penalties, and behavioral gating thresholds (gossip, publish, graylist).
 */

export interface TopicScoreParams {
  topicWeight: number;
  timeInMeshWeight: number;
  timeInMeshQuantumMs: number;
  timeInMeshCap: number;
  firstMessageDeliveriesWeight: number;
  firstMessageDeliveriesDecay: number;
  firstMessageDeliveriesCap: number;
  meshMessageDeliveriesWeight: number;
  meshMessageDeliveriesDecay: number;
  meshMessageDeliveriesThreshold: number;
  meshMessageDeliveriesCap: number;
  meshFailureWeight: number;
  meshFailureDecay: number;
  invalidMessageDeliveriesWeight: number;
  invalidMessageDeliveriesDecay: number;
}

export interface PeerScoreThresholds {
  gossipThreshold: number;
  publishThreshold: number;
  graylistThreshold: number;
  acceptPXThreshold: number;
}

export interface PeerScoreParams {
  topics: Map<string, TopicScoreParams>;
  appSpecificWeight?: number;
  ipColocationWeight?: number;
  ipColocationThreshold?: number;
  decayIntervalMs?: number;
  thresholds?: Partial<PeerScoreThresholds>;
}

export interface PeerTopicState {
  inMesh: boolean;
  meshTimeMs: number;
  firstMessageDeliveries: number;
  meshMessageDeliveries: number;
  meshFailures: number;
  invalidMessages: number;
}

export interface PeerStatsRecord {
  peerId: string;
  ip?: string;
  topics: Map<string, PeerTopicState>;
  appSpecificScore: number;
  overallScore: number;
}

export const DEFAULT_TOPIC_SCORE_PARAMS: TopicScoreParams = {
  topicWeight: 1.0,
  timeInMeshWeight: 0.05,
  timeInMeshQuantumMs: 1000,
  timeInMeshCap: 10.0,
  firstMessageDeliveriesWeight: 1.0,
  firstMessageDeliveriesDecay: 0.9,
  firstMessageDeliveriesCap: 50.0,
  meshMessageDeliveriesWeight: -0.5,
  meshMessageDeliveriesDecay: 0.9,
  meshMessageDeliveriesThreshold: 5,
  meshMessageDeliveriesCap: 20,
  meshFailureWeight: -1.0,
  meshFailureDecay: 0.85,
  invalidMessageDeliveriesWeight: -10.0,
  invalidMessageDeliveriesDecay: 0.8,
};

export const DEFAULT_THRESHOLDS: PeerScoreThresholds = {
  gossipThreshold: -10,
  publishThreshold: -40,
  graylistThreshold: -80,
  acceptPXThreshold: 10,
};

/** Hard bounds for scores consumed by mesh pruning and peer-policy decisions. */
export const MIN_PEER_SCORE = -1000;
export const MAX_PEER_SCORE = 100;

const MAX_TRACKED_METRIC = Number.MAX_SAFE_INTEGER;

function safeMetric(value: number): number {
  if (Number.isNaN(value) || value === Infinity) return MAX_TRACKED_METRIC;
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(value, MAX_TRACKED_METRIC);
}

function incrementMetric(value: number): number {
  return Math.min(safeMetric(value) + 1, MAX_TRACKED_METRIC);
}

function meshTimeAfterStep(current: number, timeStep: number): number {
  const next = safeMetric(current) + safeMetric(timeStep);
  return Number.isFinite(next) ? Math.min(next, MAX_TRACKED_METRIC) : MAX_TRACKED_METRIC;
}

/** Keeps decayed counters finite; invalid decay settings preserve the metric. */
function decayMetric(value: number, factor: number): number {
  const safeValue = safeMetric(value);
  const safeFactor = Number.isFinite(factor) && factor >= 0 ? factor : 1;
  const decayed = safeValue * safeFactor;
  return Number.isFinite(decayed)
    ? Math.min(decayed, MAX_TRACKED_METRIC)
    : MAX_TRACKED_METRIC;
}

/** Non-finite scores fail closed so NaN cannot bypass peer penalties. */
function clampPeerScore(score: number): number {
  if (Number.isNaN(score) || score === -Infinity) return MIN_PEER_SCORE;
  if (score === Infinity) return MAX_PEER_SCORE;
  return Math.max(MIN_PEER_SCORE, Math.min(MAX_PEER_SCORE, score));
}

export class GossipSubPeerScorer {
  private topicsParams = new Map<string, TopicScoreParams>();
  private defaultTopicParams: TopicScoreParams;
  private thresholds: PeerScoreThresholds;
  private ipColocationWeight: number;
  private ipColocationThreshold: number;
  private appSpecificWeight: number;

  private peers = new Map<string, PeerStatsRecord>();
  private ipMap = new Map<string, Set<string>>(); // IP -> Set of peerIds
  private decayTimer: ReturnType<typeof setInterval> | null = null;

  constructor(params?: PeerScoreParams) {
    this.defaultTopicParams = { ...DEFAULT_TOPIC_SCORE_PARAMS };
    if (params?.topics) {
      for (const [t, p] of params.topics.entries()) {
        this.topicsParams.set(t, { ...p });
      }
    }

    this.thresholds = {
      ...DEFAULT_THRESHOLDS,
      ...(params?.thresholds ?? {}),
    };

    this.ipColocationWeight = params?.ipColocationWeight ?? -5.0;
    this.ipColocationThreshold = params?.ipColocationThreshold ?? 2;
    this.appSpecificWeight = params?.appSpecificWeight ?? 1.0;

    const decayInterval = params?.decayIntervalMs ?? 1000;
    if (decayInterval > 0) {
      this.decayTimer = setInterval(() => {
        this.decayScores();
      }, decayInterval);
    }
  }

  public setTopicParams(topic: string, params: Partial<TopicScoreParams>): void {
    const existing = this.topicsParams.get(topic) ?? { ...this.defaultTopicParams };
    this.topicsParams.set(topic, { ...existing, ...params });
  }

  public getTopicParams(topic: string): TopicScoreParams {
    return this.topicsParams.get(topic) ?? this.defaultTopicParams;
  }

  private getOrCreatePeer(peerId: string): PeerStatsRecord {
    let peer = this.peers.get(peerId);
    if (!peer) {
      peer = {
        peerId,
        topics: new Map(),
        appSpecificScore: 0,
        overallScore: 0,
      };
      this.peers.set(peerId, peer);
    }
    return peer;
  }

  private getOrCreateTopicState(peer: PeerStatsRecord, topic: string): PeerTopicState {
    let state = peer.topics.get(topic);
    if (!state) {
      state = {
        inMesh: false,
        meshTimeMs: 0,
        firstMessageDeliveries: 0,
        meshMessageDeliveries: 0,
        meshFailures: 0,
        invalidMessages: 0,
      };
      peer.topics.set(topic, state);
    }
    return state;
  }

  public setIP(peerId: string, ip: string): void {
    const peer = this.getOrCreatePeer(peerId);
    if (peer.ip && this.ipMap.has(peer.ip)) {
      this.ipMap.get(peer.ip)!.delete(peerId);
      if (this.ipMap.get(peer.ip)!.size === 0) {
        this.ipMap.delete(peer.ip);
      }
    }
    peer.ip = ip;
    if (!this.ipMap.has(ip)) {
      this.ipMap.set(ip, new Set());
    }
    this.ipMap.get(ip)!.add(peerId);
  }

  public joinTopic(peerId: string, topic: string): void {
    const peer = this.getOrCreatePeer(peerId);
    const state = this.getOrCreateTopicState(peer, topic);
    state.inMesh = true;
  }

  public leaveTopic(peerId: string, topic: string): void {
    const peer = this.peers.get(peerId);
    if (peer) {
      const state = peer.topics.get(topic);
      if (state) {
        state.inMesh = false;
      }
    }
  }

  public deliverFirstMessage(peerId: string, topic: string): void {
    const peer = this.getOrCreatePeer(peerId);
    const state = this.getOrCreateTopicState(peer, topic);
    state.firstMessageDeliveries = incrementMetric(state.firstMessageDeliveries);
    state.meshMessageDeliveries = incrementMetric(state.meshMessageDeliveries);
  }

  public deliverMessage(peerId: string, topic: string): void {
    const peer = this.getOrCreatePeer(peerId);
    const state = this.getOrCreateTopicState(peer, topic);
    state.meshMessageDeliveries = incrementMetric(state.meshMessageDeliveries);
  }

  public recordDeliveryFailure(peerId: string, topic: string): void {
    const peer = this.getOrCreatePeer(peerId);
    const state = this.getOrCreateTopicState(peer, topic);
    state.meshFailures = incrementMetric(state.meshFailures);
  }

  public recordInvalidMessage(peerId: string, topic: string): void {
    const peer = this.getOrCreatePeer(peerId);
    const state = this.getOrCreateTopicState(peer, topic);
    state.invalidMessages = incrementMetric(state.invalidMessages);
  }

  public setAppSpecificScore(peerId: string, score: number): void {
    const peer = this.getOrCreatePeer(peerId);
    peer.appSpecificScore = score;
  }

  /**
   * Computes the raw total score for a given peer according to GossipSub v1.1.
   */
  public score(peerId: string, elapsedMeshMs = 0): number {
    const peer = this.peers.get(peerId);
    if (!peer) return 0;

    let totalScore = 0;

    // 1. Topic Scores
    for (const [topic, state] of peer.topics.entries()) {
      const params = this.getTopicParams(topic);
      const meshTimeMs = safeMetric(state.meshTimeMs);
      const firstMessageDeliveries = safeMetric(state.firstMessageDeliveries);
      const meshMessageDeliveries = safeMetric(state.meshMessageDeliveries);
      const meshFailures = safeMetric(state.meshFailures);
      const invalidMessages = safeMetric(state.invalidMessages);
      let topicScore = 0;

      // P1: Time In Mesh
      if (state.inMesh) {
        const totalMeshTime = meshTimeMs + safeMetric(elapsedMeshMs);
        const quanta = Math.floor(totalMeshTime / params.timeInMeshQuantumMs);
        const p1 = Math.min(quanta * params.timeInMeshWeight, params.timeInMeshCap);
        topicScore += p1;
      }

      // P2: First Message Deliveries
      const p2 =
        Math.min(firstMessageDeliveries, params.firstMessageDeliveriesCap) *
        params.firstMessageDeliveriesWeight;
      topicScore += p2;

      // P3: Mesh Message Delivery Deficit (penalty if below threshold)
      if (state.inMesh && meshMessageDeliveries < params.meshMessageDeliveriesThreshold) {
        const deficit = params.meshMessageDeliveriesThreshold - meshMessageDeliveries;
        const p3 = deficit * deficit * params.meshMessageDeliveriesWeight;
        topicScore += p3; // Negative weight creates penalty
      }

      // P3b: Mesh Message Delivery Failures
      const p3b = meshFailures * params.meshFailureWeight;
      topicScore += p3b;

      // P4: Invalid Messages (quadratic penalty)
      if (invalidMessages > 0) {
        const p4 =
          invalidMessages * invalidMessages * params.invalidMessageDeliveriesWeight;
        topicScore += p4;
      }

      totalScore += topicScore * params.topicWeight;
    }

    // 2. Colocation Penalty (Sybil mitigation)
    if (peer.ip && this.ipMap.has(peer.ip)) {
      const ipCount = this.ipMap.get(peer.ip)!.size;
      if (ipCount > this.ipColocationThreshold) {
        const excess = ipCount - this.ipColocationThreshold;
        totalScore += excess * excess * this.ipColocationWeight;
      }
    }

    // 3. Application Specific Score
    totalScore += peer.appSpecificScore * this.appSpecificWeight;

    const boundedScore = clampPeerScore(totalScore);
    peer.overallScore = boundedScore;
    return boundedScore;
  }

  /**
   * Applies periodic geometric decay across all tracked peer states.
   */
  public decayScores(timeStepMs = 1000): void {
    for (const [peerId, peer] of this.peers.entries()) {
      for (const [topic, state] of peer.topics.entries()) {
        const params = this.getTopicParams(topic);

        if (state.inMesh) {
          const nextMeshTime = meshTimeAfterStep(state.meshTimeMs, timeStepMs);
          state.meshTimeMs = nextMeshTime;
        }

        state.firstMessageDeliveries = decayMetric(
          state.firstMessageDeliveries,
          params.firstMessageDeliveriesDecay,
        );
        if (state.firstMessageDeliveries < 0.01) state.firstMessageDeliveries = 0;

        state.meshMessageDeliveries = decayMetric(
          state.meshMessageDeliveries,
          params.meshMessageDeliveriesDecay,
        );
        if (state.meshMessageDeliveries < 0.01) state.meshMessageDeliveries = 0;

        state.meshFailures = decayMetric(state.meshFailures, params.meshFailureDecay);
        if (state.meshFailures < 0.01) state.meshFailures = 0;

        state.invalidMessages = decayMetric(
          state.invalidMessages,
          params.invalidMessageDeliveriesDecay,
        );
        if (state.invalidMessages < 0.01) state.invalidMessages = 0;
      }

      this.score(peerId);
    }
  }

  // --- Behavioral Policy Gating API ---

  public shouldGossip(peerId: string): boolean {
    return this.score(peerId) >= this.thresholds.gossipThreshold;
  }

  public shouldPublish(peerId: string): boolean {
    return this.score(peerId) >= this.thresholds.publishThreshold;
  }

  public isGraylisted(peerId: string): boolean {
    return this.score(peerId) < this.thresholds.graylistThreshold;
  }

  public prunePeer(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (peer?.ip && this.ipMap.has(peer.ip)) {
      this.ipMap.get(peer.ip)!.delete(peerId);
      if (this.ipMap.get(peer.ip)!.size === 0) {
        this.ipMap.delete(peer.ip);
      }
    }
    this.peers.delete(peerId);
  }

  public getPeerStats(peerId: string): Readonly<PeerStatsRecord> | undefined {
    return this.peers.get(peerId);
  }

  public getAllPeerScores(): Map<string, number> {
    const map = new Map<string, number>();
    for (const [peerId] of this.peers.entries()) {
      map.set(peerId, this.score(peerId));
    }
    return map;
  }

  public dispose(): void {
    if (this.decayTimer) {
      clearInterval(this.decayTimer);
      this.decayTimer = null;
    }
    this.peers.clear();
    this.ipMap.clear();
  }
}
