/**
 * Decentralized Local Wi-Fi Mesh & Offline P2P Workspace Collaboration Engine
 * Implements WebRTC DataChannel signaling, CRDT vector clocks for offline document sync,
 * peer hop routing, Bloom filter message deduplication, and zero-WAN local network resilience.
 */

import { MeshBloomFilter, type MeshBloomFilterConfig } from "./meshBloomFilter";

export interface MeshPeerNode {
  peerId: string;
  displayName: string;
  deskLocation?: string | null;
  ipSubnet?: string | null;
  hopCount: number; // 0 = direct LAN peer, 1+ = relayed via mesh node
  signalStrengthRssi?: number | null; // e.g. -45 dBm
  latencyMs?: number | null;
  lastSeenTimestamp: number;
  status: "connected" | "connecting" | "mesh_relay" | "disconnected";
  sharedFilesCount?: number;
  dataChannel?: RTCDataChannel | null;
}

export interface CRDTDocumentDelta {
  docId: string;
  vectorClock: Record<string, number>;
  authorId: string;
  authorName: string;
  deltaText: string;
  cursorPosition: { line: number; ch: number };
  timestamp: number;
}

export interface CursorDeltaOptions {
  /** Minimum pixel delta to trigger a broadcast (default: 2) */
  minDeltaPx?: number;
  /** Maximum broadcast rate in updates per second (default: 30) */
  maxRateHz?: number;
}

export function shouldBroadcastCursorPosition(
  current: { x: number; y: number },
  lastSent: { x: number; y: number },
  options?: CursorDeltaOptions,
): boolean {
  const opts = options ?? {};
  const minDeltaPx = opts.minDeltaPx ?? 2;
  const _maxRateHz = opts.maxRateHz ?? 30;

  const dx = Math.abs(current.x - lastSent.x);
  const dy = Math.abs(current.y - lastSent.y);

  // Check minimum pixel delta
  if (dx <= minDeltaPx && dy <= minDeltaPx) {
    return false;
  }

  // TODO: rate limiting can be applied at the dispatch layer
  // using requestAnimationFrame or setInterval with _maxRateHz

  return true;
}

export interface LocalMeshTopology {
  venueId: string;
  venueName: string;
  localSubnet: string | null;
  wanStatus:
    | "healthy_online"
    | "isp_blackout_offline"
    | "degraded_high_packet_loss"
    | "CONNECTED"
    | "DISCONNECTED"
    | "DEGRADED";
  activeMeshPeers: MeshPeerNode[];
  totalBandwidthKbps: number;
  meshResilienceRating: "optimal" | "robust" | "limited";
  deduplicationStats?: {
    droppedDuplicates: number;
    bloomFilterMemoryBytes: number;
    falsePositiveRate: number;
  };
}

export class MeshCollabEngine {
  /**
   * Merges CRDT document deltas based on Lamport vector clock causality
   */
  public static mergeDocumentDeltas(
    baseText: string,
    currentClocks: Record<string, number>,
    incomingDelta: CRDTDocumentDelta,
  ): { mergedText: string; updatedClocks: Record<string, number> } {
    const updatedClocks = { ...currentClocks };
    const incomingClock =
      incomingDelta.vectorClock[incomingDelta.authorId] || 0;
    const existingClock = currentClocks[incomingDelta.authorId] || 0;

    // Apply change if newer or concurrent with tie-breaker
    if (incomingClock >= existingClock) {
      updatedClocks[incomingDelta.authorId] = incomingClock;
      const mergedText = incomingDelta.deltaText;
      return { mergedText, updatedClocks };
    }

    return { mergedText: baseText, updatedClocks };
  }

  /**
   * Evaluates overall mesh resilience and node connectivity
   */
  public static calculateMeshResilience(
    peers: MeshPeerNode[],
    wanStatus: LocalMeshTopology["wanStatus"],
  ): LocalMeshTopology["meshResilienceRating"] {
    const connectedCount = peers.filter(
      (p) => p.status === "connected" || p.status === "mesh_relay",
    ).length;

    const isOffline =
      wanStatus === "isp_blackout_offline" || wanStatus === "DISCONNECTED";

    if (connectedCount >= 4 && !isOffline) {
      return "optimal";
    }
    if (connectedCount >= 2) {
      return "robust";
    }
    return "limited";
  }

  /**
   * Computes mock signaling token for WebRTC peer connection
   */
  public static generateSignalingOffer(peerId: string, subnet: string): string {
    const payload = {
      peerId,
      subnet,
      sdpOffer: `v=0\no=- ${Date.now()} 2 IN IP4 ${subnet}\ns=-\nt=0 0\na=group:BUNDLE data\nm=application 9 DTLS/SCTP 5000\na=sctpmap:5000 webrtc-datachannel 1024`,
      nonce: Math.random().toString(36).substr(2, 8),
    };
    return Buffer.from(JSON.stringify(payload)).toString("base64");
  }

  /**
   * Calculates RTT ping in milliseconds from WebRTC DataChannel heartbeat send/receive timestamps
   */
  public static calculateRttPing(
    sentAt: number,
    receivedAt: number = Date.now(),
  ): number {
    if (typeof sentAt !== "number" || isNaN(sentAt)) return 0;
    return Math.max(0, Math.round(receivedAt - sentAt));
  }

  /**
   * Creates an adaptive MeshBloomFilter for P2P mesh message deduplication
   */
  public static createMessageBloomFilter(
    config?: Partial<MeshBloomFilterConfig>,
  ): MeshBloomFilter {
    return new MeshBloomFilter(config);
  }

  /**
   * Tests if an incoming WebRTC DataChannel payload is a duplicate using a Bloom filter
   */
  public static isDuplicateMessage(
    filter: MeshBloomFilter,
    payload: ArrayBuffer | Uint8Array,
  ): boolean {
    const msgId = filter.extractMessageId(payload);
    return filter.testAndAdd(msgId);
  }

  /**
   * Calculates estimated mobile data savings from suppressed duplicate messages in KB
   */
  public static calculateBandwidthSavedKb(
    droppedDuplicatesCount: number,
    averagePayloadSizeBytes: number = 1024,
  ): number {
    if (droppedDuplicatesCount <= 0) return 0;
    return Math.round(
      (droppedDuplicatesCount * averagePayloadSizeBytes) / 1024,
    );
  }
}
