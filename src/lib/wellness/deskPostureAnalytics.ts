/**
 * deskPostureAnalytics.ts
 * Core domain analytics engine for tracking sitting vs. standing desk duration ratio,
 * sit-stand transition cadence, daily logs, and weekly summary analytics.
 *
 * Grounded in ergonomic standards (OSHA & Cornell Human Factors and Ergonomics 20-8-2 model).
 */

export interface DailyPostureRecord {
  id: string;
  date: string; // ISO "YYYY-MM-DD"
  dayOfWeek: string; // "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"
  dayName: string; // "Monday", etc.
  sittingSeconds: number;
  standingSeconds: number;
  transitionsCount: number;
  targetRatio: number; // e.g. 2.0 (representing 2:1 sit:stand)
  actualRatio: number; // sittingSeconds / Math.max(1, standingSeconds)
  ratioDisplay: string; // e.g. "2.1 : 1"
  sittingPercentage: number; // 0-100
  standingPercentage: number; // 0-100
  complianceStatus: 'optimal' | 'good' | 'needs_more_standing' | 'excessive_standing' | 'low_activity';
  activeCaloriesBurned: number; // Extra kcal burned standing vs sitting (~40 kcal/hr)
  notes?: string;
}

export interface WeeklyDeskSummaryAnalytics {
  weekLabel: string;
  startDate: string;
  endDate: string;
  totalSittingSeconds: number;
  totalStandingSeconds: number;
  totalDeskSeconds: number;
  sittingPercentage: number;
  standingPercentage: number;
  overallRatio: number;
  overallRatioFormatted: string; // e.g. "2.1 : 1"
  targetRatio: number; // Target sit:stand ratio
  averageDailySittingMinutes: number;
  averageDailyStandingMinutes: number;
  totalTransitionsCount: number;
  averageDailyTransitions: number;
  peakStandingDay: { day: string; hours: number; minutes: number };
  mostSedentaryDay: { day: string; hours: number; minutes: number };
  weeklyErgonomicGrade: 'A+' | 'A' | 'B' | 'C' | 'D';
  weeklyGradeDescription: string;
  totalActiveCaloriesKcal: number;
  targetMetDaysCount: number;
  totalActiveDaysCount: number;
  dailyRecords: DailyPostureRecord[];
  keyInsights: Array<{
    type: 'positive' | 'warning' | 'tip';
    title: string;
    description: string;
  }>;
  actionableRecommendations: string[];
}

export const SIT_STAND_TARGET_PRESETS = [
  {
    id: 'beginner_3_1',
    ratio: 3.0,
    label: '3:1 Baseline (45m sit / 15m stand)',
    description: 'Ideal for easing into a sit-stand desk routine without foot/lower back fatigue.',
    sittingPct: 75,
    standingPct: 25,
  },
  {
    id: 'recommended_2_1',
    ratio: 2.0,
    label: '2:1 Recommended (40m sit / 20m stand)',
    description: 'Gold standard clinical ratio for cardiovascular flow and spinal decompression.',
    sittingPct: 67,
    standingPct: 33,
  },
  {
    id: 'active_1_1',
    ratio: 1.0,
    label: '1:1 Dynamic (30m sit / 30m stand)',
    description: 'High energy active posture rotation for experienced height-adjustable desk users.',
    sittingPct: 50,
    standingPct: 50,
  },
] as const;

/**
 * Calculates sitting vs. standing duration ratio metrics
 */
export function calculateSitStandRatio(sittingSeconds: number, standingSeconds: number): {
  ratio: number;
  display: string;
  sittingPct: number;
  standingPct: number;
  sittingHours: number;
  standingHours: number;
  totalHours: number;
} {
  const safeSit = Number.isFinite(sittingSeconds) ? Math.max(0, sittingSeconds) : 0;
  const safeStand = Number.isFinite(standingSeconds) ? Math.max(0, standingSeconds) : 0;
  const totalSeconds = safeSit + safeStand;

  if (totalSeconds === 0) {
    return {
      ratio: 1,
      display: '1.0 : 1',
      sittingPct: 50,
      standingPct: 50,
      sittingHours: 0,
      standingHours: 0,
      totalHours: 0,
    };
  }

  const sittingPct = Math.round((safeSit / totalSeconds) * 100);
  const standingPct = 100 - sittingPct;
  const ratio = safeStand === 0 ? safeSit / 60 : Number((safeSit / safeStand).toFixed(2));
  const display = safeStand === 0 ? `${Math.round(safeSit / 60)}m : 0m` : `${(safeSit / safeStand).toFixed(1)} : 1`;

  return {
    ratio,
    display,
    sittingPct,
    standingPct,
    sittingHours: Number((safeSit / 3600).toFixed(1)),
    standingHours: Number((safeStand / 3600).toFixed(1)),
    totalHours: Number((totalSeconds / 3600).toFixed(1)),
  };
}

