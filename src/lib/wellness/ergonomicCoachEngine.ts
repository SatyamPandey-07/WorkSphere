/**
 * Dynamic Ergonomic Health & Biometric Break Coach Engine
 * Provides real-time posture check interval tracking, 20-20-20 eye strain countdowns,
 * sit-to-stand posture ratios, micro-stretch biomechanical catalog, hydration targets,
 * and dynamic Strain Risk Index (SRI) scoring.
 */

export interface MicroStretchRoutine {
  id: string;
  name: string;
  category: 'neck_spine' | 'upper_body' | 'wrists_hands' | 'lower_body' | 'eyes_focus';
  targetMuscles: string[];
  durationSeconds: number;
  difficulty: 'easy' | 'moderate';
  instructions: string[];
  ergonomicBenefit: string;
  iconName: string;
}

export interface ErgonomicSessionState {
  sessionId: string;
  userId?: string;
  deskType: 'standard_seated' | 'height_adjustable_sit_stand' | 'standing_only';
  currentPostureState: 'sitting' | 'standing';
  sessionStartTime: number;
  lastPostureStateChange: number;
  totalSittingSeconds: number;
  totalStandingSeconds: number;
  completedStretches: string[];
  postureCheckIns: Array<{ timestamp: number; rating: 'aligned' | 'slouching' | 'stiff' }>;
  waterIntakeMl: number;
  waterTargetMl: number;
  eyeBreaksCompleted: number;
  skippedBreaksCount: number;
  transitionsCount?: number;
  targetSitStandRatio?: number;
}

export * from './deskPostureAnalytics';

import {
  DailyPostureRecord,
  calculateSitStandRatio,
  computeWeeklyDeskSummary,
  generateSampleWeeklyPostureHistory,
} from './deskPostureAnalytics';

export interface ErgonomicStrainScore {
  score: number; // 0 - 100 (100 is optimal, <40 is critical fatigue)
  tier: 'optimal' | 'good' | 'mild_strain' | 'high_strain' | 'critical_fatigue';
  factors: {
    postureBalanceScore: number;
    stretchComplianceScore: number;
    hydrationScore: number;
    eyeRestScore: number;
  };
  recommendation: string;
  nextSuggestedAction: string;
}

