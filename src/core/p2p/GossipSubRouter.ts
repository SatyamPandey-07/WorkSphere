 feat/gossipsub-ip-colocation-scoring
import {
  GossipSubPeerScore,
  type PeerDisposition,
  type PeerScoreConfig,
} from './GossipSubPeerScore';

export interface GossipMessage {
  id: string;
  topic: string;
  fromPeerId: string;
  payload: unknown;
  valid?: boolean;
}

export interface RoutedMessageResult {
  accepted: boolean;
  disposition: PeerDisposition;
  score: number;
  priority: 'HIGH' | 'LOW' | 'DROPPED';
}

export class GossipSubRouter {
  public readonly peerScore: GossipSubPeerScore;
  private readonly lowPriorityQueue: GossipMessage[] = [];
  private readonly highPriorityQueue: GossipMessage[] = [];

  constructor(scoreConfig: PeerScoreConfig = {}) {
    this.peerScore = new GossipSubPeerScore(scoreConfig);
  }

  onPeerConnect(peerId: string, ip?: string): void {
    this.peerScore.registerPeer(peerId, ip);
  }

  onPeerDisconnect(peerId: string): void {
    this.peerScore.removePeer(peerId);
  }

  handleIncomingMessage(msg: GossipMessage): RoutedMessageResult {
    if (msg.valid === false) {
      this.peerScore.recordInvalidMessage(msg.fromPeerId);
    } else {
      this.peerScore.recordValidMessage(msg.fromPeerId);
    }

    const snapshot = this.peerScore.getScore(msg.fromPeerId);

    if (snapshot.disposition === 'PRUNED') {
      return {
        accepted: false,
        disposition: snapshot.disposition,
        score: snapshot.totalScore,
        priority: 'DROPPED',
      };
    }

    if (snapshot.disposition === 'DEPRIORITIZED') {
      this.lowPriorityQueue.push(msg);
      return {
        accepted: true,
        disposition: snapshot.disposition,
        score: snapshot.totalScore,
        priority: 'LOW',
      };
    }

    this.highPriorityQueue.push(msg);
    return {
      accepted: true,
      disposition: snapshot.disposition,
      score: snapshot.totalScore,
      priority: 'HIGH',
    };
  }

  drainNextMessage(): GossipMessage | undefined {
    if (this.highPriorityQueue.length > 0) {
      return this.highPriorityQueue.shift();
    }
    return this.lowPriorityQueue.shift();
  }
}

/**
 * GossipSubRouter.ts
 * Transport-agnostic GossipSub-style mesh router for offline emergency messaging (#7278).
 *
 * - Per-topic mesh maintained by a heartbeat: D = 6, D_low = 4, D_high = 12.
 * - Epidemic dissemination: a message is forwarded to the topic mesh once; later
 *   copies are dropped via a rotating Bloom filter keyed on the SHA-256 message ID.
 * - Every broadcast is signed with Ed25519 (Web Crypto) and verified by every relay.
 * - Wire format lives in MeshPacketSerializer.ts. The router never touches WebRTC
 *   directly: callers pass a `send(peerId, bytes)` function (e.g. an RTCDataChannel
 *   wrapper) and feed inbound bytes to `handlePacket(peerId, bytes)`.
 */

import {
  MeshPacketType,
  PublishPacket,
  decodePacket,
  encodePacket,
  getSigningBytes,
  ED25519_PUBLIC_KEY_BYTES,
} from "./MeshPacketSerializer";
import {
  AudioFrame,
  AudioPacketType,
  FECEncoder,
  FECReceiver,
  PeerLossMonitor,
  decodeFECPacket,
  isFECPacket,
} from "./AudioFEC";

export const GOSSIP_D = 6;
export const GOSSIP_D_LOW = 4;
export const GOSSIP_D_HIGH = 12;

/* ------------------------------------------------------------------ */
/* Crypto helpers                                                     */
/* ------------------------------------------------------------------ */

export interface GossipIdentity {
  /** Raw 32-byte Ed25519 public key. */
  publicKey: Uint8Array;
  sign(data: Uint8Array): Promise<Uint8Array>;
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", data as BufferSource),
  );
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++)
    out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

/** Generates a fresh Ed25519 identity using the Web Crypto API. */
export async function generateEd25519Identity(): Promise<GossipIdentity> {
  const pair = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicKey = new Uint8Array(
    await crypto.subtle.exportKey("raw", pair.publicKey),
  );
  return {
    publicKey,
    sign: async (data) =>
      new Uint8Array(
        await crypto.subtle.sign(
          "Ed25519",
          pair.privateKey,
          data as BufferSource,
        ),
      ),
  };
}

const verifyKeyCache = new Map<string, CryptoKey>();
const VERIFY_KEY_CACHE_MAX = 512;