/**
 * Evaluates posture ratio compliance tier
 */
export function evaluatePostureCompliance(
  sittingSeconds: number,
  standingSeconds: number,
  targetRatio = 2.0
): DailyPostureRecord['complianceStatus'] {
  const safeSit = Number.isFinite(sittingSeconds) ? Math.max(0, sittingSeconds) : 0;
  const safeStand = Number.isFinite(standingSeconds) ? Math.max(0, standingSeconds) : 0;
  const safeTarget = Number.isFinite(targetRatio) && targetRatio > 0 ? targetRatio : 2.0;

  const total = safeSit + safeStand;
  if (total < 600) return 'low_activity'; // Under 10 minutes total

  const standingPct = (safeStand / total) * 100;

  // Ideal target band based on safeTarget:
  // e.g., target 2:1 -> standing ~33%, optimal range 28%-42%
  const targetStandingPct = 100 / (safeTarget + 1);

  if (standingPct >= targetStandingPct * 0.85 && standingPct <= targetStandingPct * 1.35) {
    return 'optimal';
  } else if (standingPct >= targetStandingPct * 0.65 && standingPct <= targetStandingPct * 1.6) {
    return 'good';
  } else if (standingPct < targetStandingPct * 0.65) {
    return 'needs_more_standing';
  } else {
    return 'excessive_standing';
  }
}

/**
 * Calculates estimated metabolic calories burned from standing vs prolonged sitting
 * Standing burns roughly ~0.65 kcal/minute over resting seated posture (~40 kcal/hour).
 */
export function estimateStandingCaloriesBurned(standingSeconds: number): number {
  const safeStand = Number.isFinite(standingSeconds) ? Math.max(0, standingSeconds) : 0;
  const standingMinutes = safeStand / 60;
  return Math.round(standingMinutes * 0.65);
}

/**
 * Formats seconds into human-readable hours and minutes (e.g., "3h 24m" or "45m")
 */
export function formatDurationHoursMinutes(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.round(totalSeconds)) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);

  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

/**
 * Constructs a single DailyPostureRecord
 */
export function buildDailyPostureRecord(params: {
  date: string;
  dayOfWeek: string;
  dayName: string;
  sittingSeconds: number;
  standingSeconds: number;
  transitionsCount?: number;
  targetRatio?: number;
  notes?: string;
}): DailyPostureRecord {
  const target = Number.isFinite(params.targetRatio) && (params.targetRatio ?? 0) > 0 ? (params.targetRatio as number) : 2.0;
  const safeSit = Number.isFinite(params.sittingSeconds) ? Math.max(0, Math.round(params.sittingSeconds)) : 0;
  const safeStand = Number.isFinite(params.standingSeconds) ? Math.max(0, Math.round(params.standingSeconds)) : 0;
  const safeTrans = Number.isFinite(params.transitionsCount) ? Math.max(0, Math.round(params.transitionsCount as number)) : 0;

  const ratioMetrics = calculateSitStandRatio(safeSit, safeStand);
  const compliance = evaluatePostureCompliance(safeSit, safeStand, target);
  const calories = estimateStandingCaloriesBurned(safeStand);

  return {
    id: `posture-${params.date || 'unspecified'}`,
    date: params.date || new Date().toISOString().split('T')[0],
    dayOfWeek: params.dayOfWeek || 'Mon',
    dayName: params.dayName || 'Monday',
    sittingSeconds: safeSit,
    standingSeconds: safeStand,
    transitionsCount: safeTrans,
    targetRatio: target,
    actualRatio: ratioMetrics.ratio,
    ratioDisplay: ratioMetrics.display,
    sittingPercentage: ratioMetrics.sittingPct,
    standingPercentage: ratioMetrics.standingPct,
    complianceStatus: compliance,
    activeCaloriesBurned: calories,
    notes: params.notes,
  };
}