export const MICRO_STRETCH_CATALOG: MicroStretchRoutine[] = [
  {
    id: 'neck-chin-tuck',
    name: 'Cervical Retraction & Chin Tuck',
    category: 'neck_spine',
    targetMuscles: ['Deep Neck Flexors', 'Suboccipitals', 'Upper Trapezius'],
    durationSeconds: 30,
    difficulty: 'easy',
    instructions: [
      'Sit tall with your shoulders relaxed and gaze straight ahead.',
      'Gently retract your head straight backward as if making a double chin, without tilting your head down.',
      'Hold for 5 seconds, release smoothly, and repeat 5 times.',
      'Relieves cervical spine compression from forward-head screen staring.'
    ],
    ergonomicBenefit: 'Counters forward head posture (tech-neck) and reduces cervical disc pressure.',
    iconName: 'Activity'
  },
  {
    id: 'thoracic-open-book',
    name: 'Seated Thoracic Spine Opener',
    category: 'neck_spine',
    targetMuscles: ['Thoracic Spine', 'Pectoralis Major', 'Rhomboids'],
    durationSeconds: 45,
    difficulty: 'easy',
    instructions: [
      'Place both hands behind your head with elbows flaring wide.',
      'Inhale deeply and arch your upper back gently over the chair backrest.',
      'Look toward the ceiling while maintaining gentle abdominal engagement.',
      'Hold for 3 breaths, then rotate your torso gently 5 times left and right.'
    ],
    ergonomicBenefit: 'Mobilizes the mid-back and opens chest muscles tight from keyboard hunching.',
    iconName: 'Sun'
  },
  {
    id: 'carpal-median-nerve-glide',
    name: 'Median Nerve Glide & Wrist Extension',
    category: 'wrists_hands',
    targetMuscles: ['Flexor Carpi Radialis', 'Median Nerve Path', 'Extensor Digitorum'],
    durationSeconds: 30,
    difficulty: 'easy',
    instructions: [
      'Extend one arm in front of you at shoulder level, palm facing up.',
      'Use the opposite hand to gently pull your fingers downward toward your body until you feel a gentle forearm stretch.',
      'Hold for 12 seconds, flip palm down and gently push hand backward for 12 seconds.',
      'Repeat on the contralateral arm.'
    ],
    ergonomicBenefit: 'Reduces carpal tunnel intra-neural pressure and repetitive strain injury (RSI) risks.',
    iconName: 'Hand'
  },
  {
    id: 'standing-hip-flexor-lunge',
    name: 'Desk-Supported Hip Flexor Release',
    category: 'lower_body',
    targetMuscles: ['Psoas Major', 'Iliacus', 'Rectus Femoris'],
    durationSeconds: 45,
    difficulty: 'easy',
    instructions: [
      'Stand facing your desk and rest your hands lightly on the desktop for balance.',
      'Step your right foot back into a shallow lunge while keeping your torso upright and hips square.',
      'Tuck your pelvis under slightly until you feel a mild stretch in the front of your right hip.',
      'Hold for 20 seconds, then switch sides.'
    ],
    ergonomicBenefit: 'Decompresses shortened anterior hip capsule resulting from prolonged 90-degree sitting.',
    iconName: 'Footprints'
  },
  {
    id: 'ocular-palming-relaxation',
    name: '20-20-20 Ocular Palming & Distant Gaze',
    category: 'eyes_focus',
    targetMuscles: ['Ciliary Muscles', 'Extraocular Muscles'],
    durationSeconds: 30,
    difficulty: 'easy',
    instructions: [
      'Look away from your screen toward an object at least 20 feet away for 20 seconds.',
      'Rub your palms together briskly for 5 seconds until they feel warm.',
      'Cup your warm palms gently over your closed eyes without applying pressure to the eyeballs.',
      'Breathe deeply in complete darkness for 10 seconds to allow ciliary accommodation recovery.'
    ],
    ergonomicBenefit: 'Resets ciliary spasm, alleviates dry eyes, and halts digital eye strain progression.',
    iconName: 'Eye'
  },
  {
    id: 'scapular-retraction-pinch',
    name: 'Isometric Scapular Squeeze',
    category: 'upper_body',
    targetMuscles: ['Middle Trapezius', 'Rhomboids', 'Latissimus Dorsi'],
    durationSeconds: 30,
    difficulty: 'easy',
    instructions: [
      'Sit or stand tall with arms resting loosely at your sides.',
      'Draw both shoulder blades backward and downward as if pinching a pencil between them.',
      'Hold the isometric contraction firmly for 6 seconds without shrugging shoulders up.',
      'Relax smoothly and repeat 4 times.'
    ],
    ergonomicBenefit: 'Reactivates dormant scapular stabilizers to prevent rounded shoulder posture.',
    iconName: 'Shield'
  }
];

