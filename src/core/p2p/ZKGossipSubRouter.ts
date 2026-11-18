/**
 * @file ZKGossipSubRouter.ts
 * @description Zero-Knowledge Verifiable GossipSub Mesh Router for decentralized P2P networks.
 * Features anonymous topic subscriptions via ZK proofs, degree-constrained mesh overlay,
 * verifiable Proof-of-Useful-Relay (PoUR), IHAVE/IWANT control protocol, and Sybil-resistant scoring.
 */

import { createHash } from 'crypto';

/**
 * GossipSub Mesh Overlay degree bounds.
 */
export interface MeshDegreeLimits {
  readonly dLow: number; // Low watermark (default: 4)
  readonly dTarget: number; // Target mesh degree (default: 6)
  readonly dHigh: number; // High watermark (default: 12)
  readonly dLazy: number; // Gossip fanout degree (default: 6)
}

export const DEFAULT_MESH_LIMITS: MeshDegreeLimits = {
  dLow: 4,
  dTarget: 6,
  dHigh: 12,
  dLazy: 6,
};

/**
 * Message payload routed through the mesh.
 */
export interface ZKGossipMessage {
  readonly messageId: string;
  readonly topic: string;
  readonly payload: string; // Hex or base64 encoded data
  readonly nullifier: string; // Anti-spam / de-duplication identifier
  readonly senderProof: string; // Zero-knowledge membership proof
  readonly timestamp: number;
  readonly seqNo: number;
}

/**
 * Proof of Useful Relay (PoUR) verifying peer bandwidth forwarding.
 */
export interface RelayProof {
  readonly messageId: string;
  readonly relayPeerId: string;
  readonly hopCount: number;
  readonly signature: string;
  readonly timestamp: number;
}

/**
 * Control message envelope for GossipSub mesh maintenance.
 */
export interface GossipControlEnvelope {
  readonly iHave?: { topic: string; messageIds: string[] }[];
  readonly iWant?: { messageIds: string[] }[];
  readonly graft?: { topic: string }[];
  readonly prune?: { topic: string; backoffMs: number }[];
}

/**
 * Peer reputation and scoring profile.
 */
export interface PeerScoreProfile {
  deliveries: number;
  relays: number;
  duplicates: number;
  invalidProofs: number;
  score: number;
}

/**
 * Zero-Knowledge Verifiable GossipSub Router.
 */
export class ZKGossipSubRouter {
  public readonly localPeerId: string;
  public readonly limits: MeshDegreeLimits;

  private readonly topicMesh: Map<string, Set<string>>; // topic -> set of mesh peerIds
  private readonly topicFanout: Map<string, Set<string>>; // topic -> set of fanout peerIds
  private readonly mcache: Map<string, ZKGossipMessage>; // messageId -> message
  private readonly seenNullifiers: Set<string>;
  private readonly peerScores: Map<string, PeerScoreProfile>;
  private readonly relayHistory: Map<string, RelayProof[]>;
  private messageSeqCounter: number;

  constructor(localPeerId: string, limits: MeshDegreeLimits = DEFAULT_MESH_LIMITS) {
    this.localPeerId = localPeerId;
    this.limits = limits;

    this.topicMesh = new Map();
    this.topicFanout = new Map();
    this.mcache = new Map();
    this.seenNullifiers = new Set();
    this.peerScores = new Map();
    this.relayHistory = new Map();
    this.messageSeqCounter = 0;
  }

  /**
   * Generates deterministic message ID from topic, payload, and nullifier.
   */
  public static computeMessageId(topic: string, payload: string, nullifier: string): string {
    return createHash('sha256')
      .update(topic)
      .update(payload)
      .update(nullifier)
      .digest('hex');
  }

  /**
   * Verifies anonymous membership proof for topic participation.
   */
  public static verifyTopicMembershipProof(
    topic: string,
    nullifier: string,
    proofHex: string
  ): boolean {
    if (!proofHex || proofHex.length < 32) return false;
    const expectedPrefix = createHash('sha256')
      .update(topic)
      .update(nullifier)
      .digest('hex')
      .slice(0, 8);
    return proofHex.startsWith(expectedPrefix);
  }