/**
 * Computes weekly summary analytics from a 7-day array of DailyPostureRecords
 */
export function computeWeeklyDeskSummary(
  dailyRecords?: DailyPostureRecord[] | null,
  targetRatio = 2.0
): WeeklyDeskSummaryAnalytics {
  const records = Array.isArray(dailyRecords) ? dailyRecords.filter((r): r is DailyPostureRecord => Boolean(r)) : [];
  const safeTargetRatio = Number.isFinite(targetRatio) && targetRatio > 0 ? targetRatio : 2.0;

  let totalSitting = 0;
  let totalStanding = 0;
  let totalTransitions = 0;
  let targetMetDays = 0;
  let activeDays = 0;

  let peakStandingDay = { day: 'None', hours: 0, minutes: 0 };
  let maxStandingSec = -1;

  let mostSedentaryDay = { day: 'None', hours: 0, minutes: 0 };
  let maxSittingSec = -1;

  records.forEach((record) => {
    const sitSec = Number.isFinite(record.sittingSeconds) ? Math.max(0, record.sittingSeconds) : 0;
    const standSec = Number.isFinite(record.standingSeconds) ? Math.max(0, record.standingSeconds) : 0;
    const transCount = Number.isFinite(record.transitionsCount) ? Math.max(0, record.transitionsCount) : 0;

    totalSitting += sitSec;
    totalStanding += standSec;
    totalTransitions += transCount;

    const dayTotal = sitSec + standSec;
    if (dayTotal > 1800) {
      activeDays += 1;
      if (record.complianceStatus === 'optimal' || record.complianceStatus === 'good') {
        targetMetDays += 1;
      }
    }

    if (standSec > maxStandingSec) {
      maxStandingSec = standSec;
      peakStandingDay = {
        day: record.dayName || 'Unknown',
        hours: Math.floor(standSec / 3600),
        minutes: Math.floor((standSec % 3600) / 60),
      };
    }

    if (sitSec > maxSittingSec) {
      maxSittingSec = sitSec;
      mostSedentaryDay = {
        day: record.dayName || 'Unknown',
        hours: Math.floor(sitSec / 3600),
        minutes: Math.floor((sitSec % 3600) / 60),
      };
    }
  });

  const totalDesk = totalSitting + totalStanding;
  const ratioMetrics = calculateSitStandRatio(totalSitting, totalStanding);
  const totalCalories = estimateStandingCaloriesBurned(totalStanding);

  const averageDailySittingMinutes =
    activeDays > 0 ? Math.round(totalSitting / activeDays / 60) : 0;
  const averageDailyStandingMinutes =
    activeDays > 0 ? Math.round(totalStanding / activeDays / 60) : 0;
  const averageDailyTransitions =
    activeDays > 0 ? Math.round((totalTransitions / activeDays) * 10) / 10 : 0;

  // Ergonomic Grading
  let weeklyErgonomicGrade: WeeklyDeskSummaryAnalytics['weeklyErgonomicGrade'] = 'B';
  let weeklyGradeDescription = 'Moderate posture variation; continue building standing intervals.';

  const standingPct = ratioMetrics.standingPct;

  if (activeDays >= 3) {
    if (standingPct >= 28 && standingPct <= 45 && targetMetDays >= 4) {
      weeklyErgonomicGrade = 'A+';
      weeklyGradeDescription =
        'Exceptional posture equilibrium! You maintained optimal sit-to-stand cadence across the entire week.';
    } else if (standingPct >= 22 && standingPct <= 52 && targetMetDays >= 3) {
      weeklyErgonomicGrade = 'A';
      weeklyGradeDescription =
        'Great ergonomic discipline. Well-balanced muscular loading and spinal relief.';
    } else if (standingPct >= 16 && standingPct <= 60) {
      weeklyErgonomicGrade = 'B';
      weeklyGradeDescription =
        'Solid baseline. Increasing standing desk duration by 10-15 minutes per session will reach ideal targets.';
    } else if (standingPct >= 10) {
      weeklyErgonomicGrade = 'C';
      weeklyGradeDescription =
        'High sedentary sitting bias detected. Consider scheduled sit-stand desk alarms.';
    } else {
      weeklyErgonomicGrade = 'D';
      weeklyGradeDescription =
        'Critical sedentary overload. Over 90% of desk time was seated uninterrupted.';
    }
  } else if (activeDays === 0) {
    weeklyErgonomicGrade = 'D';
    weeklyGradeDescription =
      'No active desk sessions logged this week. Check into your workstation to track posture.';
  }

  // Key Insights Generator
  const keyInsights: WeeklyDeskSummaryAnalytics['keyInsights'] = [];

  if (standingPct >= 25) {
    keyInsights.push({
      type: 'positive',
      title: 'Strong Postural Variability',
      description: `Your weekly standing ratio (${ratioMetrics.standingPct}%) protected your lumbar spine and lowered disc compression during prolonged work blocks.`,
    });
  } else {
    keyInsights.push({
      type: 'warning',
      title: 'Sedentary Sitting Bias',
      description: `Sitting accounted for ${ratioMetrics.sittingPct}% of weekly desk time. Cornell Ergonomics recommends standing at least 15-20 minutes for every hour seated.`,
    });
  }

  if (peakStandingDay.day !== 'None' && maxStandingSec > 3600) {
    keyInsights.push({
      type: 'positive',
      title: `Peak Standing Day: ${peakStandingDay.day}`,
      description: `You logged ${peakStandingDay.hours}h ${peakStandingDay.minutes}m of standing on ${peakStandingDay.day}, achieving high postural balance.`,
    });
  }

  if (totalTransitions >= 20) {
    keyInsights.push({
      type: 'positive',
      title: 'Frequent Height Transitions',
      description: `Logged ${totalTransitions} total sit-stand transitions (${averageDailyTransitions}/day average). Regular height transitions stimulate venous blood flow.`,
    });
  } else {
    keyInsights.push({
      type: 'tip',
      title: 'Transition Frequency Opportunity',
      description: 'Try switching desk height 2 to 3 times per work block rather than staying static in either position.',
    });
  }

  // Actionable Recommendations
  const actionableRecommendations: string[] = [];
  if (standingPct < 25) {
    actionableRecommendations.push(
      'Set an hourly chime to raise your desk for the final 15 minutes of each focus block.'
    );
    actionableRecommendations.push(
      'Take phone calls and async review tasks standing up to boost daily standing minutes.'
    );
  } else if (standingPct > 55) {
    actionableRecommendations.push(
      'Avoid standing for more than 45 continuous minutes without anti-fatigue mat support to prevent joint fatigue.'
    );
  } else {
    actionableRecommendations.push(
      'Maintain your current 2:1 ratio rhythm: 40 minutes seated, 20 minutes standing.'
    );
  }
  actionableRecommendations.push(
    'Pair each desk transition with a quick 30-second shoulder blade pinch or hip flexor stretch.'
  );

  const nowIsoDate = new Date().toISOString().split('T')[0];
  const startDate = records[0]?.date || nowIsoDate;
  const endDate = records[records.length - 1]?.date || nowIsoDate;
  const weekLabel = records.length > 0
    ? `${records[0]?.dayOfWeek || 'Mon'} - ${records[records.length - 1]?.dayOfWeek || 'Sun'}`
    : 'No Active Week';

  return {
    weekLabel,
    startDate,
    endDate,
    totalSittingSeconds: totalSitting,
    totalStandingSeconds: totalStanding,
    totalDeskSeconds: totalDesk,
    sittingPercentage: ratioMetrics.sittingPct,
    standingPercentage: ratioMetrics.standingPct,
    overallRatio: ratioMetrics.ratio,
    overallRatioFormatted: ratioMetrics.display,
    targetRatio: safeTargetRatio,
    averageDailySittingMinutes,
    averageDailyStandingMinutes,
    totalTransitionsCount: totalTransitions,
    averageDailyTransitions,
    peakStandingDay,
    mostSedentaryDay,
    weeklyErgonomicGrade,
    weeklyGradeDescription,
    totalActiveCaloriesKcal: totalCalories,
    targetMetDaysCount: targetMetDays,
    totalActiveDaysCount: activeDays,
    dailyRecords: records,
    keyInsights,
    actionableRecommendations,
  };
}

