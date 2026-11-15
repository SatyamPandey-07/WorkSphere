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
} from './MeshPacketSerializer';

export const GOSSIP_D = 6;
export const GOSSIP_D_LOW = 4;
export const GOSSIP_D_HIGH = 12;

/* ------------------------------------------------------------------ */
/* Crypto helpers                                                      */
/* ------------------------------------------------------------------ */

export interface GossipIdentity {
  /** Raw 32-byte Ed25519 public key. */
  publicKey: Uint8Array;
  sign(data: Uint8Array): Promise<Uint8Array>;
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource));
}

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

/** Generates a fresh Ed25519 identity using the Web Crypto API. */
export async function generateEd25519Identity(): Promise<GossipIdentity> {
  const pair = (await crypto.subtle.generateKey('Ed25519', true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return {
    publicKey,
    sign: async (data) =>
      new Uint8Array(await crypto.subtle.sign('Ed25519', pair.privateKey, data as BufferSource)),
  };
}

const verifyKeyCache = new Map<string, CryptoKey>();
const VERIFY_KEY_CACHE_MAX = 512;

export async function verifyEd25519(
  publicKey: Uint8Array,
  data: Uint8Array,
  signature: Uint8Array
): Promise<boolean> {
  try {
    const cacheKey = toHex(publicKey);
    let key = verifyKeyCache.get(cacheKey);
    if (!key) {
      key = await crypto.subtle.importKey('raw', publicKey as BufferSource, 'Ed25519', false, [
        'verify',
      ]);
      if (verifyKeyCache.size >= VERIFY_KEY_CACHE_MAX) {
        verifyKeyCache.delete(verifyKeyCache.keys().next().value as string);
      }
      verifyKeyCache.set(cacheKey, key);
    }
    return await crypto.subtle.verify('Ed25519', key, signature as BufferSource, data as BufferSource);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Duplicate suppression                                               */
/* ------------------------------------------------------------------ */

/**
 * Two-generation Bloom filter over 32-byte SHA-256 message IDs. When the current
 * generation holds `capacity` IDs it becomes the previous generation and a fresh
 * one starts, so memory stays bounded while the last 1x-2x `capacity` messages are
 * remembered. Bit indices use double hashing (Kirsch-Mitzenmacher) taken directly
 * from the ID bytes, which are already uniformly distributed.
 *
 * Bloom filters can return false positives (a never-seen ID reported as seen); the
 * default 1e-6 target makes that negligible, and a false negative never occurs
 * inside the retention window.
 */
export class RotatingBloomFilter {
  private readonly bitCount: number;
  private readonly hashCount: number;
  private current: Uint8Array;
  private previous: Uint8Array;
  private currentCount = 0;

  constructor(
    private readonly capacity = 4096,
    falsePositiveRate = 1e-6
  ) {
    if (capacity < 1) throw new RangeError('capacity must be >= 1');
    this.bitCount = Math.ceil((-capacity * Math.log(falsePositiveRate)) / Math.LN2 ** 2);
    this.hashCount = Math.max(1, Math.round((this.bitCount / capacity) * Math.LN2));
    this.current = new Uint8Array(Math.ceil(this.bitCount / 8));
    this.previous = new Uint8Array(this.current.length);
  }

  private indices(id: Uint8Array): number[] {
    const view = new DataView(id.buffer, id.byteOffset, id.byteLength);
    const h1 = view.getUint32(0);
    const h2 = (view.getUint32(4) | 1) >>> 0; // force odd and unsigned
    const out: number[] = [];
    for (let i = 0; i < this.hashCount; i++) out.push((h1 + i * h2) % this.bitCount);
    return out;
  }

  has(id: Uint8Array): boolean {
    const idx = this.indices(id);
    const test = (bits: Uint8Array) => idx.every((i) => (bits[i >> 3] & (1 << (i & 7))) !== 0);
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
/* Router                                                              */
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

export interface GossipSubOptions {
  localPeerId: string;
  identity: GossipIdentity;
  /** Hands bytes to the transport (e.g. an RTCDataChannel) for one peer. */
  send: (peerId: string, data: Uint8Array) => void;
  onMessage?: (message: GossipMessage) => void;
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
}

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
  };

  constructor(private readonly opts: GossipSubOptions) {
    this.D = opts.D ?? GOSSIP_D;
    this.Dlow = opts.Dlow ?? GOSSIP_D_LOW;
    this.Dhigh = opts.Dhigh ?? GOSSIP_D_HIGH;
    if (!(this.Dlow <= this.D && this.D <= this.Dhigh)) {
      throw new RangeError('mesh degrees must satisfy D_low <= D <= D_high');
    }
    if (opts.identity.publicKey.length !== ED25519_PUBLIC_KEY_BYTES) {
      throw new RangeError('identity.publicKey must be a 32-byte Ed25519 key');
    }
    this.maxHops = opts.maxHops ?? 16;
    this.random = opts.random ?? Math.random;
    this.seen = new RotatingBloomFilter(opts.bloomCapacity, opts.bloomFalsePositiveRate);
  }

  /* ----- peers & topics ----- */

  addPeer(peerId: string): void {
    if (this.peers.has(peerId) || peerId === this.opts.localPeerId) return;
    this.peers.set(peerId, new Set());
    for (const topic of this.subscriptions) {
      this.sendControl(peerId, MeshPacketType.Subscribe, topic);
    }
  }

  removePeer(peerId: string): void {
    this.peers.delete(peerId);
    for (const members of this.mesh.values()) members.delete(peerId);
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
    for (const peerId of members) this.sendControl(peerId, MeshPacketType.Prune, topic);
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
        [...this.peers].filter(([id, topics]) => topics.has(topic) && !members.has(id)).map(([id]) => id)
      );
      for (const peerId of candidates.slice(0, this.D - members.size)) {
        members.add(peerId);
        this.sendControl(peerId, MeshPacketType.Graft, topic);
      }
    } else if (members.size > this.Dhigh) {
      for (const peerId of this.shuffle([...members]).slice(0, members.size - this.D)) {
        members.delete(peerId);
        this.sendControl(peerId, MeshPacketType.Prune, topic);
      }
    }
  }

  /* ----- publishing ----- */

  /** Signs and broadcasts `payload`; resolves with the hex message ID. */
  async publish(topic: string, payload: Uint8Array): Promise<string> {
    this.seqno = Math.max(this.seqno + 1, Date.now());
    const unsigned = { topic, from: this.opts.identity.publicKey, seqno: this.seqno, payload };
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
    for (const peerId of this.publishTargets(topic)) this.opts.send(peerId, bytes);

    if (this.subscriptions.has(topic)) {
      this.deliver({ id, topic, from: toHex(packet.from), seqno: packet.seqno, payload, hops: 0, receivedFrom: null });
    }
    return id;
  }

  /** Mesh peers if we have a mesh, else up to D random peers subscribed to the topic. */
  private publishTargets(topic: string): string[] {
    const members = this.mesh.get(topic);
    if (members && members.size > 0) return [...members];
    const subscribed = [...this.peers].filter(([, t]) => t.has(topic)).map(([id]) => id);
    return this.shuffle(subscribed).slice(0, this.D);
  }

  /* ----- inbound ----- */

  /** Feed raw bytes received from `peerId` (e.g. from an RTCDataChannel `message` event). */
  async handlePacket(peerId: string, data: Uint8Array): Promise<void> {
    const subscribedTopics = this.peers.get(peerId);
    if (!subscribedTopics) return; // unknown peer

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

  private async handlePublish(fromPeer: string, packet: PublishPacket): Promise<void> {
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

    // Verify before remembering the ID so a forged copy cannot shadow the genuine message.
    if (!(await verifyEd25519(packet.from, signingBytes, packet.signature))) {
      this.stats.invalidDropped++;
      return;
    }
    // Another copy may have been accepted while we were awaiting verification.
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
      this.opts.send(peerId, forwarded);
      this.stats.forwarded++;
    }
  }

  /* ----- internals ----- */

  private deliver(message: GossipMessage): void {
    this.stats.delivered++;
    this.opts.onMessage?.(message);
  }

  private sendControl(
    peerId: string,
    type: MeshPacketType.Subscribe | MeshPacketType.Unsubscribe | MeshPacketType.Graft | MeshPacketType.Prune,
    topic: string
  ): void {
    this.opts.send(peerId, encodePacket({ type, topic }));
  }

  private shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
}