export async function verifyEd25519(
  publicKey: Uint8Array,
  data: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  try {
    const cacheKey = toHex(publicKey);
    let key = verifyKeyCache.get(cacheKey);
    if (!key) {
      key = await crypto.subtle.importKey(
        "raw",
        publicKey as BufferSource,
        "Ed25519",
        false,
        ["verify"],
      );
      if (verifyKeyCache.size >= VERIFY_KEY_CACHE_MAX) {
        verifyKeyCache.delete(verifyKeyCache.keys().next().value as string);
      }
      verifyKeyCache.set(cacheKey, key);
    }
    return await crypto.subtle.verify(
      "Ed25519",
      key,
      signature as BufferSource,
      data as BufferSource,
    );
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Duplicate suppression                                              */
/* ------------------------------------------------------------------ */

/**
 * Two-generation Bloom filter over 32-byte SHA-256 message IDs. When the current
 * generation holds `capacity` IDs it becomes the previous generation and a fresh
 * one starts, so memory stays bounded while the last 1x-2x `capacity` messages are
 * remembered. Bit indices use double hashing (Kirsch-Mitzenmacher) taken directly
 * from the ID bytes, which are already uniformly distributed.
 */
export class RotatingBloomFilter {
  private readonly bitCount: number;
  private readonly hashCount: number;
  private current: Uint8Array;
  private previous: Uint8Array;
  private currentCount = 0;

  constructor(
    private readonly capacity = 4096,
    falsePositiveRate = 1e-6,
  ) {
    if (capacity < 1) throw new RangeError("capacity must be >= 1");
    this.bitCount = Math.ceil(
      (-capacity * Math.log(falsePositiveRate)) / Math.LN2 ** 2,
    );
    this.hashCount = Math.max(
      1,
      Math.round((this.bitCount / capacity) * Math.LN2),
    );
    this.current = new Uint8Array(Math.ceil(this.bitCount / 8));
    this.previous = new Uint8Array(this.current.length);
  }

  private indices(id: Uint8Array): number[] {
    const view = new DataView(id.buffer, id.byteOffset, id.byteLength);
    const h1 = view.getUint32(0);
    const h2 = (view.getUint32(4) | 1) >>> 0; // force odd and unsigned
    const out: number[] = [];
    for (let i = 0; i < this.hashCount; i++)
      out.push((h1 + i * h2) % this.bitCount);
    return out;
  }

  has(id: Uint8Array): boolean {
    const idx = this.indices(id);
    const test = (bits: Uint8Array) =>
      idx.every((i) => (bits[i >> 3] & (1 << (i & 7))) !== 0);
    return test(this.current) || test(this.previous);
  }

  add(id: Uint8Array): void {
    if (this.currentCount >= this.capacity) {
      this.previous = this.current;
      this.current = new Uint8Array(this.previous.length);
      this.currentCount = 0;
    }
    for (const i of this.indices(id)) this.current[i >> 3] |= 1 << (i & 7);
    this.currentCount++;
  }
}

/* ------------------------------------------------------------------ */
/* Router                                                             */
/* ------------------------------------------------------------------ */

export interface GossipMessage {
  /** Hex SHA-256 message ID. */
  id: string;
  topic: string;
  /** Hex Ed25519 public key of the origin. */
  from: string;
  seqno: number;
  payload: Uint8Array;
  /** Number of links the message travelled (0 for locally published). */
  hops: number;
  /** Peer that handed us the message, or null if published locally. */
  receivedFrom: string | null;
}

export class QueueOverflowError extends Error {
  readonly peerId: string;
  readonly packetBytes: number;

  constructor(peerId: string, packetBytes: number, message: string) {
    super(message);
    this.name = "QueueOverflowError";
    this.peerId = peerId;
    this.packetBytes = packetBytes;
  }
}

export class PeerQueueBlockedError extends Error {
  readonly peerId: string;

  constructor(peerId: string, message: string) {
    super(message);
    this.name = "PeerQueueBlockedError";
    this.peerId = peerId;
  }
}

export interface BackpressureOptions {
  /**
   * High watermark in bytes (default: 256 KB = 262,144 bytes).
   * When RTCDataChannel.bufferedAmount exceeds this threshold, outgoing sends
   * to this peer are suspended and buffered in memory.
   */
  highWatermark?: number;
  /**
   * Low watermark in bytes (default: 64 KB = 65,536 bytes).
   * When RTCDataChannel.bufferedAmount drops to or below this threshold (or on 'bufferedamountlow'),
   * the queue resumes draining.
   */
  lowWatermark?: number;
  /**
   * Maximum queued bytes per peer before dropping or rejecting new unsent messages (default: 16 MB = 16,777,216 bytes).
   * Prevents browser memory exhaustion during persistent network stalls.
   */
  maxQueueBytes?: number;
  /**
   * Maximum number of packets queued per peer (default: 10,000).
   */
  maxQueuePackets?: number;
  /**
   * Overflow policy when the per-peer outbound queue exceeds maxQueuePackets or maxQueueBytes.
   * - "drop" (default): drops the new packet and increments packetsDroppedOverflow.
   * - "throw": throws a QueueOverflowError to provide explicit producer failure so the caller can retry.
   */
  overflowPolicy?: "drop" | "throw";
  /**
   * Callback invoked whenever a peer enters or leaves a backpressured state.
   */
  onBackpressureChange?: (peerId: string, isBackpressured: boolean) => void;
  /**
   * Callback invoked when a packet is dropped due to queue overflow.
   */
  onPacketDropped?: (peerId: string, packetBytes: number, reason: string) => void;
  /**
   * Callback invoked when a peer's outbound queue becomes blocked due to retry exhaustion.
   */
  onQueueBlocked?: (peerId: string, error: Error) => void;
  /**
   * Optional timeout in ms to wait for bufferedAmount to drain before aborting (default: 30,000 ms).
   */
  drainTimeoutMs?: number;
}

export interface GossipSubOptions {
  localPeerId: string;
  identity: GossipIdentity;
  /** Hands bytes to the transport (e.g. an RTCDataChannel) for one peer. Can be synchronous or async. */
  send: (peerId: string, data: Uint8Array) => void | Promise<void>;
  /** Optional lookup to obtain the underlying RTCDataChannel for a peer to inspect backpressure. */
  getDataChannel?: (peerId: string) => RTCDataChannel | null | undefined;
  /** Optional backpressure tuning configuration. */
  backpressure?: BackpressureOptions;
  onMessage?: (message: GossipMessage) => void;
  /** Optional callback specifically for processed/recovered audio frames */
  onAudioFrame?: (frame: AudioFrame, fromPeer: string | null) => void;
  D?: number;
  Dlow?: number;
  Dhigh?: number;
  /** Packets whose hop count reaches this value are dropped. */
  maxHops?: number;
  bloomCapacity?: number;
  bloomFalsePositiveRate?: number;
  /** Returns a float in [0, 1). Inject a seeded PRNG for deterministic tests. */
  random?: () => number;
}

export interface GossipStats {
  published: number;
  delivered: number;
  forwarded: number;
  duplicatesDropped: number;
  invalidDropped: number;
  unsubscribedDropped: number;
  packetsDroppedOverflow: number;
  backpressureWaitEvents: number;
}

interface QueuedPacket {
  data: Uint8Array;
  operationRetries: number;
}

interface PeerOutboundState {
  queue: QueuedPacket[];
  queueBytes: number;
  isDraining: boolean;
  isBackpressured: boolean;
  isBlocked: boolean;
  blockReason: Error | null;
  lowListener: (() => void) | null;
  channel: RTCDataChannel | null;
  drainWaiters: Array<{ resolve: () => void; reject: (err: Error) => void }>;
}

export const DEFAULT_HIGH_WATERMARK = 256 * 1024; // 256 KB
export const DEFAULT_LOW_WATERMARK = 64 * 1024; // 64 KB
export const DEFAULT_MAX_QUEUE_BYTES = 16 * 1024 * 1024; // 16 MB
export const DEFAULT_MAX_QUEUE_PACKETS = 10_000;
export const DEFAULT_DRAIN_TIMEOUT_MS = 30_000;
export const MAX_OPERATION_RETRIES = 5;

export class GossipSubRouter {
  readonly D: number;
  readonly Dlow: number;
  readonly Dhigh: number;

  private readonly peers = new Map<string, Set<string>>(); // peerId -> topics they subscribe to
  private readonly mesh = new Map<string, Set<string>>(); // topic -> mesh peers
  private readonly subscriptions = new Set<string>();
  private readonly seen: RotatingBloomFilter;
  private readonly maxHops: number;
  private readonly random: () => number;
  private seqno = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly stats: GossipStats = {
    published: 0,
    delivered: 0,
    forwarded: 0,
    duplicatesDropped: 0,
    invalidDropped: 0,
    unsubscribedDropped: 0,
    packetsDroppedOverflow: 0,
    backpressureWaitEvents: 0,
  };

  // Backpressure configuration
  private readonly highWatermark: number;
  private readonly lowWatermark: number;
  private readonly maxQueueBytes: number;
  private readonly maxQueuePackets: number;
  private readonly drainTimeoutMs: number;
  private readonly overflowPolicy: "drop" | "throw";
  private readonly peerOutbound = new Map<string, PeerOutboundState>();
  private isDestroyed = false;

  // Adaptive FEC State
  private readonly peerLossMonitors = new Map<string, PeerLossMonitor>();
  private readonly fecEncoders = new Map<string, FECEncoder>(); // topic/streamId -> encoder
  private readonly fecReceivers = new Map<string, FECReceiver>(); // peerId -> receiver
  private audioFrameSeq = 0;

  constructor(private readonly opts: GossipSubOptions) {
    this.D = opts.D ?? GOSSIP_D;
    this.Dlow = opts.Dlow ?? GOSSIP_D_LOW;
    this.Dhigh = opts.Dhigh ?? GOSSIP_D_HIGH;
    if (!(this.Dlow <= this.D && this.D <= this.Dhigh)) {
      throw new RangeError("mesh degrees must satisfy D_low <= D <= D_high");
    }
    if (opts.identity.publicKey.length !== ED25519_PUBLIC_KEY_BYTES) {
      throw new RangeError("identity.publicKey must be a 32-byte Ed25519 key");
    }
    this.maxHops = opts.maxHops ?? 16;
    this.random = opts.random ?? Math.random;
    this.seen = new RotatingBloomFilter(
      opts.bloomCapacity,
      opts.bloomFalsePositiveRate,
    );

    const bp = opts.backpressure ?? {};
    this.highWatermark = bp.highWatermark ?? DEFAULT_HIGH_WATERMARK;
    this.lowWatermark = bp.lowWatermark ?? DEFAULT_LOW_WATERMARK;
    this.maxQueueBytes = bp.maxQueueBytes ?? DEFAULT_MAX_QUEUE_BYTES;
    this.maxQueuePackets = bp.maxQueuePackets ?? DEFAULT_MAX_QUEUE_PACKETS;
    this.drainTimeoutMs = bp.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
    this.overflowPolicy = bp.overflowPolicy ?? "drop";
    if (this.lowWatermark > this.highWatermark) {
      throw new RangeError("lowWatermark must be <= highWatermark");
    }
  }

  /* ----- peers & topics ----- */

  addPeer(peerId: string): void {
    if (this.peers.has(peerId) || peerId === this.opts.localPeerId) return;
    this.peers.set(peerId, new Set());
    this.peerLossMonitors.set(peerId, new PeerLossMonitor());
    this.fecReceivers.set(peerId, new FECReceiver());
    for (const topic of this.subscriptions) {
      this.sendControl(peerId, MeshPacketType.Subscribe, topic);
    }
  }

  removePeer(peerId: string): void {
    this.peers.delete(peerId);
    this.peerLossMonitors.delete(peerId);
    const receiver = this.fecReceivers.get(peerId);
    if (receiver) {
      receiver.clear();
      this.fecReceivers.delete(peerId);
    }
    for (const members of this.mesh.values()) members.delete(peerId);
    this.cleanupPeerOutbound(peerId, new Error(`Peer ${peerId} removed from router`));
  }

  subscribe(topic: string): void {
    if (this.subscriptions.has(topic)) return;
    this.subscriptions.add(topic);
    this.mesh.set(topic, new Set());
    for (const peerId of this.peers.keys()) {
      this.sendControl(peerId, MeshPacketType.Subscribe, topic);
    }
    this.maintainTopic(topic);
  }

  unsubscribe(topic: string): void {
    if (!this.subscriptions.delete(topic)) return;
    const members = this.mesh.get(topic) ?? new Set<string>();
    for (const peerId of members)
      this.sendControl(peerId, MeshPacketType.Prune, topic);
    this.mesh.delete(topic);
    for (const peerId of this.peers.keys()) {
      this.sendControl(peerId, MeshPacketType.Unsubscribe, topic);
    }
  }

  getMeshPeers(topic: string): string[] {
    return [...(this.mesh.get(topic) ?? [])];
  }

  getStats(): Readonly<GossipStats> {
    return { ...this.stats };
  }

  /* ----- heartbeat ----- */

  start(intervalMs = 1000): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.heartbeat(), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.destroy();
  }

  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const abortErr = new Error("GossipSubRouter destroyed");
    for (const peerId of [...this.peerOutbound.keys()]) {
      this.cleanupPeerOutbound(peerId, abortErr);
    }
  }

  /** Keeps every subscribed topic's mesh within [D_low, D_high]. */
  heartbeat(): void {
    for (const topic of this.subscriptions) this.maintainTopic(topic);
  }

  private maintainTopic(topic: string): void {
    const members = this.mesh.get(topic);
    if (!members) return;

    for (const peerId of [...members]) {
      if (!this.peers.get(peerId)?.has(topic)) members.delete(peerId);
    }

    if (members.size < this.Dlow) {
      const candidates = this.shuffle(
        [...this.peers]
          .filter(([id, topics]) => topics.has(topic) && !members.has(id))
          .map(([id]) => id),
      );
      for (const peerId of candidates.slice(0, this.D - members.size)) {
        members.add(peerId);
        this.sendControl(peerId, MeshPacketType.Graft, topic);
      }
    } else if (members.size > this.Dhigh) {
      for (const peerId of this.shuffle([...members]).slice(
        0,
        members.size - this.D,
      )) {
        members.delete(peerId);
        this.sendControl(peerId, MeshPacketType.Prune, topic);
      }
    }
  }

  /* ----- publishing ----- */

  /** Signs and broadcasts `payload`; resolves with the hex message ID. */
  async publish(topic: string, payload: Uint8Array): Promise<string> {
    this.seqno = Math.max(this.seqno + 1, Date.now());
    const unsigned = {
      topic,
      from: this.opts.identity.publicKey,
      seqno: this.seqno,
      payload,
    };
    const signingBytes = getSigningBytes(unsigned);
    const signature = await this.opts.identity.sign(signingBytes);
    const packet: PublishPacket = {
      type: MeshPacketType.Publish,
      hops: 0,
      ...unsigned,
      signature,
    };
    const idBytes = await sha256(signingBytes);
    const id = toHex(idBytes);
    this.seen.add(idBytes);
    this.stats.published++;

    const bytes = encodePacket({ ...packet, hops: 1 });
    const targets = this.publishTargets(topic);
    for (const peerId of targets) {
      this.enqueueSend(peerId, bytes);
    }

    if (this.subscriptions.has(topic)) {
      this.deliver({
        id,
        topic,
        from: toHex(packet.from),
        seqno: packet.seqno,
        payload,
        hops: 0,
        receivedFrom: null,
      });
    }
    return id;
  }

  /** Mesh peers if we have a mesh, else up to D random peers subscribed to the topic. */
  private publishTargets(topic: string): string[] {
    const members = this.mesh.get(topic);
    if (members && members.size > 0) return [...members];
    const subscribed = [...this.peers]
      .filter(([, t]) => t.has(topic))
      .map(([id]) => id);
    return this.shuffle(subscribed).slice(0, this.D);
  }

  /* ----- Adaptive FEC & Audio API ----- */

  /** Returns whether FEC is currently active for the topic/target mesh */
  public isFECActiveForTopic(topic: string): boolean {
    const targets = this.publishTargets(topic);
    if (targets.length === 0) return false;
    return targets.some(
      (peerId) => this.peerLossMonitors.get(peerId)?.isFECEnabled() ?? false,
    );
  }

  async publishAudio(
    topic: string,
    rawPayload: Uint8Array,
    timestamp = Date.now(),
    streamId = this.opts.localPeerId,
  ): Promise<string[]> {
    const publishedIds: string[] = [];
    const isFEC = this.isFECActiveForTopic(topic);

    if (!isFEC) {
      const id = await this.publish(topic, rawPayload);
      publishedIds.push(id);
      return publishedIds;
    }

    let encoder = this.fecEncoders.get(topic);
    if (!encoder) {
      encoder = new FECEncoder();
      this.fecEncoders.set(topic, encoder);
    }

    const frame: AudioFrame = {
      streamId,
      frameSeq: this.audioFrameSeq++,
      timestamp,
      payload: rawPayload,
    };

    const { encodedAudioPacket, parityPacket } = encoder.addFrame(frame);

    const audioId = await this.publish(topic, encodedAudioPacket);
    publishedIds.push(audioId);

    if (parityPacket) {
      const parityId = await this.publish(topic, parityPacket);
      publishedIds.push(parityId);
    }

    return publishedIds;
  }

  public updatePeerStats(
    peerId: string,
    packetsLost: number,
    packetsSentOrReceived: number,
  ): void {
    let monitor = this.peerLossMonitors.get(peerId);
    if (!monitor) {
      monitor = new PeerLossMonitor();
      this.peerLossMonitors.set(peerId, monitor);
    }
    monitor.updateStats(packetsLost, packetsSentOrReceived);
  }

  public getPeerLossMonitor(peerId: string): PeerLossMonitor | undefined {
    return this.peerLossMonitors.get(peerId);
  }

  public getFECReceiver(peerId: string): FECReceiver | undefined {
    return this.fecReceivers.get(peerId);
  }

  /* ----- inbound ----- */

  async handlePacket(peerId: string, data: Uint8Array): Promise<void> {
    const subscribedTopics = this.peers.get(peerId);
    if (!subscribedTopics) return;

    let packet;
    try {
      packet = decodePacket(data);
    } catch {
      this.stats.invalidDropped++;
      return;
    }

    switch (packet.type) {
      case MeshPacketType.Subscribe:
        subscribedTopics.add(packet.topic);
        return;
      case MeshPacketType.Unsubscribe:
        subscribedTopics.delete(packet.topic);
        this.mesh.get(packet.topic)?.delete(peerId);
        return;
      case MeshPacketType.Graft: {
        const members = this.mesh.get(packet.topic);
        if (!members || members.size >= this.Dhigh) {
          this.sendControl(peerId, MeshPacketType.Prune, packet.topic);
        } else {
          subscribedTopics.add(packet.topic);
          members.add(peerId);
        }
        return;
      }
      case MeshPacketType.Prune:
        this.mesh.get(packet.topic)?.delete(peerId);
        return;
      case MeshPacketType.Publish:
        await this.handlePublish(peerId, packet);
        return;
    }
  }

  private async handlePublish(
    fromPeer: string,
    packet: PublishPacket,
  ): Promise<void> {
    if (packet.hops >= this.maxHops || !this.subscriptions.has(packet.topic)) {
      this.stats.unsubscribedDropped++;
      return;
    }

    const signingBytes = getSigningBytes(packet);
    const idBytes = await sha256(signingBytes);
    if (this.seen.has(idBytes)) {
      this.stats.duplicatesDropped++;
      return;
    }

    if (!(await verifyEd25519(packet.from, signingBytes, packet.signature))) {
      this.stats.invalidDropped++;
      return;
    }
    if (this.seen.has(idBytes)) {
      this.stats.duplicatesDropped++;
      return;
    }
    this.seen.add(idBytes);

    this.deliver({
      id: toHex(idBytes),
      topic: packet.topic,
      from: toHex(packet.from),
      seqno: packet.seqno,
      payload: packet.payload,
      hops: packet.hops,
      receivedFrom: fromPeer,
    });

    const forwarded = encodePacket({ ...packet, hops: packet.hops + 1 });
    for (const peerId of this.mesh.get(packet.topic) ?? []) {
      if (peerId === fromPeer) continue;
      this.enqueueSend(peerId, forwarded);
      this.stats.forwarded++;
    }
  }

  /* ----- internals ----- */

  private deliver(message: GossipMessage): void {
    this.stats.delivered++;
    this.opts.onMessage?.(message);

    if (isFECPacket(message.payload)) {
      try {
        const decoded = decodeFECPacket(message.payload);
        const streamId =
          decoded.type === AudioPacketType.AudioWithFEC
            ? decoded.frame.streamId
            : decoded.parityPacket.metadata.streamId;
        const receiverKey = message.receivedFrom ?? streamId;
        let receiver = this.fecReceivers.get(receiverKey);
        if (!receiver) {
          receiver = new FECReceiver();
          this.fecReceivers.set(receiverKey, receiver);
        }

        const readyFrames = receiver.processPacket(decoded, (recovered) => {
          this.opts.onAudioFrame?.(recovered, message.receivedFrom);
        });

        for (const frame of readyFrames) {
          if (
            decoded.type === AudioPacketType.AudioWithFEC &&
            frame.frameSeq === decoded.frame.frameSeq
          ) {
            this.opts.onAudioFrame?.(frame, message.receivedFrom);
          } else if (decoded.type === AudioPacketType.FECParity) {
            this.opts.onAudioFrame?.(frame, message.receivedFrom);
          }
        }
      } catch {
        // Discard invalid FEC payloads safely
      }
    }
  }

  private sendControl(
    peerId: string,
    type:
      | MeshPacketType.Subscribe
      | MeshPacketType.Unsubscribe
      | MeshPacketType.Graft
      | MeshPacketType.Prune,
    topic: string,
  ): void {
    this.enqueueSend(peerId, encodePacket({ type, topic }));
  }

  /* ----- Backpressure & Outbound Queue Management ----- */

  /**
   * Returns current outbound queue information for a given peer.
   */
  public getPeerQueueInfo(peerId: string): {
    queuedPackets: number;
    queuedBytes: number;
    isBackpressured: boolean;
    isDraining: boolean;
    isBlocked: boolean;
    blockReason: Error | null;
  } {
    const state = this.peerOutbound.get(peerId);
    if (!state) {
      return {
        queuedPackets: 0,
        queuedBytes: 0,
        isBackpressured: false,
        isDraining: false,
        isBlocked: false,
        blockReason: null,
      };
    }
    return {
      queuedPackets: state.queue.length,
      queuedBytes: state.queueBytes,
      isBackpressured: state.isBackpressured,
      isDraining: state.isDraining,
      isBlocked: state.isBlocked,
      blockReason: state.blockReason,
    };
  }

  /**
   * Resets a blocked peer's queue and clears backpressure/blocked state so traffic or snapshot reconciliation can resume.
   */
  public resetPeerQueue(peerId: string): void {
    const state = this.peerOutbound.get(peerId);
    if (!state) return;

    if (state.channel && state.lowListener) {
      try {
        state.channel.removeEventListener("bufferedamountlow", state.lowListener);
      } catch {
        // Ignore
      }
      state.lowListener = null;
    }

    state.queue.length = 0;
    state.queueBytes = 0;
    state.isBlocked = false;
    state.blockReason = null;
    state.isBackpressured = false;
    state.isDraining = false;

    const waiters = [...state.drainWaiters];
    state.drainWaiters.length = 0;
    for (const w of waiters) {
      w.resolve();
    }
  }

  /**
   * Waits for all pending queued packets for a specific peer to be transmitted.
   * If peerId is omitted, waits for all peers to drain.
   */
  public async flush(peerId?: string): Promise<void> {
    if (peerId) {
      const state = this.peerOutbound.get(peerId);
      if (!state) {
        return;
      }
      if (state.isBlocked && state.blockReason) {
        throw state.blockReason;
      }
      if (state.queue.length === 0 && !state.isDraining) {
        return;
      }
      return new Promise<void>((resolve, reject) => {
        state.drainWaiters.push({ resolve, reject });
      });
    }

    const waitAll: Promise<void>[] = [];
    for (const [id, state] of this.peerOutbound.entries()) {
      if (state.isBlocked && state.blockReason) {
        waitAll.push(Promise.reject(state.blockReason));
      } else if (state.queue.length > 0 || state.isDraining) {
        waitAll.push(
          new Promise<void>((resolve, reject) => {
            state.drainWaiters.push({ resolve, reject });
          }),
        );
      }
    }
    await Promise.all(waitAll);
  }

  /**
   * Enqueues data for transmission to a peer, respecting backpressure and buffer limits.
   */
  public enqueueSend(peerId: string, data: Uint8Array): boolean {
    if (this.isDestroyed) return false;

    let state = this.peerOutbound.get(peerId);
    if (!state) {
      state = {
        queue: [],
        queueBytes: 0,
        isDraining: false,
        isBackpressured: false,
        isBlocked: false,
        blockReason: null,
        lowListener: null,
        channel: null,
        drainWaiters: [],
      };
      this.peerOutbound.set(peerId, state);
    }

    // If queue is blocked due to retry exhaustion, reject incoming packets
    if (state.isBlocked) {
      const err = state.blockReason ?? new PeerQueueBlockedError(peerId, `Peer queue ${peerId} is blocked due to retry exhaustion`);
      if (this.overflowPolicy === "throw") {
        throw err;
      }
      this.stats.packetsDroppedOverflow++;
      this.opts.backpressure?.onPacketDropped?.(peerId, data.byteLength, err.message);
      return false;
    }

    // Attempt to resolve channel reference if available
    this.refreshChannelRef(peerId, state);

    // Overflow protection: reject if queue capacity exceeded
    if (
      state.queue.length >= this.maxQueuePackets ||
      state.queueBytes + data.byteLength > this.maxQueueBytes
    ) {
      this.stats.packetsDroppedOverflow++;
      const reason = `Queue overflow: length=${state.queue.length}/${this.maxQueuePackets}, bytes=${state.queueBytes + data.byteLength}/${this.maxQueueBytes}`;
      this.opts.backpressure?.onPacketDropped?.(peerId, data.byteLength, reason);
      if (this.overflowPolicy === "throw") {
        throw new QueueOverflowError(peerId, data.byteLength, reason);
      }
      return false;
    }

    state.queue.push({ data, operationRetries: 0 });
    state.queueBytes += data.byteLength;

    if (!state.isDraining) {
      this.drainQueue(peerId, state);
    }

    return true;
  }

  private refreshChannelRef(peerId: string, state: PeerOutboundState): void {
    if (this.opts.getDataChannel) {
      try {
        const ch = this.opts.getDataChannel(peerId);
        if (ch && ch !== state.channel) {
          if (state.channel && state.lowListener) {
            try {
              state.channel.removeEventListener("bufferedamountlow", state.lowListener);
            } catch {
              // Ignore cleanup error on old channel
            }
          }
          state.channel = ch;
          state.lowListener = null;
        }
      } catch {
        // Safe fallback if getDataChannel throws
      }
    }
  }

  private setBackpressured(
    peerId: string,
    state: PeerOutboundState,
    backpressured: boolean,
  ): void {
    if (state.isBackpressured !== backpressured) {
      state.isBackpressured = backpressured;
      try {
        this.opts.backpressure?.onBackpressureChange?.(peerId, backpressured);
      } catch {
        // Ignore consumer callback error
      }
    }
  }

  private async drainQueue(peerId: string, state: PeerOutboundState): Promise<void> {
    if (state.isDraining) return;
    state.isDraining = true;

    try {
      while (state.queue.length > 0 && !this.isDestroyed) {
        this.refreshChannelRef(peerId, state);
        const channel = state.channel;

        if (channel) {
          // If channel is closed or closing, drop pending sends and abort
          const readyState = channel.readyState;
          if (readyState === "closing" || readyState === "closed") {
            const err = new Error(`RTCDataChannel for peer ${peerId} is ${readyState}`);
            this.cleanupPeerOutbound(peerId, err);
            return;
          }

          // If channel is not yet open, wait briefly or yield
          if (readyState === "connecting") {
            await new Promise<void>((r) => setTimeout(r, 20));
            continue;
          }

          // Check if bufferedAmount exceeds high watermark
          if (channel.bufferedAmount >= this.highWatermark) {
            this.setBackpressured(peerId, state, true);
            this.stats.backpressureWaitEvents++;
            const drained = await this.waitForChannelDrain(peerId, channel, state);
            if (!drained) {
              // Timeout or channel closed during wait
              if (channel.readyState !== "open") {
                this.cleanupPeerOutbound(
                  peerId,
                  new Error(`DataChannel closed while awaiting backpressure drain`),
                );
                return;
              }
            }
            continue;
          } else if (channel.bufferedAmount <= this.lowWatermark) {
            this.setBackpressured(peerId, state, false);
          }
        }

        const nextPacket = state.queue.shift();
        if (!nextPacket) break;
        const nextData = nextPacket.data;
        state.queueBytes -= nextData.byteLength;

        try {
          const res = this.opts.send(peerId, nextData);
          if (res && typeof (res as Promise<void>).then === "function") {
            await res;
          }
        } catch (err: unknown) {
          // Handle WebRTC OperationError or transmission fault
          const isOpError =
            err instanceof Error &&
            (err.name === "OperationError" ||
              err.message.toLowerCase().includes("operationerror") ||
              err.message.toLowerCase().includes("bufferedamount"));

          if (isOpError && channel && nextPacket.operationRetries < MAX_OPERATION_RETRIES) {
            nextPacket.operationRetries++;
            this.setBackpressured(peerId, state, true);
            // Put item back at the head of queue to preserve strict CRDT ordering
            state.queue.unshift(nextPacket);
            state.queueBytes += nextData.byteLength;
            this.stats.backpressureWaitEvents++;
            await this.waitForChannelDrain(peerId, channel, state);
            continue;
          } else if (isOpError && channel) {
            // Retry limit exceeded for OperationError.
            // Never skip a previously accepted packet and send subsequent dependent operations,
            // as this violates CRDT causal ordering. Mark the queue as blocked and reject waiters.
            state.queue.unshift(nextPacket);
            state.queueBytes += nextData.byteLength;
            state.isBlocked = true;
            const blockError = new PeerQueueBlockedError(
              peerId,
              `Outbound queue blocked for peer ${peerId}: OperationError retry limit (${MAX_OPERATION_RETRIES}) exceeded`,
            );
            state.blockReason = blockError;
            this.setBackpressured(peerId, state, true);
            this.opts.backpressure?.onQueueBlocked?.(peerId, blockError);
            this.stats.packetsDroppedOverflow++;

            // Reject pending flush waiters for this peer
            const waiters = [...state.drainWaiters];
            state.drainWaiters.length = 0;
            for (const w of waiters) {
              w.reject(blockError);
            }
            return;
          } else {
            // Unrecoverable send error or transport failure; log and drop this packet
            this.stats.packetsDroppedOverflow++;
            this.opts.backpressure?.onPacketDropped?.(
              peerId,
              nextData.byteLength,
              `Send failed: ${err instanceof Error ? err.message : String(err)} (retries: ${nextPacket.operationRetries})`,
            );
          }
        }
      }

      // Check final backpressure state
      if (state.channel && state.channel.bufferedAmount <= this.lowWatermark) {
        this.setBackpressured(peerId, state, false);
      }
    } finally {
      state.isDraining = false;
      if (state.queue.length === 0) {
        const waiters = [...state.drainWaiters];
        state.drainWaiters.length = 0;
        for (const w of waiters) {
          w.resolve();
        }
      }
    }
  }

  private waitForChannelDrain(
    peerId: string,
    channel: RTCDataChannel,
    state: PeerOutboundState,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      try {
        channel.bufferedAmountLowThreshold = this.lowWatermark;
      } catch {
        // Setting bufferedAmountLowThreshold might not be supported in some mocks
      }

      if (channel.bufferedAmount <= this.lowWatermark) {
        resolve(true);
        return;
      }

      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (state.lowListener) {
          try {
            channel.removeEventListener("bufferedamountlow", state.lowListener);
          } catch {
            // Ignore
          }
          state.lowListener = null;
        }
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      };

      const onLow = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(true);
      };

      state.lowListener = onLow;
      try {
        channel.addEventListener("bufferedamountlow", onLow);
      } catch {
        // Fallback to polling if addEventListener fails
      }

      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        // Resolve true if below high watermark, false if still stalled
        resolve(channel.bufferedAmount < this.highWatermark);
      }, this.drainTimeoutMs);
      if (typeof (timer as unknown as { unref?: () => void }).unref === "function") {
        (timer as unknown as { unref: () => void }).unref();
      }
    });
  }

  private cleanupPeerOutbound(peerId: string, error: Error): void {
    const state = this.peerOutbound.get(peerId);
    if (!state) return;

    if (state.channel && state.lowListener) {
      try {
        state.channel.removeEventListener("bufferedamountlow", state.lowListener);
      } catch {
        // Ignore
      }
      state.lowListener = null;
    }

    state.queue.length = 0;
    state.queueBytes = 0;
    this.setBackpressured(peerId, state, false);

    const waiters = [...state.drainWaiters];
    state.drainWaiters.length = 0;
    for (const w of waiters) {
      w.reject(error);
    }

    this.peerOutbound.delete(peerId);
  }

  private shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
}
 main
