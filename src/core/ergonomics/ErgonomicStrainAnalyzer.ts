/**
 * ErgonomicStrainAnalyzer.ts
 * Biomechanical posture strain analyzer and adaptive micro-break scheduler.
 * Implements Rapid Upper Limb Assessment (RULA/REBA) kinematic metrics,
 * craniovertebral angle (CVA) tracking, exponential strain accumulation/decay,
 * and context-aware workspace break interventions.
 */

export interface PoseKeypoint2D {
  x: number;
  y: number;
  confidence: number;
}

export interface SkeletalPose {
  timestamp: number;
  nose: PoseKeypoint2D;
  leftEar: PoseKeypoint2D;
  rightEar: PoseKeypoint2D;
  leftShoulder: PoseKeypoint2D;
  rightShoulder: PoseKeypoint2D;
  leftElbow?: PoseKeypoint2D;
  rightElbow?: PoseKeypoint2D;
  leftWrist?: PoseKeypoint2D;
  rightWrist?: PoseKeypoint2D;
  leftHip: PoseKeypoint2D;
  rightHip: PoseKeypoint2D;
}

export type RiskActionLevel =
  | 'OPTIMAL'
  | 'ACCEPTABLE'
  | 'MODERATE_RISK'
  | 'HIGH_RISK_ACTION_REQUIRED';

export interface KinematicMetrics {
  forwardHeadAngleDeg: number;
  shoulderAsymmetryDeg: number;
  trunkFlexionDeg: number;
  instantaneousStrainScore: number; // 0 to 100
  riskLevel: RiskActionLevel;
}

export type BreakType =
  | 'MICRO_EYE_REST'
  | 'CERVICAL_STRETCH'
  | 'SCAPULAR_RETRACTION'
  | 'FULL_POSTURE_RESET';

export interface BreakAdvisory {
  recommended: boolean;
  breakType: BreakType;
  durationSeconds: number;
  urgency: 'ROUTINE' | 'ELEVATED' | 'CRITICAL';
  rationale: string;
}

export interface ErgonomicRemediation {
  monitorElevationRecommendation: string;
  chairSupportRecommendation: string;
  standingTransitionRecommended: boolean;
}

export class ErgonomicStrainAnalyzer {
  private cumulativeStrainDose = 0; // Accumulated strain energy
  private lastEvaluationTime = 0;
  private recoveryDecayConstant: number; // Lambda per second
  private strainDoseThreshold: number;

  private recentSamples: KinematicMetrics[] = [];
  private maxHistorySamples = 120;

  constructor(options?: {
    recoveryDecayConstant?: number;
    strainDoseThreshold?: number;
  }) {
    this.recoveryDecayConstant = options?.recoveryDecayConstant ?? 0.005; // ~50% decay every 140s of neutral rest
    this.strainDoseThreshold = options?.strainDoseThreshold ?? 100.0;
  }

  public getCumulativeStrainDose(): number {
    return this.cumulativeStrainDose;
  }

  public resetCumulativeDose(): void {
    this.cumulativeStrainDose = 0;
  }

  /**
   * Evaluates instantaneous posture kinematics from skeletal pose keypoints
   */
  public evaluatePose(pose: SkeletalPose): KinematicMetrics {
    const now = pose.timestamp;

    // 1. Calculate Midpoints
    const midEar = {
      x: (pose.leftEar.x + pose.rightEar.x) / 2,
      y: (pose.leftEar.y + pose.rightEar.y) / 2,
    };

    const midShoulder = {
      x: (pose.leftShoulder.x + pose.rightShoulder.x) / 2,
      y: (pose.leftShoulder.y + pose.rightShoulder.y) / 2,
    };

    const midHip = {
      x: (pose.leftHip.x + pose.rightHip.x) / 2,
      y: (pose.leftHip.y + pose.rightHip.y) / 2,
    };

    // 2. Forward Head Angle (Deviation of ear-shoulder vector from vertical in degrees)
    // In camera coordinates, Y points down. Vertical vector is (0, -1) from shoulder up.
    const headVec = {
      x: midEar.x - midShoulder.x,
      y: midEar.y - midShoulder.y, // negative if ear is above shoulder
    };
    const forwardHeadRad = Math.atan2(Math.abs(headVec.x), Math.abs(headVec.y));
    const forwardHeadAngleDeg = (forwardHeadRad * 180) / Math.PI;

    // 3. Shoulder Asymmetry Angle (Deviation of shoulder line from horizontal)
    const shoulderDx = pose.rightShoulder.x - pose.leftShoulder.x;
    const shoulderDy = pose.rightShoulder.y - pose.leftShoulder.y;
    const shoulderAsymmetryRad = Math.atan2(Math.abs(shoulderDy), Math.abs(shoulderDx));
    const shoulderAsymmetryDeg = (shoulderAsymmetryRad * 180) / Math.PI;

    // 4. Trunk Flexion Angle (Deviation of spine line hip->shoulder from vertical)
    const trunkVec = {
      x: midShoulder.x - midHip.x,
      y: midShoulder.y - midHip.y,
    };
    const trunkRad = Math.atan2(Math.abs(trunkVec.x), Math.abs(trunkVec.y));
    const trunkFlexionDeg = (trunkRad * 180) / Math.PI;

    // 5. Composite Instantaneous Strain Score (0 - 100)
    // Forward head is the largest cervical spine stressor (weight 45%)
    // Trunk flexion / slouching is next (weight 35%)
    // Shoulder asymmetry (weight 20%)
    const headStrain = Math.min(100, (forwardHeadAngleDeg / 35.0) * 100);
    const trunkStrain = Math.min(100, (trunkFlexionDeg / 30.0) * 100);
    const shoulderStrain = Math.min(100, (shoulderAsymmetryDeg / 15.0) * 100);

    const instantaneousStrainScore = Math.round(
      0.45 * headStrain + 0.35 * trunkStrain + 0.2 * shoulderStrain
    );

    // 6. Risk Level Classification (RULA-aligned)
    let riskLevel: RiskActionLevel = 'OPTIMAL';
    if (instantaneousStrainScore >= 75) {
      riskLevel = 'HIGH_RISK_ACTION_REQUIRED';
    } else if (instantaneousStrainScore >= 50) {
      riskLevel = 'MODERATE_RISK';
    } else if (instantaneousStrainScore >= 25) {
      riskLevel = 'ACCEPTABLE';
    }

    const metrics: KinematicMetrics = {
      forwardHeadAngleDeg: parseFloat(forwardHeadAngleDeg.toFixed(2)),
      shoulderAsymmetryDeg: parseFloat(shoulderAsymmetryDeg.toFixed(2)),
      trunkFlexionDeg: parseFloat(trunkFlexionDeg.toFixed(2)),
      instantaneousStrainScore,
      riskLevel,
    };

    // 7. Update Cumulative Strain with Exponential Recovery Decay
    if (this.lastEvaluationTime > 0) {
      const deltaSec = Math.max(0.1, (now - this.lastEvaluationTime) / 1000.0);

      if (instantaneousStrainScore <= 20) {
        // Neutral or resting posture: decay accumulated strain
        this.cumulativeStrainDose *= Math.exp(-this.recoveryDecayConstant * deltaSec);
      } else {
        // Active strain accumulation: rate proportional to strain score
        const strainRate = (instantaneousStrainScore / 100.0) * 2.5; // Up to 2.5 dose/sec
        this.cumulativeStrainDose += strainRate * deltaSec;
      }
    }

    this.lastEvaluationTime = now;
    this.recentSamples.push(metrics);
    if (this.recentSamples.length > this.maxHistorySamples) {
      this.recentSamples.shift();
    }

    return metrics;
  }

