/**
 * @jest-environment node
 */
import {
  AudioFecManager,
  FECRedundancyTier,
  ParityMatrixGenerator,
  FEC_TIER_CONFIGS,
} from "@/core/p2p/AudioFecManager";
import { AudioFrame } from "@/core/p2p/AudioFEC";

describe("AudioFecManager RTCP Adaptation & Dynamic Redundancy (#8019)", () => {
  const makeFrame = (seq: number, text = `frame-${seq}`): AudioFrame => ({
    streamId: "audio-stream-1",
    frameSeq: seq,
    timestamp: 1000 + seq * 20,
    payload: new TextEncoder().encode(text),
  });

  describe("1. Parity Matrix Generator Adaptation", () => {
    it("generates correct matrix dimensions and ratios for all tiers", () => {
      const noneConfig = ParityMatrixGenerator.getMatrixConfig(FECRedundancyTier.None);
      expect(noneConfig.k).toBe(0);
      expect(noneConfig.m).toBe(0);
      expect(noneConfig.redundancyRatio).toBe(0.0);

      const lowConfig = ParityMatrixGenerator.getMatrixConfig(FECRedundancyTier.Low);
      expect(lowConfig.k).toBe(10);
      expect(lowConfig.m).toBe(1);
      expect(lowConfig.redundancyRatio).toBe(0.1);

      const medConfig = ParityMatrixGenerator.getMatrixConfig(FECRedundancyTier.Medium);
      expect(medConfig.k).toBe(5);
      expect(medConfig.m).toBe(1);
      expect(medConfig.redundancyRatio).toBe(0.2);

      const highConfig = ParityMatrixGenerator.getMatrixConfig(FECRedundancyTier.High);
      expect(highConfig.k).toBe(3);
      expect(highConfig.m).toBe(1);
      expect(highConfig.redundancyRatio).toBeCloseTo(0.3333, 3);

      const extremeConfig = ParityMatrixGenerator.getMatrixConfig(FECRedundancyTier.Extreme);
      expect(extremeConfig.k).toBe(2);
      expect(extremeConfig.m).toBe(1);
      expect(extremeConfig.redundancyRatio).toBe(0.5);
    });

    it("generates valid XOR parity payloads matching block frame payloads", () => {
      const frames = [makeFrame(1, "alpha"), makeFrame(2, "beta"), makeFrame(3, "gamma")];
      const parities = ParityMatrixGenerator.generateParity(frames, FECRedundancyTier.High);

      expect(parities).toHaveLength(1);
      expect(parities[0].length).toBe(Math.max(...frames.map((f) => f.payload.length)));

      // Parity property verification: parity XOR alpha XOR beta = gamma
      const recovered = new Uint8Array(parities[0]);
      for (let i = 0; i < frames[0].payload.length; i++) recovered[i] ^= frames[0].payload[i];
      for (let i = 0; i < frames[1].payload.length; i++) recovered[i] ^= frames[1].payload[i];

      const decoded = new TextDecoder().decode(recovered.slice(0, frames[2].payload.length));
      expect(decoded).toBe("gamma");
    });
  });

  describe("2. RTCP Packet Loss Moving Average & Statistics", () => {
    it("computes smoothed loss moving average with EMA", () => {
      const manager = new AudioFecManager({ emaAlpha: 0.5 });
      expect(manager.getSmoothedLoss()).toBe(0);

      // Feed 10% loss
      manager.processRTCPReport({ fractionLost: 0.1 });
      expect(manager.getSmoothedLoss()).toBe(0.05);

      // Feed another 10% loss
      manager.processRTCPReport({ fractionLost: 0.1 });
      expect(manager.getSmoothedLoss()).toBe(0.075);
    });

    it("smoothly tracks jitter and RTT metrics", () => {
      const manager = new AudioFecManager({ emaAlpha: 0.5 });
      manager.processRTCPReport({ fractionLost: 0.05, jitterMs: 20, rttMs: 80 });
      expect(manager.getSmoothedJitter()).toBe(10);
      expect(manager.getSmoothedRtt()).toBe(40);

      manager.processRTCPReport({ fractionLost: 0.05, jitterMs: 30, rttMs: 100 });
      expect(manager.getSmoothedJitter()).toBe(20);
      expect(manager.getSmoothedRtt()).toBe(70);
    });

    it("handles RFC 3550 8-bit integer fractionLost scale (0..255)", () => {
      const manager = new AudioFecManager({ emaAlpha: 1.0 });
      // 128 / 255 ~= 0.5019 (~50% loss)
      manager.processRTCPReport({ fractionLost: 128 });
      expect(manager.getSmoothedLoss()).toBeCloseTo(0.502, 2);
      expect(manager.getCurrentTier()).toBe(FECRedundancyTier.Extreme);
    });
  });

  describe("3. Dynamic Tier Transition Up & Decay Down", () => {
    it("transitions up rapidly when loss crosses thresholds", () => {
      const manager = new AudioFecManager({ emaAlpha: 1.0 });

      // No loss
      manager.processRTCPReport({ fractionLost: 0.0 });
      expect(manager.getCurrentTier()).toBe(FECRedundancyTier.None);

      // 5% loss -> Low (threshold 0.02)
      manager.processRTCPReport({ fractionLost: 0.05 });
      expect(manager.getCurrentTier()).toBe(FECRedundancyTier.Low);
      expect(manager.getBlockSize()).toBe(10);

      // 12% loss -> Medium (threshold 0.08)
      manager.processRTCPReport({ fractionLost: 0.12 });
      expect(manager.getCurrentTier()).toBe(FECRedundancyTier.Medium);
      expect(manager.getBlockSize()).toBe(5);

      // 22% loss -> High (threshold 0.18)
      manager.processRTCPReport({ fractionLost: 0.22 });
      expect(manager.getCurrentTier()).toBe(FECRedundancyTier.High);
      expect(manager.getBlockSize()).toBe(3);

      // 35% loss -> Extreme (threshold 0.28)
      manager.processRTCPReport({ fractionLost: 0.35 });
      expect(manager.getCurrentTier()).toBe(FECRedundancyTier.Extreme);
      expect(manager.getBlockSize()).toBe(2);
    });

    it("decays down smoothly with hold samples to avoid flapping during network recovery", () => {
      const manager = new AudioFecManager({ emaAlpha: 1.0, decayHoldSamples: 3 });

      // Jump to Extreme
      manager.processRTCPReport({ fractionLost: 0.35 });
      expect(manager.getCurrentTier()).toBe(FECRedundancyTier.Extreme);

      // Network recovers to 0% loss
      // Sample 1: still holds Extreme
      manager.processRTCPReport({ fractionLost: 0.0 });
      expect(manager.getCurrentTier()).toBe(FECRedundancyTier.Extreme);

      // Sample 2: still holds Extreme
      manager.processRTCPReport({ fractionLost: 0.0 });
      expect(manager.getCurrentTier()).toBe(FECRedundancyTier.Extreme);

      // Sample 3: steps down to High
      manager.processRTCPReport({ fractionLost: 0.0 });
      expect(manager.getCurrentTier()).toBe(FECRedundancyTier.High);

      // Next 3 samples step down to Medium
      manager.processRTCPReport({ fractionLost: 0.0 });
      manager.processRTCPReport({ fractionLost: 0.0 });
      manager.processRTCPReport({ fractionLost: 0.0 });
      expect(manager.getCurrentTier()).toBe(FECRedundancyTier.Medium);
    });
  });

  describe("4. Audio Playback Intelligibility Under 25% Burst Packet Loss", () => {
    it("maintains 100% audio intelligibility under 25% burst loss when FEC High/Extreme tier is active", () => {
      const manager = new AudioFecManager({
        emaAlpha: 1.0,
        initialTier: FECRedundancyTier.High,
      });

      // Prepare 12 audio frames (4 blocks of 3 frames)
      const frames: AudioFrame[] = [];
      for (let i = 0; i < 12; i++) {
        frames.push(makeFrame(i, `audio-payload-${i}`));
      }

      // Simulate 25% burst packet loss (1 out of every 4 packets lost)
      const recovered = manager.simulateTransmissionAndRecovery(frames, 0.25);

      // All 12 frames delivered / recovered!
      expect(recovered.length).toBe(12);

      const stats = manager.getStats();
      expect(stats.intelligibilityScore).toBe(1.0);
      expect(stats.packetsRecovered).toBeGreaterThan(0);
    });
  });

  describe("5. Developer Debug Slider Integration", () => {
    it("adapts redundancy tier immediately when debug slider adjusts simulated loss", () => {
      const manager = new AudioFecManager({ emaAlpha: 1.0 });

      manager.setSimulatedLossRate(0.1);
      expect(manager.getSimulatedLossRate()).toBe(0.1);
      expect(manager.getCurrentTier()).toBe(FECRedundancyTier.Medium);

      manager.setSimulatedLossRate(0.3);
      expect(manager.getCurrentTier()).toBe(FECRedundancyTier.Extreme);
      expect(manager.getRedundancyRatio()).toBe(0.5);

      manager.setSimulatedLossRate(0.0);
      expect(manager.getSimulatedLossRate()).toBe(0.0);
    });
  });
});
