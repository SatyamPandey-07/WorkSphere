import { describe, it, expect, beforeEach } from 'vitest';
import {
  PupilDilationTracker,
  CognitiveLoadLevel,
  type OcularTelemetryFrame,
} from '../../core/biometrics/PupilDilationTracker';

describe('PupilDilationTracker - Cognitive Load & 20-20-20 Eye Strain Tracking', () => {
  let tracker: PupilDilationTracker;
  const BASE_TIME = 1700000000000;

  beforeEach(() => {
    tracker = new PupilDilationTracker({
      earBlinkThreshold: 0.18,
      minValidDiameterMm: 1.5,
      maxValidDiameterMm: 9.0,
      slidingWindowSize: 30,
      continuousFixationLimitMs: 20 * 60 * 1000,
    });
  });

  describe('Ambient Pupillary Light Reflex (PLR) Normalization', () => {
    it('calculates physiological baseline diameter for outdoor and dim environments', () => {
      const brightOutdoor = tracker.computeAmbientBaselineDiameter(5000); // 5000 lux
      const dimRoom = tracker.computeAmbientBaselineDiameter(10); // 10 lux
      const standardOffice = tracker.computeAmbientBaselineDiameter(400); // 400 lux

      expect(brightOutdoor).toBeLessThan(standardOffice);
      expect(standardOffice).toBeLessThan(dimRoom);
      expect(standardOffice).toBeGreaterThan(2.5);
      expect(standardOffice).toBeLessThan(4.5);
    });
  });

  describe('Blink Detection & Inpainting', () => {
    it('detects blink occlusion and inpaints pupil diameter to prevent drop spikes', () => {
      // Normal frame
      tracker.ingestFrame({
        timestamp: BASE_TIME,
        leftPupilDiameterMm: 3.6,
        rightPupilDiameterMm: 3.6,
        eyeAspectRatio: 0.32,
        ambientLux: 400,
      });

      // Blink frame (EAR = 0.08, pupil 0mm)
      const blinkResult = tracker.ingestFrame({
        timestamp: BASE_TIME + 100,
        leftPupilDiameterMm: 0.0,
        rightPupilDiameterMm: 0.0,
        eyeAspectRatio: 0.08, // Blink!
        ambientLux: 400,
      });

      expect(tracker.blinkCount).toBe(1);
      expect(blinkResult.meanPupilDiameterMm).toBeCloseTo(3.6, 1); // Inpainted!
    });
  });

  describe('Cognitive Load Classification (TEPR & ICA)', () => {
    it('detects HIGH_LOAD when task-evoked dilation significantly exceeds ambient baseline', () => {
      // Stream frames with strong dilation above ambient
      let lastResult: ReturnType<typeof tracker.ingestFrame> | undefined;

      for (let i = 0; i < 15; i++) {
        // High cognitive effort dilating pupil to 4.8mm under 400 lux office (baseline ~3.4mm)
        lastResult = tracker.ingestFrame({
          timestamp: BASE_TIME + i * 200,
          leftPupilDiameterMm: 4.8 + (i % 2 === 0 ? 0.2 : -0.2), // Micro-dilations
          rightPupilDiameterMm: 4.8 + (i % 2 === 0 ? 0.2 : -0.2),
          eyeAspectRatio: 0.30,
          ambientLux: 400,
        });
      }

      expect(lastResult?.relativeDilationPct).toBeGreaterThan(15.0);
      expect(lastResult?.cognitiveState).toBe(CognitiveLoadLevel.HIGH_LOAD);
    });

    it('identifies COGNITIVE_FATIGUE when pupil dilation persists with low blink rate', () => {
      let lastResult: ReturnType<typeof tracker.ingestFrame> | undefined;

      for (let i = 0; i < 20; i++) {
        lastResult = tracker.ingestFrame({
          timestamp: BASE_TIME + i * 1000,
          leftPupilDiameterMm: 4.2,
          rightPupilDiameterMm: 4.2,
          eyeAspectRatio: 0.30, // Never blinks -> blinkRate = 0
          ambientLux: 400,
        });
      }

      expect(lastResult?.blinkRatePerMinute).toBeLessThan(8);
      expect(lastResult?.cognitiveState).toBe(CognitiveLoadLevel.COGNITIVE_FATIGUE);
    });
  });

  describe('Ergonomic Eye Strain & 20-20-20 Rule', () => {
    it('triggers strain warning when fixation exceeds 20 minutes', () => {
      const res = tracker.ingestFrame({
        timestamp: BASE_TIME,
        leftPupilDiameterMm: 3.5,
        rightPupilDiameterMm: 3.5,
        eyeAspectRatio: 0.30,
        ambientLux: 400,
        gazeFixationDurationMs: 21 * 60 * 1000, // 21 minutes screen fixation!
      });

      expect(res.strainWarning).toBe(true);
      expect(res.recommendation).toMatch(/20-20-20|20 seconds|20 feet/i);
    });
  });
});
