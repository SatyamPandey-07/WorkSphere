import {
  ErgonomicStrainAnalyzer,
  SkeletalPose,
} from '../../core/ergonomics/ErgonomicStrainAnalyzer';

describe('ErgonomicStrainAnalyzer', () => {
  let analyzer: ErgonomicStrainAnalyzer;

  beforeEach(() => {
    analyzer = new ErgonomicStrainAnalyzer({
      recoveryDecayConstant: 0.05,
      strainDoseThreshold: 50.0,
    });
  });

  describe('Instantaneous Posture Evaluation', () => {
    it('evaluates perfectly neutral posture as OPTIMAL with low strain score', () => {
      // Ears directly above shoulders, shoulders horizontal, hips directly below shoulders
      const neutralPose: SkeletalPose = {
        timestamp: 1000,
        nose: { x: 300, y: 150, confidence: 0.99 },
        leftEar: { x: 280, y: 140, confidence: 0.99 },
        rightEar: { x: 320, y: 140, confidence: 0.99 },
        leftShoulder: { x: 260, y: 240, confidence: 0.99 },
        rightShoulder: { x: 340, y: 240, confidence: 0.99 },
        leftHip: { x: 270, y: 440, confidence: 0.99 },
        rightHip: { x: 330, y: 440, confidence: 0.99 },
      };

      const metrics = analyzer.evaluatePose(neutralPose);

      expect(metrics.forwardHeadAngleDeg).toBeCloseTo(0, 1);
      expect(metrics.shoulderAsymmetryDeg).toBeCloseTo(0, 1);
      expect(metrics.trunkFlexionDeg).toBeCloseTo(0, 1);
      expect(metrics.instantaneousStrainScore).toBeLessThan(15);
      expect(metrics.riskLevel).toBe('OPTIMAL');
    });

    it('detects forward-head translation (text neck) with high strain score', () => {
      // Ears shifted far forward on X-axis relative to shoulders
      const textNeckPose: SkeletalPose = {
        timestamp: 2000,
        nose: { x: 390, y: 170, confidence: 0.99 },
        leftEar: { x: 370, y: 160, confidence: 0.99 },
        rightEar: { x: 410, y: 160, confidence: 0.99 },
        leftShoulder: { x: 260, y: 240, confidence: 0.99 },
        rightShoulder: { x: 340, y: 240, confidence: 0.99 },
        leftHip: { x: 270, y: 440, confidence: 0.99 },
        rightHip: { x: 330, y: 440, confidence: 0.99 },
      };

      const metrics = analyzer.evaluatePose(textNeckPose);

      expect(metrics.forwardHeadAngleDeg).toBeGreaterThan(30);
      expect(metrics.instantaneousStrainScore).toBeGreaterThan(40);
      expect(['MODERATE_RISK', 'HIGH_RISK_ACTION_REQUIRED']).toContain(metrics.riskLevel);
    });

    it('detects shoulder asymmetry when one shoulder is elevated', () => {
      // Left shoulder elevated significantly (Y coordinate lower)
      const asymmetricPose: SkeletalPose = {
        timestamp: 3000,
        nose: { x: 300, y: 150, confidence: 0.99 },
        leftEar: { x: 280, y: 140, confidence: 0.99 },
        rightEar: { x: 320, y: 140, confidence: 0.99 },
        leftShoulder: { x: 260, y: 210, confidence: 0.99 }, // 30px higher
        rightShoulder: { x: 340, y: 250, confidence: 0.99 },
        leftHip: { x: 270, y: 440, confidence: 0.99 },
        rightHip: { x: 330, y: 440, confidence: 0.99 },
      };

      const metrics = analyzer.evaluatePose(asymmetricPose);
      expect(metrics.shoulderAsymmetryDeg).toBeGreaterThan(15);
    });
  });

  describe('Cumulative Strain Dose & Recovery Decay', () => {
    it('accumulates strain dose during sustained high-strain posture', () => {
      const badPose1: SkeletalPose = {
        timestamp: 1000,
        nose: { x: 380, y: 170, confidence: 0.99 },
        leftEar: { x: 360, y: 160, confidence: 0.99 },
        rightEar: { x: 400, y: 160, confidence: 0.99 },
        leftShoulder: { x: 260, y: 240, confidence: 0.99 },
        rightShoulder: { x: 340, y: 240, confidence: 0.99 },
        leftHip: { x: 270, y: 440, confidence: 0.99 },
        rightHip: { x: 330, y: 440, confidence: 0.99 },
      };

      analyzer.evaluatePose(badPose1);
      expect(analyzer.getCumulativeStrainDose()).toBe(0); // Baseline start

      // 10 seconds later in bad posture
      const badPose2: SkeletalPose = {
        ...badPose1,
        timestamp: 11000,
      };

      analyzer.evaluatePose(badPose2);
      expect(analyzer.getCumulativeStrainDose()).toBeGreaterThan(5);
    });

    it('decays cumulative strain dose during neutral rest interval', () => {
      // Force initial accumulated dose
      const badPose1: SkeletalPose = {
        timestamp: 1000,
        nose: { x: 380, y: 170, confidence: 0.99 },
        leftEar: { x: 360, y: 160, confidence: 0.99 },
        rightEar: { x: 400, y: 160, confidence: 0.99 },
        leftShoulder: { x: 260, y: 240, confidence: 0.99 },
        rightShoulder: { x: 340, y: 240, confidence: 0.99 },
        leftHip: { x: 270, y: 440, confidence: 0.99 },
        rightHip: { x: 330, y: 440, confidence: 0.99 },
      };
      analyzer.evaluatePose(badPose1);
      analyzer.evaluatePose({ ...badPose1, timestamp: 31000 }); // 30s bad posture

      const initialDose = analyzer.getCumulativeStrainDose();
      expect(initialDose).toBeGreaterThan(10);

      // Now switch to optimal neutral posture for 30s
      const neutralPose: SkeletalPose = {
        timestamp: 61000,
        nose: { x: 300, y: 150, confidence: 0.99 },
        leftEar: { x: 280, y: 140, confidence: 0.99 },
        rightEar: { x: 320, y: 140, confidence: 0.99 },
        leftShoulder: { x: 260, y: 240, confidence: 0.99 },
        rightShoulder: { x: 340, y: 240, confidence: 0.99 },
        leftHip: { x: 270, y: 440, confidence: 0.99 },
        rightHip: { x: 330, y: 440, confidence: 0.99 },
      };

      analyzer.evaluatePose(neutralPose);
      expect(analyzer.getCumulativeStrainDose()).toBeLessThan(initialDose);
    });
  });

  describe('Adaptive Micro-Break Scheduling & Remediation', () => {
    it('recommends CERVICAL_STRETCH when forward head strain exceeds threshold', () => {
      const badPose: SkeletalPose = {
        timestamp: 1000,
        nose: { x: 390, y: 170, confidence: 0.99 },
        leftEar: { x: 370, y: 160, confidence: 0.99 },
        rightEar: { x: 410, y: 160, confidence: 0.99 },
        leftShoulder: { x: 260, y: 240, confidence: 0.99 },
        rightShoulder: { x: 340, y: 240, confidence: 0.99 },
        leftHip: { x: 270, y: 440, confidence: 0.99 },
        rightHip: { x: 330, y: 440, confidence: 0.99 },
      };

      // Accumulate past threshold 50
      analyzer.evaluatePose(badPose);
      analyzer.evaluatePose({ ...badPose, timestamp: 41000 }); // 40 seconds

      const advisory = analyzer.evaluateBreakAdvisory();
      expect(advisory.recommended).toBe(true);
      expect(advisory.breakType).toBe('CERVICAL_STRETCH');
      expect(advisory.durationSeconds).toBe(45);
    });

    it('generates workplace workstation remediation recommendations', () => {
      const badPose: SkeletalPose = {
        timestamp: 1000,
        nose: { x: 390, y: 170, confidence: 0.99 },
        leftEar: { x: 370, y: 160, confidence: 0.99 },
        rightEar: { x: 410, y: 160, confidence: 0.99 },
        leftShoulder: { x: 260, y: 240, confidence: 0.99 },
        rightShoulder: { x: 340, y: 240, confidence: 0.99 },
        leftHip: { x: 270, y: 440, confidence: 0.99 },
        rightHip: { x: 330, y: 440, confidence: 0.99 },
      };

      analyzer.evaluatePose(badPose);
      const remediation = analyzer.generateRemediation();

      expect(remediation.monitorElevationRecommendation).toContain('Raise primary display');
    });
  });
});