export class ErgonomicCoachEngine {
  /**
   * Calculates the real-time Ergonomic Strain Score (0-100)
   */
  public static calculateStrainScore(state?: ErgonomicSessionState | null): ErgonomicStrainScore {
    if (!state) {
      return {
        score: 100,
        tier: 'optimal',
        factors: {
          postureBalanceScore: 100,
          stretchComplianceScore: 100,
          hydrationScore: 100,
          eyeRestScore: 100,
        },
        recommendation: 'Your ergonomics and movement patterns are in peak equilibrium!',
        nextSuggestedAction: 'Continue your focused flow.',
      };
    }

    const now = Date.now();
    const startTime = Number.isFinite(state.sessionStartTime) && state.sessionStartTime > 0
      ? state.sessionStartTime
      : now;
    const elapsedSeconds = Math.max(1, (now - startTime) / 1000);
    const elapsedHours = elapsedSeconds / 3600;

    const safeSitSec = Number.isFinite(state.totalSittingSeconds) ? Math.max(0, state.totalSittingSeconds) : 0;
    const safeStandSec = Number.isFinite(state.totalStandingSeconds) ? Math.max(0, state.totalStandingSeconds) : 0;

    // 1. Posture Balance Score (Sit vs Stand ratio)
    // Optimal: 60-70% sit, 30-40% stand for sit-stand desks; or regular posture check-ins for standard desk
    let postureBalanceScore = 100;
    const totalPosTime = safeSitSec + safeStandSec;
    
    if (state.deskType === 'height_adjustable_sit_stand' && totalPosTime > 600) {
      const standRatio = safeStandSec / totalPosTime;
      if (standRatio < 0.15) {
        postureBalanceScore = Math.max(40, 100 - (0.15 - standRatio) * 300);
      } else if (standRatio > 0.65) {
        postureBalanceScore = Math.max(50, 100 - (standRatio - 0.65) * 200);
      }
    } else {
      // Continuous sitting penalty (> 60 minutes uninterrupted sitting)
      const lastChange = Number.isFinite(state.lastPostureStateChange) && state.lastPostureStateChange > 0
        ? state.lastPostureStateChange
        : startTime;
      const currentContinuous = state.currentPostureState === 'sitting'
        ? Math.max(0, (now - lastChange) / 1000)
        : 0;
      if (currentContinuous > 3600) {
        const extraMinutes = (currentContinuous - 3600) / 60;
        postureBalanceScore = Math.max(30, 100 - extraMinutes * 1.5);
      }
    }

    // Adjust for posture check-ins
    const checkIns = Array.isArray(state.postureCheckIns) ? state.postureCheckIns : [];
    if (checkIns.length > 0) {
      const slouches = checkIns.filter(p => p && p.rating === 'slouching').length;
      const stiff = checkIns.filter(p => p && p.rating === 'stiff').length;
      const penalty = (slouches * 10) + (stiff * 5);
      postureBalanceScore = Math.max(20, postureBalanceScore - penalty);
    }

    // 2. Stretch Compliance Score
    const completedStretches = Array.isArray(state.completedStretches) ? state.completedStretches : [];
    const expectedStretches = Math.max(1, Math.floor(elapsedHours * 1.5));
    const stretchRatio = Math.min(1.2, completedStretches.length / expectedStretches);
    const stretchComplianceScore = Math.min(100, Math.round(stretchRatio * 100));

    // 3. Hydration Score
    const waterIntake = Number.isFinite(state.waterIntakeMl) ? Math.max(0, state.waterIntakeMl) : 0;
    const expectedIntake = Math.max(250, Math.round(elapsedHours * 250)); // ~250ml per hour
    const hydrationRatio = Math.min(1.2, waterIntake / expectedIntake);
    const hydrationScore = Math.min(100, Math.round(hydrationRatio * 100));

    // 4. Eye Rest Score (20-20-20 rule compliance)
    const eyeBreaks = Number.isFinite(state.eyeBreaksCompleted) ? Math.max(0, state.eyeBreaksCompleted) : 0;
    const expectedEyeBreaks = Math.max(1, Math.floor(elapsedHours * 3)); // every 20 mins
    const eyeRatio = Math.min(1.2, eyeBreaks / expectedEyeBreaks);
    const eyeRestScore = Math.min(100, Math.round(eyeRatio * 100));

    // Weighted Overall Score
    const weightedScore = Math.round(
      postureBalanceScore * 0.35 +
      stretchComplianceScore * 0.30 +
      eyeRestScore * 0.20 +
      hydrationScore * 0.15
    );

    const clampedScore = Math.max(0, Math.min(100, weightedScore));

    let tier: ErgonomicStrainScore['tier'] = 'optimal';
    let recommendation = 'Your ergonomics and movement patterns are in peak equilibrium!';
    let nextSuggestedAction = 'Continue your focused flow.';

    if (clampedScore >= 85) {
      tier = 'optimal';
      recommendation = 'Ergonomic equilibrium maintained. Great postural variability and eye rest rhythm.';
      nextSuggestedAction = 'Next micro-stretch scheduled in 25 minutes.';
    } else if (clampedScore >= 70) {
      tier = 'good';
      recommendation = 'Healthy baseline. Consider a quick 30-second shoulder roll or wrist extension.';
      nextSuggestedAction = 'Take a 20-20-20 ocular reset.';
    } else if (clampedScore >= 50) {
      tier = 'mild_strain';
      recommendation = 'Musculoskeletal fatigue accumulating from sustained static posture.';
      nextSuggestedAction = 'Perform the Seated Thoracic Spine Opener and sip water.';
    } else if (clampedScore >= 35) {
      tier = 'high_strain';
      recommendation = 'High postural strain detected! Significant uninterrupted sitting time.';
      nextSuggestedAction = 'Stand up immediately, perform hip flexor lunge & cervical chin tucks.';
    } else {
      tier = 'critical_fatigue';
      recommendation = 'Critical ergonomic overload. Extreme risk of cervical compression and eye strain.';
      nextSuggestedAction = 'Step away from your screen for a full 5-minute movement break.';
    }

    return {
      score: clampedScore,
      tier,
      factors: {
        postureBalanceScore: Math.round(postureBalanceScore),
        stretchComplianceScore: Math.round(stretchComplianceScore),
        hydrationScore: Math.round(hydrationScore),
        eyeRestScore: Math.round(eyeRestScore)
      },
      recommendation,
      nextSuggestedAction
    };
  }