  /**
   * Evaluates if a micro-break or postural reset is recommended
   */
  public evaluateBreakAdvisory(): BreakAdvisory {
    if (this.cumulativeStrainDose >= this.strainDoseThreshold * 1.5) {
      return {
        recommended: true,
        breakType: 'FULL_POSTURE_RESET',
        durationSeconds: 180,
        urgency: 'CRITICAL',
        rationale: 'Severe cumulative biomechanical strain detected. Immediate standing/walking break required.',
      };
    }

    if (this.cumulativeStrainDose >= this.strainDoseThreshold) {
      // Determine dominant strain source from recent samples
      const avgHead = this.getAverageMetric('forwardHeadAngleDeg');
      const avgShoulder = this.getAverageMetric('shoulderAsymmetryDeg');

      if (avgHead > 20) {
        return {
          recommended: true,
          breakType: 'CERVICAL_STRETCH',
          durationSeconds: 45,
          urgency: 'ELEVATED',
          rationale: 'Persistent cervical forward-head flexion. Perform 5 chin tucks and neck extensions.',
        };
      }

      if (avgShoulder > 5) {
        return {
          recommended: true,
          breakType: 'SCAPULAR_RETRACTION',
          durationSeconds: 30,
          urgency: 'ELEVATED',
          rationale: 'Asymmetric shoulder elevation detected. Perform scapular rolls and shoulder drops.',
        };
      }

      return {
        recommended: true,
        breakType: 'MICRO_EYE_REST',
        durationSeconds: 20,
        urgency: 'ROUTINE',
        rationale: 'Routine 20-20-20 eye and posture interval to reduce static fatigue.',
      };
    }

    return {
      recommended: false,
      breakType: 'MICRO_EYE_REST',
      durationSeconds: 0,
      urgency: 'ROUTINE',
      rationale: 'Postural strain within acceptable ergonomic tolerances.',
    };
  }

  /**
   * Generates tailored workspace workstation remediation advice
   */
  public generateRemediation(): ErgonomicRemediation {
    const avgHead = this.getAverageMetric('forwardHeadAngleDeg');
    const avgTrunk = this.getAverageMetric('trunkFlexionDeg');

    let monitorRec = 'Monitor height is within optimal eye-line parameters.';
    if (avgHead > 20) {
      monitorRec = 'Raise primary display by 5-10 cm so top bezel aligns with horizontal eye level.';
    } else if (avgHead < 5) {
      monitorRec = 'Monitor alignment is optimal with neutral cervical spine.';
    }

    let chairRec = 'Chair lumbar support and recline are properly configured.';
    if (avgTrunk > 18) {
      chairRec = 'Engage 100-110 degree chair recline and position lumbar cushion against lower spine.';
    }

    const standingTransition = this.cumulativeStrainDose > this.strainDoseThreshold * 0.8;

    return {
      monitorElevationRecommendation: monitorRec,
      chairSupportRecommendation: chairRec,
      standingTransitionRecommended: standingTransition,
    };
  }

  private getAverageMetric(key: keyof KinematicMetrics): number {
    if (this.recentSamples.length === 0) return 0;
    const sum = this.recentSamples.reduce((acc, s) => acc + (s[key] as number), 0);
    return sum / this.recentSamples.length;
  }
}
