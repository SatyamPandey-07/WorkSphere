import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import {
  GossipSubPeerScorer,
  DEFAULT_TOPIC_SCORE_PARAMS,
  MIN_PEER_SCORE,
  MAX_PEER_SCORE,
} from "../../core/p2p/GossipSubPeerScorer";

describe("GossipSubPeerScorer", () => {
  let scorer: GossipSubPeerScorer;

  beforeEach(() => {
    jest.useFakeTimers();
    scorer = new GossipSubPeerScorer({
      topics: new Map([
        [
          "alerts",
          { ...DEFAULT_TOPIC_SCORE_PARAMS, meshMessageDeliveriesThreshold: 5 },
        ],
      ]),
      decayIntervalMs: 0, // Manual decay in unit tests
      ipColocationThreshold: 2,
      ipColocationWeight: -10,
    });
  });

  afterEach(() => {
    scorer.dispose();
    jest.useRealTimers();
  });

  it("returns 0 for unrecorded peer", () => {
    expect(scorer.score("peer-unknown")).toBe(0);
  });

  it("accumulates P1 time-in-mesh score up to configured cap", () => {
    scorer.joinTopic("peer-1", "alerts");

    // 10,000ms in mesh -> 10 quanta * 0.05 = 0.5 (minus initial P3 deficit)
    // To isolate P1, meet the P3 delivery threshold first
    for (let i = 0; i < 5; i++) {
      scorer.deliverMessage("peer-1", "alerts");
    }

    const initialScore = scorer.score("peer-1", 0);
    const scoreAfter5s = scorer.score("peer-1", 5000); // 5 quanta * 0.05 = 0.25
    expect(scoreAfter5s).toBeCloseTo(initialScore + 0.25, 2);

    // After very long time, caps at timeInMeshCap (10.0)
    const scoreAfterLong = scorer.score("peer-1", 1_000_000);
    expect(scoreAfterLong).toBeLessThanOrEqual(10.0);
  });

  it("rewards P2 first message deliveries", () => {
    scorer.joinTopic("peer-1", "alerts");
    // Meet P3 threshold
    for (let i = 0; i < 5; i++) {
      scorer.deliverMessage("peer-1", "alerts");
    }

    const baseline = scorer.score("peer-1");
    scorer.deliverFirstMessage("peer-1", "alerts");
    const afterFirst = scorer.score("peer-1");

    // Default weight is 1.0
    expect(afterFirst).toBeCloseTo(baseline + 1.0, 2);
  });

  it("applies P3 message delivery deficit penalty when below threshold", () => {
    scorer.joinTopic("peer-slacker", "alerts");
    // Delivers 2 messages (threshold is 5, deficit = 3)
    // Deficit penalty = 3 * 3 * (-0.5) = -4.5
    scorer.deliverMessage("peer-slacker", "alerts");
    scorer.deliverMessage("peer-slacker", "alerts");

    const score = scorer.score("peer-slacker");
    expect(score).toBeLessThan(0);
    expect(score).toBeCloseTo(-4.5, 1);
  });

  it("applies severe quadratic P4 penalty for invalid messages", () => {
    scorer.joinTopic("peer-bad", "alerts");
    // Deliver 1 invalid message (penalty = 1^2 * -10 = -10)
    scorer.recordInvalidMessage("peer-bad", "alerts");

    const score1 = scorer.score("peer-bad");
    expect(score1).toBeLessThanOrEqual(-10);

    // Deliver 2nd invalid message (penalty = 2^2 * -10 = -40)
    scorer.recordInvalidMessage("peer-bad", "alerts");
    const score2 = scorer.score("peer-bad");
    expect(score2).toBeLessThanOrEqual(-40);
  });

  it("clamps extreme peer scores to finite configured bounds", () => {
    scorer.setAppSpecificScore("peer-positive", Number.MAX_VALUE);
    scorer.setAppSpecificScore("peer-negative", -Number.MAX_VALUE);
    scorer.setAppSpecificScore("peer-not-a-number", Number.NaN);

    expect(scorer.score("peer-positive")).toBe(MAX_PEER_SCORE);
    expect(scorer.score("peer-negative")).toBe(MIN_PEER_SCORE);
    expect(scorer.score("peer-not-a-number")).toBe(MIN_PEER_SCORE);
    expect(Number.isFinite(scorer.score("peer-positive"))).toBe(true);
    expect(Number.isFinite(scorer.score("peer-negative"))).toBe(true);
  });

  it("bounds extreme invalid-message penalties without numeric underflow", () => {
    scorer.setTopicParams("alerts", {
      invalidMessageDeliveriesWeight: -Number.MAX_VALUE,
    });
    scorer.joinTopic("peer-abusive", "alerts");
    for (let index = 0; index < 50; index++) {
      scorer.recordInvalidMessage("peer-abusive", "alerts");
    }

    expect(scorer.score("peer-abusive")).toBe(MIN_PEER_SCORE);
    expect(
      Number.isFinite(scorer.getPeerStats("peer-abusive")?.overallScore),
    ).toBe(true);
  });

  it("preserves finite counters when a decay factor is invalid", () => {
    scorer.setTopicParams("alerts", {
      invalidMessageDeliveriesDecay: Number.NaN,
    });
    scorer.recordInvalidMessage("peer-decay", "alerts");

    scorer.decayScores();

    const topicStats = scorer.getPeerStats("peer-decay")?.topics.get("alerts");
    expect(Number.isFinite(topicStats?.invalidMessages)).toBe(true);
    expect(topicStats?.invalidMessages).toBe(1);
    expect(scorer.score("peer-decay")).toBeCloseTo(-10, 2);
  });

  it("enforces behavioral thresholds (gossip, publish, graylist)", () => {
    scorer.joinTopic("peer-evil", "alerts");
    for (let i = 0; i < 5; i++) {
      scorer.deliverMessage("peer-evil", "alerts");
    }

    // Good standing after meeting the mesh delivery threshold.
    expect(scorer.shouldGossip("peer-evil")).toBe(true);
    expect(scorer.shouldPublish("peer-evil")).toBe(true);
    expect(scorer.isGraylisted("peer-evil")).toBe(false);

    // 2 invalid messages -> -40, below gossipThreshold and at publishThreshold.
    scorer.recordInvalidMessage("peer-evil", "alerts");
    scorer.recordInvalidMessage("peer-evil", "alerts");
    expect(scorer.shouldGossip("peer-evil")).toBe(false);
    expect(scorer.shouldPublish("peer-evil")).toBe(true);

    // 3 invalid messages -> -90 (below graylistThreshold -80)
    scorer.recordInvalidMessage("peer-evil", "alerts");
    expect(scorer.isGraylisted("peer-evil")).toBe(true);
    expect(scorer.shouldPublish("peer-evil")).toBe(false);
  });

  it("penalizes IP colocation clustering (Sybil mitigation)", () => {
    const ip = "192.168.1.100";
    // Threshold is 2
    scorer.setIP("peer-sybil-1", ip);
    scorer.setIP("peer-sybil-2", ip);
    // 2 peers = no penalty
    expect(scorer.score("peer-sybil-1")).toBe(0);

    // 3rd peer on same IP -> excess = 1 -> penalty = 1^2 * -10 = -10
    scorer.setIP("peer-sybil-3", ip);
    expect(scorer.score("peer-sybil-1")).toBe(-10);
    expect(scorer.score("peer-sybil-2")).toBe(-10);
    expect(scorer.score("peer-sybil-3")).toBe(-10);

    // 4th peer on same IP -> excess = 2 -> penalty = 2^2 * -10 = -40
    scorer.setIP("peer-sybil-4", ip);
    expect(scorer.score("peer-sybil-1")).toBe(-40);
  });

  it("decays metrics geometrically on decayScores()", () => {
    scorer.joinTopic("peer-active", "alerts");
    scorer.deliverFirstMessage("peer-active", "alerts"); // 1 first delivery
    scorer.recordDeliveryFailure("peer-active", "alerts"); // 1 failure

    scorer.decayScores(1000);

    const stats = scorer.getPeerStats("peer-active");
    const topicStats = stats?.topics.get("alerts");
    // First message deliveries decay factor = 0.9 -> 1 * 0.9 = 0.9
    expect(topicStats?.firstMessageDeliveries).toBeCloseTo(0.9, 2);
    // Mesh failure decay factor = 0.85 -> 1 * 0.85 = 0.85
    expect(topicStats?.meshFailures).toBeCloseTo(0.85, 2);
  });

  it("prunes peer and cleans up IP colocation registry", () => {
    const ip = "10.0.0.1";
    scorer.setIP("peer-a", ip);
    scorer.setIP("peer-b", ip);
    scorer.setIP("peer-c", ip); // 3 peers -> penalty

    expect(scorer.score("peer-a")).toBe(-10);

    // Prune peer-c
    scorer.prunePeer("peer-c");
    expect(scorer.getPeerStats("peer-c")).toBeUndefined();

    // Now only 2 peers remain -> colocation penalty removed!
    expect(scorer.score("peer-a")).toBe(0);
  });
});
