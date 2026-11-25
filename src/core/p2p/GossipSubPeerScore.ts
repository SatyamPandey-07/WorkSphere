export type PeerDisposition = 'HEALTHY' | 'DEPRIORITIZED' | 'PRUNED';

export interface PeerScoreConfig {
  deprioritizeThreshold?: number;
  pruneThreshold?: number;
  subnetGracePeers?: number;
  subnetPenaltyWeight?: number;
  validMessageReward?: number;
  invalidMessagePenalty?: number;
  decayFactor?: number;
}

export interface PeerEntry {
  peerId: string;
  ip?: string;
  subnet?: string;
  behaviorScore: number;
  lastUpdatedAt: number;
}

export interface PeerScoreSnapshot {
  peerId: string;
  subnet?: string;
  behaviorScore: number;
  colocationPenalty: number;
  totalScore: number;
  disposition: PeerDisposition;
}

const DEFAULT_CONFIG: Required<PeerScoreConfig> = {
  deprioritizeThreshold: -10,
  pruneThreshold: -30,
  subnetGracePeers: 1,
  subnetPenaltyWeight: 4,
  validMessageReward: 1,
  invalidMessagePenalty: 10,
  decayFactor: 0.9,
};

export function extractIpSubnet(ip?: string): string | undefined {
  if (!ip) return undefined;
  const trimmed = ip.trim();
  if (!trimmed) return undefined;

  const mappedIpv4Match = trimmed.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  const candidate = mappedIpv4Match ? mappedIpv4Match[1] : trimmed;

  const ipv4Parts = candidate.split('.');
  if (ipv4Parts.length === 4 && ipv4Parts.every((p) => /^\d{1,3}$/.test(p))) {
    const octets = ipv4Parts.map(Number);
    if (octets.every((n) => n >= 0 && n <= 255)) {
      return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
    }
  }

  if (candidate.includes(':')) {
    const hextets = candidate.split(':').filter(Boolean);
    if (hextets.length >= 3) {
      return `${hextets.slice(0, 3).join(':')}::/48`;
    }
  }

  return undefined;
}

export class GossipSubPeerScore {
  private readonly config: Required<PeerScoreConfig>;
  private readonly peers = new Map<string, PeerEntry>();
  private readonly subnetPeers = new Map<string, Set<string>>();

  constructor(config: PeerScoreConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  registerPeer(peerId: string, ip?: string, now = Date.now()): void {
    const existing = this.peers.get(peerId);
    const nextSubnet = extractIpSubnet(ip) ?? existing?.subnet;

    if (existing?.subnet && existing.subnet !== nextSubnet) {
      this.removeFromSubnet(existing.subnet, peerId);
    }

    if (nextSubnet) {
      let bucket = this.subnetPeers.get(nextSubnet);
      if (!bucket) {
        bucket = new Set<string>();
        this.subnetPeers.set(nextSubnet, bucket);
      }
      bucket.add(peerId);
    }

    this.peers.set(peerId, {
      peerId,
      ip: ip ?? existing?.ip,
      subnet: nextSubnet,
      behaviorScore: existing?.behaviorScore ?? 0,
      lastUpdatedAt: now,
    });
  }

  removePeer(peerId: string): void {
    const entry = this.peers.get(peerId);
    if (!entry) return;
    if (entry.subnet) {
      this.removeFromSubnet(entry.subnet, peerId);
    }
    this.peers.delete(peerId);
  }

  recordValidMessage(peerId: string, now = Date.now()): void {
    const entry = this.ensurePeer(peerId, now);
    entry.behaviorScore += this.config.validMessageReward;
    entry.lastUpdatedAt = now;
  }

  recordInvalidMessage(peerId: string, now = Date.now()): void {
    const entry = this.ensurePeer(peerId, now);
    entry.behaviorScore -= this.config.invalidMessagePenalty;
    entry.lastUpdatedAt = now;
  }

  decayScores(now = Date.now()): void {
    for (const entry of this.peers.values()) {
      entry.behaviorScore *= this.config.decayFactor;
      if (Math.abs(entry.behaviorScore) < 0.01) {
        entry.behaviorScore = 0;
      }
      entry.lastUpdatedAt = now;
    }
  }

  getColocationPenalty(peerId: string): number {
    const entry = this.peers.get(peerId);
    if (!entry?.subnet) return 0;

    const bucket = this.subnetPeers.get(entry.subnet);
    const count = bucket ? bucket.size : 0;
    const excess = Math.max(0, count - this.config.subnetGracePeers);
    return excess * excess * this.config.subnetPenaltyWeight;
  }

  getScore(peerId: string): PeerScoreSnapshot {
    const entry = this.ensurePeer(peerId);
    const colocationPenalty = this.getColocationPenalty(peerId);
    const totalScore = entry.behaviorScore - colocationPenalty;

    let disposition: PeerDisposition = 'HEALTHY';
    if (totalScore <= this.config.pruneThreshold) {
      disposition = 'PRUNED';
    } else if (totalScore <= this.config.deprioritizeThreshold) {
      disposition = 'DEPRIORITIZED';
    }

    return {
      peerId,
      subnet: entry.subnet,
      behaviorScore: entry.behaviorScore,
      colocationPenalty,
      totalScore,
      disposition,
    };
  }

  shouldPrune(peerId: string): boolean {
    return this.getScore(peerId).disposition === 'PRUNED';
  }

  shouldDeprioritize(peerId: string): boolean {
    return this.getScore(peerId).disposition !== 'HEALTHY';
  }

  private ensurePeer(peerId: string, now = Date.now()): PeerEntry {
    let entry = this.peers.get(peerId);
    if (!entry) {
      entry = {
        peerId,
        behaviorScore: 0,
        lastUpdatedAt: now,
      };
      this.peers.set(peerId, entry);
    }
    return entry;
  }

  private removeFromSubnet(subnet: string, peerId: string): void {
    const bucket = this.subnetPeers.get(subnet);
    if (!bucket) return;
    bucket.delete(peerId);
    if (bucket.size === 0) {
      this.subnetPeers.delete(subnet);
    }
  }
}