  /**
   * Recommends the highest-priority stretch based on user check-in history and time
   */
  public static getRecommendedStretch(state?: ErgonomicSessionState | null): MicroStretchRoutine {
    if (!state) {
      return MICRO_STRETCH_CATALOG[0];
    }

    const checkIns = Array.isArray(state.postureCheckIns) ? state.postureCheckIns : [];
    const lastCheck = checkIns[checkIns.length - 1];
    
    if (lastCheck?.rating === 'slouching') {
      return MICRO_STRETCH_CATALOG.find(s => s.id === 'neck-chin-tuck') || MICRO_STRETCH_CATALOG[0];
    }
    
    if (lastCheck?.rating === 'stiff') {
      return MICRO_STRETCH_CATALOG.find(s => s.id === 'thoracic-open-book') || MICRO_STRETCH_CATALOG[1];
    }

    const lastChange = Number.isFinite(state.lastPostureStateChange) ? state.lastPostureStateChange : Date.now();
    if (state.currentPostureState === 'sitting' && (Date.now() - lastChange) > 2700000) {
      return MICRO_STRETCH_CATALOG.find(s => s.id === 'standing-hip-flexor-lunge') || MICRO_STRETCH_CATALOG[3];
    }

    // Default rotation based on completed stretches count
    const completedStretches = Array.isArray(state.completedStretches) ? state.completedStretches : [];
    const index = completedStretches.length % MICRO_STRETCH_CATALOG.length;
    return MICRO_STRETCH_CATALOG[index];
  }

  /**
   * Calculates real-time sitting vs. standing duration ratio metrics
   */
  public static calculateSitStandRatio(sittingSeconds: number, standingSeconds: number) {
    return calculateSitStandRatio(sittingSeconds, standingSeconds);
  }

  /**
   * Computes weekly summary analytics from daily records or default weekly history
   */
  public static computeWeeklySummary(dailyRecords?: DailyPostureRecord[], targetRatio = 2.0) {
    const records = dailyRecords && dailyRecords.length > 0 ? dailyRecords : generateSampleWeeklyPostureHistory(targetRatio);
    return computeWeeklyDeskSummary(records, targetRatio);
  }
}