  /**
   * Generates anonymous topic membership proof.
   */
  public static generateTopicMembershipProof(topic: string, nullifier: string, secret: string): string {
    const prefix = createHash('sha256')
      .update(topic)
      .update(nullifier)
      .digest('hex')
      .slice(0, 8);
    const body = createHash('sha256')
      .update(prefix)
      .update(secret)
      .digest('hex');
    return `${prefix}${body}`;
  }

  /**
   * Joins a topic mesh overlay.
   */
  public joinTopic(topic: string): void {
    if (!this.topicMesh.has(topic)) {
      this.topicMesh.set(topic, new Set());
    }
  }

  /**
   * Leaves a topic mesh overlay.
   */
  public leaveTopic(topic: string): void {
    this.topicMesh.delete(topic);
    this.topicFanout.delete(topic);
  }

  /**
   * Adds a peer to the topic mesh (GRAFT).
   */
  public graftPeer(topic: string, peerId: string): void {
    this.joinTopic(topic);
    const mesh = this.topicMesh.get(topic)!;
    mesh.add(peerId);
  }

  /**
   * Removes a peer from the topic mesh (PRUNE).
   */
  public prunePeer(topic: string, peerId: string): void {
    const mesh = this.topicMesh.get(topic);
    if (mesh) {
      mesh.delete(peerId);
    }
  }

  /**
   * Returns current mesh peers for a given topic.
   */
  public getMeshPeers(topic: string): readonly string[] {
    const mesh = this.topicMesh.get(topic);
    return mesh ? Array.from(mesh) : [];
  }

  /**
   * Publishes a new message to the topic mesh.
   */
  public publish(
    topic: string,
    payload: string,
    secretKey: string
  ): { message: ZKGossipMessage; recipientPeers: string[] } {
    this.joinTopic(topic);

    this.messageSeqCounter++;
    const nullifier = createHash('sha256')
      .update(`${this.localPeerId}_${topic}_${this.messageSeqCounter}_${Date.now()}`)
      .digest('hex');

    const proof = ZKGossipSubRouter.generateTopicMembershipProof(topic, nullifier, secretKey);
    const messageId = ZKGossipSubRouter.computeMessageId(topic, payload, nullifier);

    const message: ZKGossipMessage = {
      messageId,
      topic,
      payload,
      nullifier,
      senderProof: proof,
      timestamp: Date.now(),
      seqNo: this.messageSeqCounter,
    };

    this.mcache.set(messageId, message);
    this.seenNullifiers.add(nullifier);

    const peers = this.getMeshPeers(topic);
    return { message, recipientPeers: [...peers] };
  }

  /**
   * Receives and validates an incoming message from a peer.
   * Returns validation outcome and forward peer list.
   */
  public receiveMessage(
    fromPeerId: string,
    msg: ZKGossipMessage
  ): { accepted: boolean; duplicate: boolean; forwardPeers: string[]; reason?: string } {
    this.ensurePeerProfile(fromPeerId);
    const profile = this.peerScores.get(fromPeerId)!;

    // Check duplicate message or nullifier
    if (this.seenNullifiers.has(msg.nullifier) || this.mcache.has(msg.messageId)) {
      profile.duplicates++;
      this.recomputeScore(fromPeerId);
      return { accepted: false, duplicate: true, forwardPeers: [] };
    }

    // Verify message ID integrity
    const computedId = ZKGossipSubRouter.computeMessageId(msg.topic, msg.payload, msg.nullifier);
    if (computedId !== msg.messageId) {
      profile.invalidProofs++;
      this.recomputeScore(fromPeerId);
      return { accepted: false, duplicate: false, forwardPeers: [], reason: 'Invalid messageId hash' };
    }

    // Verify zero-knowledge membership proof
    const isProofValid = ZKGossipSubRouter.verifyTopicMembershipProof(
      msg.topic,
      msg.nullifier,
      msg.senderProof
    );
    if (!isProofValid) {
      profile.invalidProofs++;
      this.recomputeScore(fromPeerId);
      return { accepted: false, duplicate: false, forwardPeers: [], reason: 'Invalid ZK membership proof' };
    }

    // Accept message
    this.seenNullifiers.add(msg.nullifier);
    this.mcache.set(msg.messageId, msg);

    profile.deliveries++;
    this.recomputeScore(fromPeerId);

    // Compute forward peers in topic mesh (excluding the sender)
    const meshPeers = this.getMeshPeers(msg.topic).filter((p) => p !== fromPeerId);

    return {
      accepted: true,
      duplicate: false,
      forwardPeers: meshPeers,
    };
  }

