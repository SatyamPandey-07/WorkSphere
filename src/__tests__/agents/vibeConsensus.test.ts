import {
  VibeConsensusEngine,
  calculateCosineSimilarity,
  calculateSemanticAgreement,
  calculateMedian,
  validateVenueTelemetry,
  evaluateDeepWorker,
  evaluateStartupFounder,
  evaluateAudioEngineer,
  DEFAULT_PERSONA_CONFIGS,
  type VenueTelemetry,
} from "@/core/agents/consensus/VibeConsensusEngine";

describe("VibeConsensusEngine - Multi-Agent Debate & Consensus (#7234)", () => {
  let engine: VibeConsensusEngine;

  beforeEach(() => {
    engine = new VibeConsensusEngine();
  });

  describe("Cosine Similarity & Semantic Agreement Utility", () => {
    it("returns 1.0 for identical vectors", () => {
      const vecA = [10, 20, 30, 40];
      const vecB = [10, 20, 30, 40];
      expect(calculateCosineSimilarity(vecA, vecB)).toBeCloseTo(1.0, 5);
    });

    it("returns 0.0 for orthogonal vectors", () => {
      const vecA = [1, 0];
      const vecB = [0, 1];
      expect(calculateCosineSimilarity(vecA, vecB)).toBeCloseTo(0.0, 5);
    });

    it("returns -1.0 for opposite vectors", () => {
      const vecA = [1, 2, 3];
      const vecB = [-1, -2, -3];
      expect(calculateCosineSimilarity(vecA, vecB)).toBeCloseTo(-1.0, 5);
    });

    it("returns 0.0 for different vector dimensions", () => {
      const vecA = [1, 2, 3];
      const vecB = [1, 2];
      expect(calculateCosineSimilarity(vecA, vecB)).toBe(0.0);
    });

    it("returns 0.0 for zero-magnitude vectors", () => {
      const vecA = [0, 0, 0];
      const vecB = [1, 2, 3];
      expect(calculateCosineSimilarity(vecA, vecB)).toBe(0.0);
    });

    it("handles non-finite vector elements safely", () => {
      const vecA = [1, NaN, 3];
      const vecB = [1, 2, 3];
      expect(calculateCosineSimilarity(vecA, vecB)).toBe(0.0);

      const vecC = [1, Infinity, 3];
      expect(calculateCosineSimilarity(vecC, vecB)).toBe(0.0);
    });

    it("calculates semantic agreement on 0-100 scale correctly", () => {
      // Identical vectors -> agreement should be 100
      const vectorsIdentical = [
        [50, 50, 50, 50],
        [50, 50, 50, 50],
        [50, 50, 50, 50],
      ];
      expect(calculateSemanticAgreement(vectorsIdentical)).toBe(100.0);

      // Orthogonal vectors -> cosine = 0.0 -> agreement = 50.0
      const vectorsOrthogonal = [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ];
      expect(calculateSemanticAgreement(vectorsOrthogonal)).toBe(50.0);

      // Single vector or empty list defaults safely to 100
      expect(calculateSemanticAgreement([])).toBe(100.0);
      expect(calculateSemanticAgreement([[1, 2, 3]])).toBe(100.0);
    });
  });

  describe("Median Calculation Utility", () => {
    it("computes median for odd-length arrays", () => {
      expect(calculateMedian([70, 85, 40])).toBe(70);
    });

    it("computes median for even-length arrays", () => {
      expect(calculateMedian([40, 60, 80, 100])).toBe(70);
    });

    it("filters non-finite numbers and handles empty arrays", () => {
      expect(calculateMedian([10, NaN, 90, Infinity])).toBe(50);
      expect(calculateMedian([])).toBe(50);
    });
  });

  describe("Input Validation & Telemetry Sanitization", () => {
    it("accepts valid telemetry", () => {
      const telemetry: VenueTelemetry = {
        noiseDecibels: 48,
        wifiSpeedMbps: 120,
        seatingErgonomics: 85,
      };
      const result = validateVenueTelemetry(telemetry);
      expect(result.valid).toBe(true);
      expect(result.sanitized?.noiseDecibels).toBe(48);
      expect(result.sanitized?.wifiSpeedMbps).toBe(120);
      expect(result.sanitized?.seatingErgonomics).toBe(85);
    });

    it("normalizes seating ergonomics from [0, 10] scale to [0, 100]", () => {
      const telemetry = {
        noiseDecibels: 50,
        wifiSpeedMbps: 80,
        seatingErgonomics: 8.5,
      };
      const result = validateVenueTelemetry(telemetry);
      expect(result.valid).toBe(true);
      expect(result.sanitized?.seatingErgonomics).toBe(85);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("rejects missing, null, or undefined telemetry", () => {
      expect(validateVenueTelemetry(null).valid).toBe(false);
      expect(validateVenueTelemetry(undefined).valid).toBe(false);
      expect(validateVenueTelemetry({}).valid).toBe(false);
    });

    it("rejects negative noise level or negative Wi-Fi speed", () => {
      expect(
        validateVenueTelemetry({
          noiseDecibels: -10,
          wifiSpeedMbps: 50,
          seatingErgonomics: 80,
        }).valid,
      ).toBe(false);

      expect(
        validateVenueTelemetry({
          noiseDecibels: 50,
          wifiSpeedMbps: -25,
          seatingErgonomics: 80,
        }).valid,
      ).toBe(false);
    });

    it("rejects seating score outside allowed bounds", () => {
      expect(
        validateVenueTelemetry({
          noiseDecibels: 50,
          wifiSpeedMbps: 50,
          seatingErgonomics: 150,
        }).valid,
      ).toBe(false);

      expect(
        validateVenueTelemetry({
          noiseDecibels: 50,
          wifiSpeedMbps: 50,
          seatingErgonomics: -5,
        }).valid,
      ).toBe(false);
    });

    it("rejects NaN and infinite telemetry values", () => {
      expect(
        validateVenueTelemetry({
          noiseDecibels: NaN,
          wifiSpeedMbps: 50,
          seatingErgonomics: 80,
        }).valid,
      ).toBe(false);

      expect(
        validateVenueTelemetry({
          noiseDecibels: 50,
          wifiSpeedMbps: Infinity,
          seatingErgonomics: 80,
        }).valid,
      ).toBe(false);
    });

    it("throws an error when evaluateVibeTelemetry is called with invalid telemetry", () => {
      expect(() =>
        engine.evaluateVibeTelemetry({
          noiseDecibels: -50,
          wifiSpeedMbps: 100,
          seatingErgonomics: 80,
        }),
      ).toThrow("Telemetry validation failed");
    });
  });

  describe("Agent Evaluation Perspectives & Divergence", () => {
    it("evaluates all three agents with persona-specific priorities", () => {
      const sanitized = {
        noiseDecibels: 42,
        wifiSpeedMbps: 150,
        seatingErgonomics: 90,
      };

      const deepWorker = evaluateDeepWorker(
        sanitized,
        DEFAULT_PERSONA_CONFIGS.deep_worker,
      );
      const startup = evaluateStartupFounder(
        sanitized,
        DEFAULT_PERSONA_CONFIGS.startup_founder,
      );
      const audio = evaluateAudioEngineer(
        sanitized,
        DEFAULT_PERSONA_CONFIGS.audio_engineer,
      );

      expect(deepWorker.agentId).toBe("deep_worker");
      expect(startup.agentId).toBe("startup_founder");
      expect(audio.agentId).toBe("audio_engineer");

      expect(deepWorker.score).toBeGreaterThanOrEqual(80);
      expect(audio.score).toBeGreaterThanOrEqual(80);
      expect(deepWorker.vector).toHaveLength(4);
      expect(startup.vector).toHaveLength(4);
      expect(audio.vector).toHaveLength(4);
    });

    it("produces distinct scores reflecting conflicting priorities for vibrant, noisy space", () => {
      // 72 dB noise, 100 Mbps Wi-Fi, 75 ergonomics
      // Deep Worker & Audio Engineer should penalize 72 dB
      // Startup Founder should favor the buzz
      const sanitized = {
        noiseDecibels: 72,
        wifiSpeedMbps: 100,
        seatingErgonomics: 75,
      };

      const deepWorker = evaluateDeepWorker(sanitized);
      const startup = evaluateStartupFounder(sanitized);
      const audio = evaluateAudioEngineer(sanitized);

      expect(startup.score).toBeGreaterThan(deepWorker.score);
      expect(startup.score).toBeGreaterThan(audio.score);
      expect(deepWorker.score).toBeLessThan(65);
      expect(audio.score).toBeLessThan(60);
    });

    it("is strictly deterministic for identical input", () => {
      const telemetry: VenueTelemetry = {
        noiseDecibels: 55,
        wifiSpeedMbps: 90,
        seatingErgonomics: 80,
      };

      const res1 = engine.evaluateVibeTelemetry(telemetry, "venue-1");
      const res2 = engine.evaluateVibeTelemetry(telemetry, "venue-1");

      expect(res1.finalVibeScore).toBe(res2.finalVibeScore);
      expect(res1.semanticAgreementScore).toBe(res2.semanticAgreementScore);
      expect(res1.agentScores).toEqual(res2.agentScores);
      expect(res1.transcript).toEqual(res2.transcript);
    });
  });

  describe("Debate Orchestration & Iteration Bounding", () => {
    it("records initial round 0 and revisions across debate rounds", () => {
      const telemetry: VenueTelemetry = {
        noiseDecibels: 68,
        wifiSpeedMbps: 85,
        seatingErgonomics: 70,
      };

      const result = engine.evaluateVibeTelemetry(telemetry, "venue-cafe-1");

      expect(result.transcript.length).toBeGreaterThanOrEqual(3);
      const round0 = result.transcript.filter((t) => t.round === 0);
      expect(round0).toHaveLength(3);

      expect(result.debateIterations).toBeLessThanOrEqual(3);
      expect(result.finalVibeScore).toBeGreaterThanOrEqual(0);
      expect(result.finalVibeScore).toBeLessThanOrEqual(100);
    });

    it("converges on confidence-weighted consensus when agreement is high", () => {
      // Quiet, high Wi-Fi, good seating -> strong agreement across all 3
      const telemetry: VenueTelemetry = {
        noiseDecibels: 38,
        wifiSpeedMbps: 200,
        seatingErgonomics: 95,
      };

      const result = engine.evaluateVibeTelemetry(telemetry);

      expect(result.fallbackUsed).toBe(false);
      expect(
        result.consensusMethod === "weighted_agreement" ||
          result.consensusMethod === "unanimous_agreement",
      ).toBe(true);
      expect(result.semanticAgreementScore).toBeGreaterThanOrEqual(70);
      expect(result.finalVibeScore).toBeGreaterThan(85);
    });

    it("activates median voting fallback when divergence threshold cannot be met after 3 iterations", () => {
      // Create engine with impossible threshold (100.1%) to force fallback after 3 iterations
      const divergentEngine = new VibeConsensusEngine(undefined, {
        divergenceThreshold: 99.9,
        maxDebateIterations: 3,
        plasticityRate: 0.05, // slow convergence
      });

      const telemetry: VenueTelemetry = {
        noiseDecibels: 78, // Noisy: creates strong clash between Audio Engineer and Startup Founder
        wifiSpeedMbps: 120,
        seatingErgonomics: 80,
      };

      const result = divergentEngine.evaluateVibeTelemetry(telemetry);

      expect(result.fallbackUsed).toBe(true);
      expect(result.consensusMethod).toBe("median_fallback");
      expect(result.debateIterations).toBe(3);

      // Verify that final score equals the median of the 3 final agent scores
      const expectedMedian = calculateMedian(Object.values(result.agentScores));
      expect(result.finalVibeScore).toBeCloseTo(expectedMedian, 1);
      expect(result.warnings).toBeDefined();
      expect(
        result.warnings?.some((w) => w.includes("Median fallback activated")),
      ).toBe(true);
    });
  });

  describe("Debate Transcript Completeness", () => {
    it("contains complete structured transcript entries with reasoning and responses", () => {
      const telemetry: VenueTelemetry = {
        noiseDecibels: 60,
        wifiSpeedMbps: 100,
        seatingErgonomics: 85,
      };

      const result = engine.evaluateVibeTelemetry(
        telemetry,
        "venue-transcript-test",
      );

      for (const entry of result.transcript) {
        expect(entry).toHaveProperty("round");
        expect(entry).toHaveProperty("agentId");
        expect(entry).toHaveProperty("personaName");
        expect(entry).toHaveProperty("score");
        expect(entry).toHaveProperty("confidence");
        expect(entry).toHaveProperty("vector");
        expect(entry).toHaveProperty("reasoning");
        expect(entry.score).toBeGreaterThanOrEqual(0);
        expect(entry.score).toBeLessThanOrEqual(100);
        expect(entry.confidence).toBeGreaterThanOrEqual(0);
        expect(entry.confidence).toBeLessThanOrEqual(1);
        expect(entry.vector.length).toBe(4);
      }

      // Check that later rounds include responseToPeers
      const debateRounds = result.transcript.filter((t) => t.round > 0);
      for (const entry of debateRounds) {
        expect(entry.responseToPeers).toBeDefined();
        expect(typeof entry.responseToPeers).toBe("string");
      }
    });
  });

  describe("Performance Requirement (Sub-1.5 Seconds)", () => {
    it("converges and computes consensus well within 1.5 seconds (1500 ms)", () => {
      const telemetry: VenueTelemetry = {
        noiseDecibels: 62,
        wifiSpeedMbps: 110,
        seatingErgonomics: 80,
      };

      const t0 = Date.now();
      const result = engine.evaluateVibeTelemetry(telemetry);
      const elapsed = Date.now() - t0;

      expect(elapsed).toBeLessThan(1500);
      expect(result.executionTimeMs).toBeDefined();
      expect(result.executionTimeMs).toBeLessThan(1500);
    });

    it("executes 100 consecutive evaluations within 500 ms total (high throughput benchmark)", () => {
      const telemetry: VenueTelemetry = {
        noiseDecibels: 55,
        wifiSpeedMbps: 95,
        seatingErgonomics: 85,
      };

      const start = Date.now();
      for (let i = 0; i < 100; i++) {
        engine.evaluateVibeTelemetry(telemetry);
      }
      const totalElapsed = Date.now() - start;

      // 100 iterations of synchronous CPU computation should take < 500ms
      expect(totalElapsed).toBeLessThan(500);
    });
  });
});
