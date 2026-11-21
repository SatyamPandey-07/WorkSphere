import {
  compareHLC,
  HybridLogicalClock,
  parseHLC,
  serializeHLC,
 fix/vector-clock-atomic-tick
} from '../HybridLogicalClock';

describe('HybridLogicalClock', () => {
  it('maintains monotonic ordering when physical clock stalls or steps backward', () => {
    const hlc = new HybridLogicalClock('peer-a', { pt: 2000, lc: 0 });

} from "../HybridLogicalClock";

describe("HybridLogicalClock", () => {
  it("maintains monotonic ordering when physical clock stalls or steps backward", () => {
    const hlc = new HybridLogicalClock("peer-a", { pt: 2000, lc: 0 });
 main

    const t1 = hlc.tick(2000);
    const t2 = hlc.tick(1500); // simulated clock skew backward

    expect(compareHLC(t1, t2)).toBeLessThan(0);
    expect(t2.pt).toBe(2000);
    expect(t2.lc).toBe(2);
  });

 fix/vector-clock-atomic-tick
  it('advances past remote clock ahead of local physical time and rejects stale updates', () => {
    const peerA = new HybridLogicalClock('peer-a', { pt: 1000, lc: 0 });
    const peerB = new HybridLogicalClock('peer-b', { pt: 5000, lc: 3 });

  it("advances past remote clock ahead of local physical time and rejects stale updates", () => {
    const peerA = new HybridLogicalClock("peer-a", { pt: 1000, lc: 0 });
    const peerB = new HybridLogicalClock("peer-b", { pt: 5000, lc: 3 });

    const remoteStamp = peerB.tick(5000);
    const merged = peerA.receive(remoteStamp, 1100);

    expect(merged.pt).toBe(5000);
    expect(merged.lc).toBe(4);
    expect(compareHLC(remoteStamp, merged)).toBeLessThan(0);

    const staleStamp = { pt: 1200, lc: 1, nodeId: 'peer-c' };

    expect(merged.lc).toBe(5);
    expect(compareHLC(remoteStamp, merged)).toBeLessThan(0);

    const staleStamp = { pt: 1200, lc: 1, nodeId: "peer-c" };
 main
    expect(peerA.shouldApplyUpdate(staleStamp, merged)).toBe(false);
    expect(peerA.shouldApplyUpdate(peerB.tick(6000), merged)).toBe(true);
  });

 fix/vector-clock-atomic-tick
  it('round-trips serialized HLC tokens cleanly', () => {
    const hlc = new HybridLogicalClock('node:west-1', { pt: 1732000000000, lc: 7 });

  it("round-trips serialized HLC tokens cleanly", () => {
    const hlc = new HybridLogicalClock("node:west-1", {
      pt: 1732000000000,
      lc: 7,
    });
 main
    const encoded = serializeHLC(hlc.now());
    const decoded = parseHLC(encoded);

    expect(decoded).toEqual({
      pt: 1732000000000,
      lc: 7,
 fix/vector-clock-atomic-tick
      nodeId: 'node:west-1',
    });
  });
});

      nodeId: "node:west-1",
    });
  });
});
 main
