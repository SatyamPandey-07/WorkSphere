import {
  VibeConsensusEngine,
  resolveVibeConsensus,
  WEIGHTED_QUORUM_REQUIREMENT,
  VIBE_DAMPING_WINDOW_MS,
  type ConsensusVote,
  type VenueVibeState,
} from "@/core/agents/consensus/VibeConsensusEngine";

describe("VibeConsensusEngine - Multi-Agent Vibe Consensus (#6471)", () => {
  const venueId = "venue-downtown-loft-42";
  const baseTime = 1700000000000;

  describe("66% Weighted Quorum Requirement", () => {
    it("achieves consensus when weighted vote proportion reaches or exceeds 66%", () => {
      const currentState: VenueVibeState = {
        venueId,
        currentVibe: "silent_focus",
        lastFlippedAt: baseTime - 20 * 60 * 1000, // 20 mins ago (outside damping)
      };

      // Votes:
      // acoustic_sensor (weight 2.0) -> "lively"
      // occupancy_sensor (weight 1.5) -> "lively"
      // ble_scanner (weight 1.5) -> "lively"
      // anonymous_user (weight 0.5) -> "silent_focus"
      // Total weight = 2.0 + 1.5 + 1.5 + 0.5 = 5.5
      // "lively" weight = 5.0 -> 5.0 / 5.5 = 90.9% (>= 66%)
      const votes: ConsensusVote[] = [
        {
          nodeId: "sensor-acoustic-1",
          nodeType: "acoustic_sensor",
          proposedVibe: "lively",
          timestamp: baseTime,
        },
        {
          nodeId: "sensor-occupancy-1",
          nodeType: "occupancy_sensor",
          proposedVibe: "lively",
          timestamp: baseTime,
        },
        {
          nodeId: "sensor-ble-1",
          nodeType: "ble_scanner",
          proposedVibe: "lively",
          timestamp: baseTime,
        },
        {
          nodeId: "user-anon-1",
          nodeType: "anonymous_user",
          proposedVibe: "silent_focus",
          timestamp: baseTime,
        },
      ];

      const result = resolveVibeConsensus(venueId, votes, currentState, {
        currentTime: baseTime,
      });

      expect(result.quorumMet).toBe(true);
      expect(result.consensusVibe).toBe("lively");
      expect(result.currentVibe).toBe("lively");
      expect(result.winnerPercentage).toBeGreaterThanOrEqual(WEIGHTED_QUORUM_REQUIREMENT);
      expect(result.status).toBe("consensus_reached");
    });

    it("rejects vibe flip when candidate fails to reach 66% weighted quorum", () => {
      const currentState: VenueVibeState = {
        venueId,
        currentVibe: "silent_focus",
        lastFlippedAt: baseTime - 30 * 60 * 1000,
      };

      // Total weight = 2.0 + 1.5 + 1.0 = 4.5
      // "moderate_buzz" has 2.0 / 4.5 = 44.4% (< 66%)
      // "silent_focus" has 2.5 / 4.5 = 55.5% (< 66%)
      const votes: ConsensusVote[] = [
        {
          nodeId: "sensor-acoustic-1",
          nodeType: "acoustic_sensor", // weight 2.0
          proposedVibe: "moderate_buzz",
          timestamp: baseTime,
        },
        {
          nodeId: "sensor-occupancy-1",
          nodeType: "occupancy_sensor", // weight 1.5
          proposedVibe: "silent_focus",
          timestamp: baseTime,
        },
        {
          nodeId: "user-verified-1",
          nodeType: "verified_user", // weight 1.0
          proposedVibe: "silent_focus",
          timestamp: baseTime,
        },
      ];

      const result = resolveVibeConsensus(venueId, votes, currentState, {
        currentTime: baseTime,
      });

      expect(result.quorumMet).toBe(false);
      expect(result.status).toBe("no_consensus");
      expect(result.currentVibe).toBe("silent_focus"); // Preserved
    });
  });

  describe("Outlier & Anomalous Sensor Spike Rejection", () => {
    it("prevents a single anomalous sensor spike from flipping status against corroborating nodes", () => {
      const currentState: VenueVibeState = {
        venueId,
        currentVibe: "silent_focus",
        lastFlippedAt: baseTime - 25 * 60 * 1000,
      };

      // An acoustic sensor has an anomalous 85dB spike (e.g. dropped coffee cup) voting "lively"
      // But multiple corroborating nodes report "silent_focus"
      const votes: ConsensusVote[] = [
        {
          nodeId: "sensor-acoustic-anomalous-spike",
          nodeType: "acoustic_sensor", // weight 2.0
          proposedVibe: "lively",
          timestamp: baseTime,
          metadata: { decibels: 85 },
        },
        {
          nodeId: "sensor-occupancy-1",
          nodeType: "occupancy_sensor", // weight 1.5
          proposedVibe: "silent_focus",
          timestamp: baseTime,
        },
        {
          nodeId: "sensor-ble-1",
          nodeType: "ble_scanner", // weight 1.5
          proposedVibe: "silent_focus",
          timestamp: baseTime,
        },
        {
          nodeId: "user-verified-1",
          nodeType: "verified_user", // weight 1.0
          proposedVibe: "silent_focus",
          timestamp: baseTime,
        },
        {
          nodeId: "user-verified-2",
          nodeType: "verified_user", // weight 1.0
          proposedVibe: "silent_focus",
          timestamp: baseTime,
        },
      ];

      // Total weight = 2.0 (lively) + 5.0 (silent_focus) = 7.0
      // "lively" is only 2.0 / 7.0 = 28.5% (< 66%)
      // "silent_focus" has 5.0 / 7.0 = 71.4% (>= 66%)
      const result = resolveVibeConsensus(venueId, votes, currentState, {
        currentTime: baseTime,
      });

      expect(result.consensusVibe).toBe("silent_focus");
      expect(result.currentVibe).toBe("silent_focus");
      expect(result.vibePercentageBreakdown.lively).toBeCloseTo(0.2857, 2);
      expect(result.status).toBe("reaffirmed_current");
    });

    it("prevents an outlier user report from altering venue vibe without sensor corroboration", () => {
      const currentState: VenueVibeState = {
        venueId,
        currentVibe: "moderate_buzz",
        lastFlippedAt: baseTime - 30 * 60 * 1000,
      };

      // 1 random unverified user claims "silent_focus"
      const votes: ConsensusVote[] = [
        {
          nodeId: "outlier-user",
          nodeType: "anonymous_user", // weight 0.5
          proposedVibe: "silent_focus",
          timestamp: baseTime,
        },
        {
          nodeId: "sensor-acoustic-1",
          nodeType: "acoustic_sensor", // weight 2.0
          proposedVibe: "moderate_buzz",
          timestamp: baseTime,
        },
        {
          nodeId: "sensor-occupancy-1",
          nodeType: "occupancy_sensor", // weight 1.5
          proposedVibe: "moderate_buzz",
          timestamp: baseTime,
        },
      ];

      const result = resolveVibeConsensus(venueId, votes, currentState, {
        currentTime: baseTime,
      });

      expect(result.consensusVibe).toBe("moderate_buzz");
      expect(result.currentVibe).toBe("moderate_buzz");
      expect(result.status).toBe("reaffirmed_current");
    });
  });

  describe("15-Minute Time-Window Damping", () => {
    it("damps and suppresses rapid status flips if less than 15 minutes have elapsed since last flip", () => {
      // Last flipped only 8 minutes ago (damping window = 15 minutes)
      const currentState: VenueVibeState = {
        venueId,
        currentVibe: "silent_focus",
        lastFlippedAt: baseTime - 8 * 60 * 1000,
      };

      // Unanimous 100% vote to flip to "lively"
      const votes: ConsensusVote[] = [
        {
          nodeId: "sensor-acoustic-1",
          nodeType: "acoustic_sensor",
          proposedVibe: "lively",
          timestamp: baseTime,
        },
        {
          nodeId: "sensor-occupancy-1",
          nodeType: "occupancy_sensor",
          proposedVibe: "lively",
          timestamp: baseTime,
        },
      ];

      const result = resolveVibeConsensus(venueId, votes, currentState, {
        currentTime: baseTime,
      });

      expect(result.quorumMet).toBe(true);
      expect(result.consensusVibe).toBe("lively");
      // Damping blocks premature flip!
      expect(result.damped).toBe(true);
      expect(result.status).toBe("damped_time_window");
      expect(result.currentVibe).toBe("silent_focus"); // Still previous vibe
      expect(result.remainingDampingMs).toBe(7 * 60 * 1000); // 15 - 8 = 7 minutes remaining
    });

    it("allows status flip once the 15-minute damping window has fully elapsed", () => {
      // Exactly 15 minutes and 1 second ago
      const currentState: VenueVibeState = {
        venueId,
        currentVibe: "silent_focus",
        lastFlippedAt: baseTime - (15 * 60 * 1000 + 1000),
      };

      const votes: ConsensusVote[] = [
        {
          nodeId: "sensor-acoustic-1",
          nodeType: "acoustic_sensor",
          proposedVibe: "lively",
          timestamp: baseTime,
        },
        {
          nodeId: "sensor-occupancy-1",
          nodeType: "occupancy_sensor",
          proposedVibe: "lively",
          timestamp: baseTime,
        },
      ];

      const result = resolveVibeConsensus(venueId, votes, currentState, {
        currentTime: baseTime,
      });

      expect(result.damped).toBe(false);
      expect(result.status).toBe("consensus_reached");
      expect(result.currentVibe).toBe("lively");
      expect(result.remainingDampingMs).toBe(0);
    });

    it("does not apply damping when consensus reaffirms the existing status", () => {
      const currentState: VenueVibeState = {
        venueId,
        currentVibe: "silent_focus",
        lastFlippedAt: baseTime - 2 * 60 * 1000, // 2 mins ago
      };

      const votes: ConsensusVote[] = [
        {
          nodeId: "sensor-acoustic-1",
          nodeType: "acoustic_sensor",
          proposedVibe: "silent_focus",
          timestamp: baseTime,
        },
        {
          nodeId: "sensor-occupancy-1",
          nodeType: "occupancy_sensor",
          proposedVibe: "silent_focus",
          timestamp: baseTime,
        },
      ];

      const result = resolveVibeConsensus(venueId, votes, currentState, {
        currentTime: baseTime,
      });

      expect(result.damped).toBe(false);
      expect(result.status).toBe("reaffirmed_current");
      expect(result.currentVibe).toBe("silent_focus");
    });
  });

  describe("Stateful VibeConsensusEngine Integration", () => {
    it("tracks state, updates lastFlippedAt, and handles consecutive evaluations", () => {
      const engine = new VibeConsensusEngine();
      engine.reset();

      // Initially silent_focus at t = 0
      engine.setVenueState(venueId, {
        currentVibe: "silent_focus",
        lastFlippedAt: baseTime,
      });

      // Submit votes at t = +16 minutes to switch to "lively"
      const t1 = baseTime + 16 * 60 * 1000;
      engine.submitVotes(venueId, [
        {
          nodeId: "sensor-acoustic-1",
          nodeType: "acoustic_sensor",
          proposedVibe: "lively",
          timestamp: t1,
        },
        {
          nodeId: "sensor-occupancy-1",
          nodeType: "occupancy_sensor",
          proposedVibe: "lively",
          timestamp: t1,
        },
      ]);

      const eval1 = engine.evaluateConsensus(venueId, t1);
      expect(eval1.status).toBe("consensus_reached");
      expect(eval1.currentVibe).toBe("lively");

      const stateAfterFlip = engine.getVenueState(venueId);
      expect(stateAfterFlip.currentVibe).toBe("lively");
      expect(stateAfterFlip.lastFlippedAt).toBe(t1);

      // Now at t = +20 minutes (only 4 minutes after last flip), nodes vote "silent_focus"
      const t2 = baseTime + 20 * 60 * 1000;
      engine.submitVotes(venueId, [
        {
          nodeId: "sensor-acoustic-1",
          nodeType: "acoustic_sensor",
          proposedVibe: "silent_focus",
          timestamp: t2,
        },
        {
          nodeId: "sensor-occupancy-1",
          nodeType: "occupancy_sensor",
          proposedVibe: "silent_focus",
          timestamp: t2,
        },
      ]);

      const eval2 = engine.evaluateConsensus(venueId, t2);
      expect(eval2.status).toBe("damped_time_window");
      expect(eval2.damped).toBe(true);
      expect(eval2.currentVibe).toBe("lively"); // Kept as lively due to damping!

      // At t = +32 minutes (16 minutes after last flip), re-evaluating allows the flip
      const t3 = baseTime + 32 * 60 * 1000;
      engine.submitVotes(venueId, [
        {
          nodeId: "sensor-acoustic-1",
          nodeType: "acoustic_sensor",
          proposedVibe: "silent_focus",
          timestamp: t3,
        },
        {
          nodeId: "sensor-occupancy-1",
          nodeType: "occupancy_sensor",
          proposedVibe: "silent_focus",
          timestamp: t3,
        },
      ]);

      const eval3 = engine.evaluateConsensus(venueId, t3);
      expect(eval3.status).toBe("consensus_reached");
      expect(eval3.currentVibe).toBe("silent_focus");
    });
  });
});