/**
 * Generates realistic 7-day historical posture records for initial seeding
 * Anchored to the past 7 days relative to today.
 */
export function generateSampleWeeklyPostureHistory(targetRatio = 2.0): DailyPostureRecord[] {
  const safeTarget = Number.isFinite(targetRatio) && targetRatio > 0 ? targetRatio : 2.0;
  const daysMeta = [
    { dayOfWeek: 'Mon', dayName: 'Monday', sitHrs: 5.2, standHrs: 2.1, transitions: 7, notes: 'Focus work & standup' },
    { dayOfWeek: 'Tue', dayName: 'Tuesday', sitHrs: 4.8, standHrs: 2.6, transitions: 9, notes: 'Optimal 1.8:1 ratio achieved' },
    { dayOfWeek: 'Wed', dayName: 'Wednesday', sitHrs: 5.5, standHrs: 1.8, transitions: 6, notes: 'Design reviews & coding' },
    { dayOfWeek: 'Thu', dayName: 'Thursday', sitHrs: 4.5, standHrs: 2.9, transitions: 10, notes: 'Peak standing day' },
    { dayOfWeek: 'Fri', dayName: 'Friday', sitHrs: 5.0, standHrs: 2.0, transitions: 7, notes: 'Sprint wrap-up' },
    { dayOfWeek: 'Sat', dayName: 'Saturday', sitHrs: 2.0, standHrs: 1.2, transitions: 4, notes: 'Weekend casual study' },
    { dayOfWeek: 'Sun', dayName: 'Sunday', sitHrs: 1.5, standHrs: 0.8, transitions: 3, notes: 'Weekly planning' },
  ];

  const now = new Date();
  const currentDayIndex = (now.getDay() + 6) % 7; // 0=Mon, 6=Sun

  return daysMeta.map((meta, idx) => {
    // Generate date string offset
    const dayDiff = idx - currentDayIndex;
    const targetDate = new Date(now);
    targetDate.setDate(now.getDate() + dayDiff);
    const dateStr = targetDate.toISOString().split('T')[0];

    const sitSec = Math.round(meta.sitHrs * 3600);
    const standSec = Math.round(meta.standHrs * 3600);

    return buildDailyPostureRecord({
      date: dateStr,
      dayOfWeek: meta.dayOfWeek,
      dayName: meta.dayName,
      sittingSeconds: sitSec,
      standingSeconds: standSec,
      transitionsCount: meta.transitions,
      targetRatio: safeTarget,
      notes: meta.notes,
    });
  });
}