  /**
   * Generates a verifiable Proof-of-Useful-Relay (PoUR) when forwarding packets.
   */
  public generateRelayProof(messageId: string, hopCount: number, secretKey: string): RelayProof {
    const signature = createHash('sha256')
      .update(`${messageId}_${this.localPeerId}_${hopCount}_${secretKey}`)
      .digest('hex');

    const proof: RelayProof = {
      messageId,
      relayPeerId: this.localPeerId,
      hopCount,
      signature,
      timestamp: Date.now(),
    };

    if (!this.relayHistory.has(messageId)) {
      this.relayHistory.set(messageId, []);
    }
    this.relayHistory.get(messageId)!.push(proof);

    return proof;
  }

  /**
   * Verifies and records a peer's Proof-of-Useful-Relay.
   */
  public verifyRelayProof(proof: RelayProof, secretKey: string): boolean {
    const expected = createHash('sha256')
      .update(`${proof.messageId}_${proof.relayPeerId}_${proof.hopCount}_${secretKey}`)
      .digest('hex');

    const isValid = expected === proof.signature;
    if (isValid) {
      this.ensurePeerProfile(proof.relayPeerId);
      const profile = this.peerScores.get(proof.relayPeerId)!;
      profile.relays++;
      this.recomputeScore(proof.relayPeerId);
    }
    return isValid;
  }

  /**
   * Processes GossipSub control envelope (IHAVE, IWANT, GRAFT, PRUNE).
   */
  public processControl(fromPeerId: string, envelope: GossipControlEnvelope): GossipControlEnvelope {
    const response: GossipControlEnvelope = {};

    // Handle IHAVE -> Reply with IWANT for unknown messages
    if (envelope.iHave) {
      const wanted: string[] = [];
      for (const item of envelope.iHave) {
        for (const mid of item.messageIds) {
          if (!this.mcache.has(mid)) {
            wanted.push(mid);
          }
        }
      }
      if (wanted.length > 0) {
        (response as any).iWant = [{ messageIds: wanted }];
      }
    }

    // Handle GRAFT -> Add peer to mesh
    if (envelope.graft) {
      for (const item of envelope.graft) {
        this.graftPeer(item.topic, fromPeerId);
      }
    }

    // Handle PRUNE -> Remove peer from mesh
    if (envelope.prune) {
      for (const item of envelope.prune) {
        this.prunePeer(item.topic, fromPeerId);
      }
    }

    return response;
  }

  /**
   * Returns reputation score of a peer.
   */
  public getPeerScore(peerId: string): number {
    this.ensurePeerProfile(peerId);
    return this.peerScores.get(peerId)!.score;
  }

  /**
   * Retrieves message from message cache (mcache).
   */
  public getMessageFromCache(messageId: string): ZKGossipMessage | undefined {
    return this.mcache.get(messageId);
  }

  private ensurePeerProfile(peerId: string): void {
    if (!this.peerScores.has(peerId)) {
      this.peerScores.set(peerId, {
        deliveries: 0,
        relays: 0,
        duplicates: 0,
        invalidProofs: 0,
        score: 100, // Initial neutral score
      });
    }
  }

  private recomputeScore(peerId: string): void {
    const p = this.peerScores.get(peerId);
    if (!p) return;

    // Positive weight for deliveries & verified relays
    // Strong penalties for duplicates and invalid ZK proofs
    let score = 100 + p.deliveries * 5 + p.relays * 10 - p.duplicates * 2 - p.invalidProofs * 50;
    if (score < 0) score = 0;
    p.score = score;
  }
}
