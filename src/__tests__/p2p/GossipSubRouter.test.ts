/**
 * @jest-environment node
 */
import {
  GossipSubRouter,
  GossipMessage,
  RotatingBloomFilter,
  generateEd25519Identity,
  sha256,
  GOSSIP_D,
  GOSSIP_D_LOW,
  GOSSIP_D_HIGH,
} from '@/core/p2p/GossipSubRouter';
import {
  MeshPacketType,
  decodePacket,
  encodePacket,
} from '@/core/p2p/MeshPacketSerializer';

const TOPIC = 'sos/nomad-hub';
const enc = (s: string) => new TextEncoder().encode(s);

// Small deterministic PRNG so the simulated topology is reproducible.
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SimNode {
  id: string;
  router: GossipSubRouter;
  received: GossipMessage[];
}

class SimNetwork {
  nodes = new Map<string, SimNode>();
  private pending = new Set<Promise<void>>();
  sentPackets: { from: string; to: string; type: number }[] = [];

  async addNode(id: string, rand: () => number): Promise<SimNode> {
    const received: GossipMessage[] = [];
    const router = new GossipSubRouter({
      localPeerId: id,
      identity: await generateEd25519Identity(),
      random: rand,
      send: (to, data) => this.deliver(id, to, data),
      onMessage: (m) => received.push(m),
    });
    const node = { id, router, received };
    this.nodes.set(id, node);
    return node;
  }

  link(a: string, b: string) {
    this.nodes.get(a)!.router.addPeer(b);
    this.nodes.get(b)!.router.addPeer(a);
  }

  private deliver(from: string, to: string, data: Uint8Array) {
    this.sentPackets.push({ from, to, type: decodePacket(data).type });
    const p: Promise<void> = Promise.resolve()
      .then(() => this.nodes.get(to)?.router.handlePacket(from, data))
      .finally(() => this.pending.delete(p));
    this.pending.add(p);
  }