/**
 * Syncs the live session into today's record in the 7-day records list
 */
export function syncLiveSessionToDailyRecords(
  existingRecords?: DailyPostureRecord[] | null,
  liveSittingSeconds: number = 0,
  liveStandingSeconds: number = 0,
  transitionsCount = 0,
  targetRatio = 2.0
): DailyPostureRecord[] {
  const safeTarget = Number.isFinite(targetRatio) && targetRatio > 0 ? targetRatio : 2.0;
  const now = new Date();
  const currentDayIndex = (now.getDay() + 6) % 7; // 0=Mon..6=Sun
  const dateStr = now.toISOString().split('T')[0];

  const records = Array.isArray(existingRecords) && existingRecords.length === 7
    ? [...existingRecords]
    : generateSampleWeeklyPostureHistory(safeTarget);

  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const dayShorts = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const targetIdx = records.findIndex((r) => r && (r.date === dateStr || r.dayOfWeek === dayShorts[currentDayIndex]));

  if (targetIdx !== -1) {
    const existing = records[targetIdx];
    const safeLiveSit = Number.isFinite(liveSittingSeconds) ? Math.max(0, liveSittingSeconds) : 0;
    const safeLiveStand = Number.isFinite(liveStandingSeconds) ? Math.max(0, liveStandingSeconds) : 0;
    const safeTransitions = Number.isFinite(transitionsCount) ? Math.max(0, transitionsCount) : 0;

    // Incorporate live session time
    const updatedSitting = Math.max(existing?.sittingSeconds ?? 0, safeLiveSit);
    const updatedStanding = Math.max(existing?.standingSeconds ?? 0, safeLiveStand);
    const updatedTransitions = Math.max(existing?.transitionsCount ?? 0, safeTransitions);

    records[targetIdx] = buildDailyPostureRecord({
      date: existing?.date || dateStr,
      dayOfWeek: existing?.dayOfWeek || dayShorts[currentDayIndex],
      dayName: existing?.dayName || dayNames[currentDayIndex],
      sittingSeconds: updatedSitting,
      standingSeconds: updatedStanding,
      transitionsCount: updatedTransitions,
      targetRatio: safeTarget,
      notes: existing?.notes || 'Live telemetry synced',
    });
  }

  return records;
}
