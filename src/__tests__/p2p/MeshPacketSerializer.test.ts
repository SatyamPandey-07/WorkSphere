/**
 * @jest-environment node
 */
import {
  MeshPacketType,
  MeshPacketError,
  PublishPacket,
  encodePacket,
  decodePacket,
  getSigningBytes,
} from '@/core/p2p/MeshPacketSerializer';

const makePublish = (over: Partial<PublishPacket> = {}): PublishPacket => ({
  type: MeshPacketType.Publish,
  hops: 0,
  topic: 'sos/nomad-hub',
  from: new Uint8Array(32).fill(7),
  seqno: 42,
  payload: new TextEncoder().encode('flood warning: move to high ground'),
  signature: new Uint8Array(64).fill(9),
  ...over,
});

describe('MeshPacketSerializer (#7278)', () => {
  it('round-trips a PUBLISH packet', () => {
    const pkt = makePublish({ hops: 3 });
    expect(decodePacket(encodePacket(pkt))).toEqual(pkt);
  });

  it('round-trips seqno values above 2^32', () => {
    const pkt = makePublish({ seqno: 2 ** 40 + 5 });
    expect(decodePacket(encodePacket(pkt))).toMatchObject({ seqno: 2 ** 40 + 5 });
  });

  it.each([
    MeshPacketType.Subscribe,
    MeshPacketType.Unsubscribe,
    MeshPacketType.Graft,
    MeshPacketType.Prune,
  ] as const)('round-trips control packet type %s', (type) => {
    const pkt = { type, topic: 'ünï-topic' };
    expect(decodePacket(encodePacket(pkt))).toEqual(pkt);
  });

  it('keeps control packets compact (2-byte header + topic)', () => {
    expect(encodePacket({ type: MeshPacketType.Graft, topic: 'abc' }).length).toBe(6);
  });

  it('excludes hops from the signing bytes but includes topic, seqno and payload', () => {
    const a = makePublish({ hops: 0 });
    const b = makePublish({ hops: 9 });
    expect(getSigningBytes(a)).toEqual(getSigningBytes(b));
    expect(getSigningBytes(a)).not.toEqual(getSigningBytes(makePublish({ seqno: 43 })));
    expect(getSigningBytes(a)).not.toEqual(getSigningBytes(makePublish({ topic: 'other' })));
    expect(getSigningBytes(a)).not.toEqual(
      getSigningBytes(makePublish({ payload: new Uint8Array([1]) }))
    );
  });

  it('rejects malformed input', () => {
    const good = encodePacket(makePublish());
    expect(() => decodePacket(new Uint8Array([1]))).toThrow(MeshPacketError);
    expect(() => decodePacket(Uint8Array.from([2, 1, 0, 1, 65]))).toThrow(/version/);
    expect(() => decodePacket(Uint8Array.from([1, 99, 1, 65]))).toThrow(/unknown packet type/);
    expect(() => decodePacket(good.subarray(0, good.length - 1))).toThrow(MeshPacketError);
    expect(() => decodePacket(Uint8Array.from([...good, 0]))).toThrow(MeshPacketError);
    expect(() => decodePacket(Uint8Array.from([1, 4, 9, 65]))).toThrow(/topic length/);
    expect(() => decodePacket(Uint8Array.from([1, 4, 2, 0xff, 0xfe]))).toThrow(/UTF-8/);
  });

  it('rejects invalid fields on encode', () => {
    expect(() => encodePacket(makePublish({ topic: '' }))).toThrow(MeshPacketError);
    expect(() => encodePacket(makePublish({ topic: 'x'.repeat(256) }))).toThrow(MeshPacketError);
    expect(() => encodePacket(makePublish({ from: new Uint8Array(31) }))).toThrow(MeshPacketError);
    expect(() => encodePacket(makePublish({ signature: new Uint8Array(63) }))).toThrow(
      MeshPacketError
    );
    expect(() => encodePacket(makePublish({ seqno: -1 }))).toThrow(MeshPacketError);
    expect(() => encodePacket(makePublish({ hops: 256 }))).toThrow(MeshPacketError);
  });
});