  async settle() {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  async heartbeats(rounds = 4) {
    for (let r = 0; r < rounds; r++) {
      for (const n of this.nodes.values()) n.router.heartbeat();
      await this.settle();
    }
  }
}

describe('RotatingBloomFilter', () => {
  it('remembers added IDs and reports unseen ones as absent', async () => {
    const bloom = new RotatingBloomFilter(256);
    const ids = await Promise.all(Array.from({ length: 200 }, (_, i) => sha256(enc(`m${i}`))));
    ids.forEach((id) => bloom.add(id));
    expect(ids.every((id) => bloom.has(id))).toBe(true);
    const fresh = await Promise.all(Array.from({ length: 500 }, (_, i) => sha256(enc(`x${i}`))));
    expect(fresh.filter((id) => bloom.has(id)).length).toBe(0);
  });

  it('keeps bounded memory by forgetting IDs two generations old', async () => {
    const bloom = new RotatingBloomFilter(10);
    const first = await sha256(enc('first'));
    bloom.add(first);
    for (let i = 0; i < 10; i++) bloom.add(await sha256(enc(`a${i}`)));
    expect(bloom.has(first)).toBe(true); // previous generation
    for (let i = 0; i < 10; i++) bloom.add(await sha256(enc(`b${i}`)));
    expect(bloom.has(first)).toBe(false);
  });
});

describe('GossipSubRouter mesh maintenance', () => {
  it('uses the specified degrees D=6, D_low=4, D_high=12', () => {
    expect([GOSSIP_D, GOSSIP_D_LOW, GOSSIP_D_HIGH]).toEqual([6, 4, 12]);
  });

  it('grafts up to D peers when the mesh is below D_low', async () => {
    const net = new SimNetwork();
    const rand = mulberry32(1);
    await net.addNode('hub', rand);
    for (let i = 0; i < 30; i++) {
      await net.addNode(`p${i}`, rand);
      net.link('hub', `p${i}`);
      net.nodes.get(`p${i}`)!.router.subscribe(TOPIC);
    }
    net.nodes.get('hub')!.router.subscribe(TOPIC);
    await net.settle();
    net.nodes.get('hub')!.router.heartbeat();
    expect(net.nodes.get('hub')!.router.getMeshPeers(TOPIC)).toHaveLength(GOSSIP_D);
  });

  it('rejects GRAFT with PRUNE once the mesh holds D_high peers', async () => {
    const net = new SimNetwork();
    const rand = mulberry32(2);
    await net.addNode('hub', rand);
    net.nodes.get('hub')!.router.subscribe(TOPIC);
    for (let i = 0; i < GOSSIP_D_HIGH + 2; i++) {
      await net.addNode(`p${i}`, rand);
      net.link('hub', `p${i}`);
      await net.nodes
        .get('hub')!
        .router.handlePacket(`p${i}`, encodePacket({ type: MeshPacketType.Graft, topic: TOPIC }));
    }
    expect(net.nodes.get('hub')!.router.getMeshPeers(TOPIC)).toHaveLength(GOSSIP_D_HIGH);
    const prunes = net.sentPackets.filter((p) => p.type === MeshPacketType.Prune && p.from === 'hub');
    expect(prunes).toHaveLength(2);
  });

  it('removes a departed peer from the mesh and re-grafts a replacement', async () => {
    const net = new SimNetwork();
    const rand = mulberry32(3);
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    for (const id of ids) await net.addNode(id, rand);
    for (const id of ids.slice(1)) net.link('a', id);
    for (const id of ids) net.nodes.get(id)!.router.subscribe(TOPIC);
    await net.settle();
    const router = net.nodes.get('a')!.router;
    const victim = router.getMeshPeers(TOPIC)[0];
    router.removePeer(victim);
    expect(router.getMeshPeers(TOPIC)).not.toContain(victim);
    router.heartbeat();
    expect(router.getMeshPeers(TOPIC).length).toBeGreaterThanOrEqual(GOSSIP_D_LOW);
  });
});

describe('GossipSubRouter message security & deduplication', () => {
  async function pair() {
    const net = new SimNetwork();
    const rand = mulberry32(4);
    const alice = await net.addNode('alice', rand);
    const bob = await net.addNode('bob', rand);
    net.link('alice', 'bob');
    alice.router.subscribe(TOPIC);
    bob.router.subscribe(TOPIC);
    await net.settle();
    await net.heartbeats(1);
    return { net, alice, bob };
  }

  it('delivers a signed message and keeps the origin public key', async () => {
    const { net, alice, bob } = await pair();
    const id = await alice.router.publish(TOPIC, enc('evacuate north ridge'));
    await net.settle();
    expect(bob.received).toHaveLength(1);
    expect(new TextDecoder().decode(bob.received[0].payload)).toBe('evacuate north ridge');
    expect(bob.received[0].id).toBe(id);
    expect(bob.received[0].hops).toBe(1);
  });

  it('drops messages with a tampered payload', async () => {
    const { bob } = await pair();
    const origin = await generateEd25519Identity();
    const captured: Uint8Array[] = [];
    // Capture the genuine bytes by publishing through a router whose transport we own.
    const sender = new GossipSubRouter({
      localPeerId: 'mallory',
      identity: origin,
      send: (_to, data) => captured.push(data),
    });
    sender.addPeer('bob');
    await sender.handlePacket('bob', encodePacket({ type: MeshPacketType.Subscribe, topic: TOPIC }));
    sender.subscribe(TOPIC);
    await sender.publish(TOPIC, enc('real alert'));
    const genuine = captured.map(decodePacket).find((p) => p.type === MeshPacketType.Publish)!;
    if (genuine.type !== MeshPacketType.Publish) throw new Error('expected publish');

    bob.router.addPeer('mallory');
    const forged = encodePacket({ ...genuine, payload: enc('fake alert') });
    await bob.router.handlePacket('mallory', forged);
    expect(bob.received).toHaveLength(0);
    expect(bob.router.getStats().invalidDropped).toBe(1);

    // The forged copy must not shadow the genuine one.
    await bob.router.handlePacket('mallory', encodePacket(genuine));
    expect(bob.received).toHaveLength(1);
    expect(new TextDecoder().decode(bob.received[0].payload)).toBe('real alert');
  });

  it('drops malformed packets and packets from unknown peers without throwing', async () => {
    const { bob } = await pair();
    await bob.router.handlePacket('alice', new Uint8Array([1, 1, 0]));
    await bob.router.handlePacket('stranger', encodePacket({ type: MeshPacketType.Graft, topic: TOPIC }));
    expect(bob.router.getStats().invalidDropped).toBe(1);
    expect(bob.router.getMeshPeers(TOPIC)).toEqual(['alice']);
  });

  it('suppresses a replayed duplicate', async () => {
    const { net, bob } = await pair();
    const captured: Uint8Array[] = [];
    const spy = new GossipSubRouter({
      localPeerId: 'spy',
      identity: await generateEd25519Identity(),
      send: (_to, d) => captured.push(d),
    });
    spy.addPeer('bob');
    await spy.handlePacket('bob', encodePacket({ type: MeshPacketType.Subscribe, topic: TOPIC }));
    await spy.publish(TOPIC, enc('once only'));
    const pkt = captured.find((d) => d[1] === MeshPacketType.Publish)!;
    bob.router.addPeer('spy');
    await bob.router.handlePacket('spy', pkt);
    await bob.router.handlePacket('spy', pkt);
    await net.settle();
    expect(bob.received).toHaveLength(1);
    expect(bob.router.getStats().duplicatesDropped).toBe(1);
  });

  it('never loops a message around a fully connected triangle', async () => {
    const net = new SimNetwork();
    const rand = mulberry32(6);
    for (const id of ['x', 'y', 'z']) await net.addNode(id, rand);
    net.link('x', 'y');
    net.link('y', 'z');
    net.link('z', 'x');
    for (const n of net.nodes.values()) n.router.subscribe(TOPIC);
    await net.settle();
    await net.heartbeats(2);
    await net.nodes.get('x')!.router.publish(TOPIC, enc('ping'));
    await net.settle();
    for (const id of ['y', 'z']) expect(net.nodes.get(id)!.received).toHaveLength(1);
    expect(net.nodes.get('x')!.received).toHaveLength(1); // local delivery only
    const publishSends = net.sentPackets.filter((p) => p.type === MeshPacketType.Publish).length;
    expect(publishSends).toBeLessThanOrEqual(6);
  });
});

describe('GossipSubRouter 20-node propagation (#7278 acceptance)', () => {
  it('reaches every node in under 5 hops with bounded duplicate traffic', async () => {
    const N = 20;
    const rand = mulberry32(7);
    const net = new SimNetwork();
    const ids = Array.from({ length: N }, (_, i) => `n${i}`);
    for (const id of ids) await net.addNode(id, rand);

    // Sparse physical graph: ring for connectivity + random chords (avg degree ~6).
    const linked = new Set<string>();
    const connect = (a: number, b: number) => {
      const key = [Math.min(a, b), Math.max(a, b)].join('-');
      if (a === b || linked.has(key)) return;
      linked.add(key);
      net.link(ids[a], ids[b]);
    };
    for (let i = 0; i < N; i++) connect(i, (i + 1) % N);
    while (linked.size < N * 3) connect(Math.floor(rand() * N), Math.floor(rand() * N));

    for (const n of net.nodes.values()) n.router.subscribe(TOPIC);
    await net.settle();
    await net.heartbeats(5);

    for (const n of net.nodes.values()) {
      const degree = n.router.getMeshPeers(TOPIC).length;
      expect(degree).toBeGreaterThanOrEqual(1);
      expect(degree).toBeLessThanOrEqual(GOSSIP_D_HIGH);
    }

    const before = net.sentPackets.filter((p) => p.type === MeshPacketType.Publish).length;
    await net.nodes.get('n0')!.router.publish(TOPIC, enc('EMERGENCY: hub link down, relay to all'));
    await net.settle();

    let maxHops = 0;
    for (const id of ids.slice(1)) {
      const got = net.nodes.get(id)!.received;
      expect(got).toHaveLength(1); // delivered exactly once
      maxHops = Math.max(maxHops, got[0].hops);
    }
    expect(maxHops).toBeLessThan(5);

    const publishSends = net.sentPackets.filter((p) => p.type === MeshPacketType.Publish).length - before;
    expect(publishSends).toBeLessThanOrEqual(N * GOSSIP_D_HIGH); // no forwarding storm
  });
});
