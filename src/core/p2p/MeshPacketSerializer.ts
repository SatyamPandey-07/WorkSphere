/**
 * MeshPacketSerializer.ts
 * Compact binary wire format for the GossipSub emergency mesh (#7278).
 *
 * Layout (all integers big-endian):
 *   PUBLISH     : ver u8 | type u8 | hops u8 | topicLen u8 | topic | from[32]
 *                 | seqno u64 | payloadLen u32 | payload | signature[64]
 *   SUBSCRIBE / UNSUBSCRIBE / GRAFT / PRUNE : ver u8 | type u8 | topicLen u8 | topic
 *
 * `hops` is the only mutable field of a PUBLISH packet. It is deliberately
 * excluded from the signed bytes so relays can increment it without
 * invalidating the origin's Ed25519 signature.
 */

export const MESH_PROTOCOL_VERSION = 1;
export const ED25519_PUBLIC_KEY_BYTES = 32;
export const ED25519_SIGNATURE_BYTES = 64;
export const MAX_TOPIC_BYTES = 255;
export const MAX_PAYLOAD_BYTES = 64 * 1024;

export enum MeshPacketType {
  Publish = 1,
  Subscribe = 2,
  Unsubscribe = 3,
  Graft = 4,
  Prune = 5,
}

export interface PublishPacket {
  type: MeshPacketType.Publish;
  hops: number;
  topic: string;
  /** Origin's raw 32-byte Ed25519 public key. */
  from: Uint8Array;
  /** Origin-assigned sequence number (non-negative safe integer). */
  seqno: number;
  payload: Uint8Array;
  signature: Uint8Array;
}

export interface ControlPacket {
  type:
    | MeshPacketType.Subscribe
    | MeshPacketType.Unsubscribe
    | MeshPacketType.Graft
    | MeshPacketType.Prune;
  topic: string;
}

export type MeshPacket = PublishPacket | ControlPacket;

export class MeshPacketError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MeshPacketError';
  }
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });
const SIGNING_DOMAIN = textEncoder.encode('worksphere-gossipsub-v1');

function encodeTopic(topic: string): Uint8Array {
  const bytes = textEncoder.encode(topic);
  if (bytes.length === 0 || bytes.length > MAX_TOPIC_BYTES) {
    throw new MeshPacketError(`topic must be 1-${MAX_TOPIC_BYTES} UTF-8 bytes`);
  }
  return bytes;
}

function assertSeqno(seqno: number): void {
  if (!Number.isSafeInteger(seqno) || seqno < 0) {
    throw new MeshPacketError('seqno must be a non-negative safe integer');
  }
}

function writeSeqno(view: DataView, offset: number, seqno: number): void {
  view.setUint32(offset, Math.floor(seqno / 2 ** 32));
  view.setUint32(offset + 4, seqno >>> 0);
}

function readSeqno(view: DataView, offset: number): number {
  const hi = view.getUint32(offset);
  const lo = view.getUint32(offset + 4);
  if (hi > 0x1fffff) throw new MeshPacketError('seqno exceeds 2^53 - 1');
  return hi * 2 ** 32 + lo;
}

/**
 * Bytes covered by the origin signature (and hashed into the message ID).
 * Excludes `hops` and the signature itself.
 */
export function getSigningBytes(
  msg: Pick<PublishPacket, 'topic' | 'from' | 'seqno' | 'payload'>
): Uint8Array {
  assertSeqno(msg.seqno);
  if (msg.from.length !== ED25519_PUBLIC_KEY_BYTES) {
    throw new MeshPacketError('from must be a 32-byte Ed25519 public key');
  }
  const topic = encodeTopic(msg.topic);
  const out = new Uint8Array(
    SIGNING_DOMAIN.length + 1 + topic.length + ED25519_PUBLIC_KEY_BYTES + 8 + msg.payload.length
  );
  const view = new DataView(out.buffer);
  let o = 0;
  out.set(SIGNING_DOMAIN, o);
  o += SIGNING_DOMAIN.length;
  out[o++] = topic.length;
  out.set(topic, o);
  o += topic.length;
  out.set(msg.from, o);
  o += ED25519_PUBLIC_KEY_BYTES;
  writeSeqno(view, o, msg.seqno);
  o += 8;
  out.set(msg.payload, o);
  return out;
}

