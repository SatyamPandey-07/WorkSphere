import { GossipSubPeerScorer, DEFAULT_THRESHOLDS } from "@/core/p2p/GossipSubPeerScorer";
import { getPeerHealth, buildMeshSnapshot } from "@/core/p2p/peerHealth";

describe("getPeerHealth", () => {
  it("maps scores to statuses at the threshold boundaries", () => {
    expect(getPeerHealth(10)).toBe("good");
    expect(getPeerHealth(9.99)).toBe("neutral");
    expect(getPeerHealth(-10)).toBe("neutral");
    expect(getPeerHealth(-10.01)).toBe("penalized");
    expect(getPeerHealth(-80)).toBe("penalized");
    expect(getPeerHealth(-80.01)).toBe("blacklisted");
  });

  it("respects custom thresholds", () => {
    const t = { ...DEFAULT_THRESHOLDS, graylistThreshold: -20 };
    expect(getPeerHealth(-25, t)).toBe("blacklisted");
  });
});

describe("buildMeshSnapshot", () => {
  let scorer: GossipSubPeerScorer;
  beforeEach(() => {
    scorer = new GossipSubPeerScorer({ topics: new Map(), decayIntervalMs: 0 });
  });
  afterEach(() => scorer.dispose());

  it("counts connected peers and mesh members", () => {
    scorer.joinTopic("a", "t");
    scorer.joinTopic("b", "t");
    scorer.leaveTopic("b", "t");
    const snap = buildMeshSnapshot(scorer);
    expect(snap.connected).toBe(2);
    expect(snap.meshMembers).toBe(1);
  });

  it("counts Sybil penalties for peers sharing an IP above threshold", () => {
    ["a", "b", "c"].forEach((id) => scorer.setIP(id, "1.2.3.4"));
    scorer.setIP("d", "5.6.7.8");
    const snap = buildMeshSnapshot(scorer);
    expect(snap.sybilPenalized).toBe(3);
    const a = snap.peers.find((p) => p.peerId === "a")!;
    expect(a.breakdown.sybil).toBe(-5); // excess 1 -> 1*1*-5
    expect(snap.peers.find((p) => p.peerId === "d")!.sybilPenalized).toBe(false);
  });

  it("reports the P4 invalid message penalty in the breakdown", () => {
    scorer.recordInvalidMessage("a", "t");
    const row = buildMeshSnapshot(scorer).peers[0];
    expect(row.breakdown.p4).toBe(-10);
  });
});