export function encodePacket(packet: MeshPacket): Uint8Array {
  const topic = encodeTopic(packet.topic);

  if (packet.type !== MeshPacketType.Publish) {
    const out = new Uint8Array(3 + topic.length);
    out[0] = MESH_PROTOCOL_VERSION;
    out[1] = packet.type;
    out[2] = topic.length;
    out.set(topic, 3);
    return out;
  }

  assertSeqno(packet.seqno);
  if (!Number.isInteger(packet.hops) || packet.hops < 0 || packet.hops > 255) {
    throw new MeshPacketError('hops must be an integer in 0-255');
  }
  if (packet.from.length !== ED25519_PUBLIC_KEY_BYTES) {
    throw new MeshPacketError('from must be a 32-byte Ed25519 public key');
  }
  if (packet.signature.length !== ED25519_SIGNATURE_BYTES) {
    throw new MeshPacketError('signature must be 64 bytes');
  }
  if (packet.payload.length > MAX_PAYLOAD_BYTES) {
    throw new MeshPacketError(`payload exceeds ${MAX_PAYLOAD_BYTES} bytes`);
  }

  const out = new Uint8Array(
    4 + topic.length + ED25519_PUBLIC_KEY_BYTES + 8 + 4 + packet.payload.length + ED25519_SIGNATURE_BYTES
  );
  const view = new DataView(out.buffer);
  let o = 0;
  out[o++] = MESH_PROTOCOL_VERSION;
  out[o++] = MeshPacketType.Publish;
  out[o++] = packet.hops;
  out[o++] = topic.length;
  out.set(topic, o);
  o += topic.length;
  out.set(packet.from, o);
  o += ED25519_PUBLIC_KEY_BYTES;
  writeSeqno(view, o, packet.seqno);
  o += 8;
  view.setUint32(o, packet.payload.length);
  o += 4;
  out.set(packet.payload, o);
  o += packet.payload.length;
  out.set(packet.signature, o);
  return out;
}

export function decodePacket(data: Uint8Array): MeshPacket {
  if (data.length < 3) throw new MeshPacketError('packet too short');
  if (data[0] !== MESH_PROTOCOL_VERSION) {
    throw new MeshPacketError(`unsupported protocol version ${data[0]}`);
  }
  const type = data[1] as MeshPacketType;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const readTopic = (offset: number): { topic: string; next: number } => {
    if (offset >= data.length) throw new MeshPacketError('truncated topic length');
    const len = data[offset];
    const end = offset + 1 + len;
    if (len === 0 || end > data.length) throw new MeshPacketError('invalid topic length');
    try {
      return { topic: textDecoder.decode(data.subarray(offset + 1, end)), next: end };
    } catch {
      throw new MeshPacketError('topic is not valid UTF-8');
    }
  };

  switch (type) {
    case MeshPacketType.Subscribe:
    case MeshPacketType.Unsubscribe:
    case MeshPacketType.Graft:
    case MeshPacketType.Prune: {
      const { topic, next } = readTopic(2);
      if (next !== data.length) throw new MeshPacketError('trailing bytes after control packet');
      return { type, topic };
    }
    case MeshPacketType.Publish: {
      const hops = data[2];
      const { topic, next } = readTopic(3);
      let o = next;
      if (o + ED25519_PUBLIC_KEY_BYTES + 8 + 4 > data.length) {
        throw new MeshPacketError('truncated publish header');
      }
      const from = data.slice(o, o + ED25519_PUBLIC_KEY_BYTES);
      o += ED25519_PUBLIC_KEY_BYTES;
      const seqno = readSeqno(view, o);
      o += 8;
      const payloadLen = view.getUint32(o);
      o += 4;
      if (payloadLen > MAX_PAYLOAD_BYTES) throw new MeshPacketError('payload too large');
      if (o + payloadLen + ED25519_SIGNATURE_BYTES !== data.length) {
        throw new MeshPacketError('publish length mismatch');
      }
      const payload = data.slice(o, o + payloadLen);
      o += payloadLen;
      const signature = data.slice(o, o + ED25519_SIGNATURE_BYTES);
      return { type, hops, topic, from, seqno, payload, signature };
    }
    default:
      throw new MeshPacketError(`unknown packet type ${data[1]}`);
  }
}
