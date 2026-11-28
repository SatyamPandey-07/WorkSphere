export type TelemetryAvailabilityStatus = 'live' | 'degraded' | 'unavailable';

export interface ConciergeSensorReading {
  venueId: string;
  zoneId?: string;
  sensorId?: string;
  metric: 'temperature' | 'humidity' | 'co2' | 'noiseDb';
  value: number;
  recordedAt: string | Date;
  source?: string;
}

export interface ConciergeMemberSession {
  venueId: string;
  userId: string;
  zoneId?: string;
  seatLabel?: string;
  active: boolean;
  updatedAt?: string | Date;
}

export interface ConciergeZoneAssessment {
  zoneId: string;
  venueId: string;
  comfortScore: number | null;
  occupancyCount: number;
  telemetryStatus: TelemetryAvailabilityStatus;
  reasons: string[];
  recommendations: string[];
}

export interface ConciergeEvaluationInput {
  venueId: string;
  readings: ConciergeSensorReading[];
  sessions: ConciergeMemberSession[];
  nowMs?: number;
  maxAgeMs?: number;
  isSimulation?: boolean;
}

export interface ConciergeEvaluationResult {
  venueId: string;
  evaluatedAt: string;
  telemetryStatus: TelemetryAvailabilityStatus;
  isSimulation: boolean;
  validReadingCount: number;
  rejectedReadingCount: number;
  activeMemberCount: number;
  zones: ConciergeZoneAssessment[];
  recommendations: string[];
  warnings: string[];
}

export const DEFAULT_MAX_TELEMETRY_AGE_MS = 10 * 60 * 1000;

export function isValidSensorMeasurement(
  reading: ConciergeSensorReading,
  expectedVenueId: string,
  nowMs: number,
  maxAgeMs: number = DEFAULT_MAX_TELEMETRY_AGE_MS
): { valid: boolean; reason?: string } {
  if (!reading || reading.venueId !== expectedVenueId) {
    return { valid: false, reason: 'cross_venue_or_missing_venue' };
  }
  if (typeof reading.value !== 'number' || !Number.isFinite(reading.value)) {
    return { valid: false, reason: 'non_finite_value' };
  }

  switch (reading.metric) {
    case 'temperature':
      if (reading.value < -10 || reading.value > 60) {
        return { valid: false, reason: 'temperature_out_of_range' };
      }
      break;
    case 'humidity':
      if (reading.value < 0 || reading.value > 100) {
        return { valid: false, reason: 'humidity_out_of_range' };
      }
      break;
    case 'co2':
      if (reading.value < 300 || reading.value > 10_000) {
        return { valid: false, reason: 'co2_out_of_range' };
      }
      break;
    case 'noiseDb':
      if (reading.value < 10 || reading.value > 140) {
        return { valid: false, reason: 'noise_out_of_range' };
      }
      break;
    default:
      return { valid: false, reason: 'unknown_metric' };
  }

  const ts =
    reading.recordedAt instanceof Date
      ? reading.recordedAt.getTime()
      : Date.parse(String(reading.recordedAt));

  if (!Number.isFinite(ts) || ts <= 0) {
    return { valid: false, reason: 'invalid_timestamp' };
  }
  if (ts > nowMs + 60_000) {
    return { valid: false, reason: 'future_timestamp' };
  }
  if (nowMs - ts > maxAgeMs) {
    return { valid: false, reason: 'stale_reading' };
  }

  return { valid: true };
}

export function evaluateVenueConcierge(
  input: ConciergeEvaluationInput
): ConciergeEvaluationResult {
  const nowMs = input.nowMs ?? Date.now();
  const maxAgeMs = input.maxAgeMs ?? DEFAULT_MAX_TELEMETRY_AGE_MS;
  const venueId = input.venueId.trim();

  const warnings: string[] = [];
  let rejectedReadingCount = 0;
  const validReadings: ConciergeSensorReading[] = [];

  for (const reading of input.readings ?? []) {
    const check = isValidSensorMeasurement(reading, venueId, nowMs, maxAgeMs);
    if (check.valid) {
      validReadings.push(reading);
    } else {
      rejectedReadingCount += 1;
      if (check.reason) {
        warnings.push(`Rejected sensor reading (${check.reason}).`);
      }
    }
  }

  const activeSessions = (input.sessions ?? []).filter(
    (s) => s && s.venueId === venueId && s.active === true
  );

  if (validReadings.length === 0) {
    warnings.push(
      'Live environmental telemetry is unavailable for this venue; operational comfort recommendations are withheld.'
    );

    return {
      venueId,
      evaluatedAt: new Date(nowMs).toISOString(),
      telemetryStatus: 'unavailable',
      isSimulation: Boolean(input.isSimulation),
      validReadingCount: 0,
      rejectedReadingCount,
      activeMemberCount: activeSessions.length,
      zones: [],
      recommendations: [],
      warnings,
    };
  }

  const telemetryStatus: TelemetryAvailabilityStatus =
    rejectedReadingCount > 0 ? 'degraded' : 'live';

  const byZone = new Map<string, ConciergeSensorReading[]>();
  for (const r of validReadings) {
    const zoneKey = r.zoneId?.trim() || 'default';
    const list = byZone.get(zoneKey) ?? [];
    list.push(r);
    byZone.set(zoneKey, list);
  }

  const recommendations: string[] = [];
  const zones: ConciergeZoneAssessment[] = Array.from(byZone.entries()).map(
    ([zoneId, zoneReadings]) => {
      const zoneSessions = activeSessions.filter(
        (s) => (s.zoneId?.trim() || 'default') === zoneId
      );
      let penalty = 0;
      const reasons: string[] = [];
      const zoneRecs: string[] = [];

      for (const r of zoneReadings) {
        if (r.metric === 'co2' && r.value > 1000) {
          penalty += 25;
          reasons.push(`Elevated CO2 (${r.value} ppm)`);
          zoneRecs.push(`Increase ventilation or air exchange in ${zoneId}.`);
        }
        if (r.metric === 'noiseDb' && r.value > 65) {
          penalty += 20;
          reasons.push(`Elevated noise (${r.value} dB)`);
          zoneRecs.push(`Route focus work away from ${zoneId}.`);
        }
        if (r.metric === 'temperature' && (r.value < 18 || r.value > 26)) {
          penalty += 15;
          reasons.push(`Out-of-band temperature (${r.value} C)`);
          zoneRecs.push(`Adjust HVAC setpoint in ${zoneId} toward 21-24 C.`);
        }
      }

      recommendations.push(...zoneRecs);

      return {
        zoneId,
        venueId,
        comfortScore: Math.max(0, 100 - penalty),
        occupancyCount: zoneSessions.length,
        telemetryStatus,
        reasons,
        recommendations: zoneRecs,
      };
    }
  );

  return {
    venueId,
    evaluatedAt: new Date(nowMs).toISOString(),
    telemetryStatus,
    isSimulation: Boolean(input.isSimulation),
    validReadingCount: validReadings.length,
    rejectedReadingCount,
    activeMemberCount: activeSessions.length,
    zones,
    recommendations,
    warnings,
  };
}

export interface EnvironmentalSensorFeed {
  venueId: string;
  zoneId: string;
  zoneName: string;
  zoneType:
    | 'outdoor_terrace'
    | 'open_floor'
    | 'quiet_library'
    | 'window_bay'
    | 'phone_booths';
  temperatureC: number;
  humidityPercent: number;
  co2Ppm: number;
  decibelLevel: number;
  weatherCondition:
    | 'clear'
    | 'partly_cloudy'
    | 'rain_storm'
    | 'high_wind'
    | 'extreme_uv';
  isDirectSunlight: boolean;
  occupancyCount: number;
  maxCapacity: number;
}

export interface MemberWorkspaceSession {
  memberId: string;
  memberName: string;
  currentDeskId: string;
  currentZoneId: string;
  assignedZoneName: string;
  deskType: 'outdoor_terrace' | 'open_desk' | 'standing_desk' | 'quiet_booth';
  preferences: {
    autoPilotEnabled: boolean;
    preferredNoiseLevel: 'silent' | 'moderate' | 'lively';
    prefersNaturalLight: boolean;
    temperatureComfortC: number;
  };
  currentComfortIndex: number;
}

export interface RebalanceRecommendation {
  id: string;
  memberId: string;
  memberName: string;
  currentDeskId: string;
  currentZoneName: string;
  recommendedDeskId: string;
  recommendedZoneName: string;
  triggerReason:
    | 'sudden_rain_hazard'
    | 'acoustic_noise_spike'
    | 'high_co2_lethargy'
    | 'thermal_discomfort';
  urgency: 'critical' | 'high' | 'moderate';
  comfortDelta: number;
  conciergeExplanation: string;
  isAutoApplied: boolean;
  timestamp: number;
}

export class AutonomousConciergeEngine {
  /**
   * Evaluates zone comfort score (0 - 100) based on environmental sensor metrics.
   */
  public static calculateZoneComfort(feed: EnvironmentalSensorFeed): number {
    let score = 100;

    if (feed.zoneType === 'outdoor_terrace') {
      if (feed.weatherCondition === 'rain_storm') {
        return 10;
      }
      if (
        feed.weatherCondition === 'high_wind' ||
        feed.weatherCondition === 'extreme_uv'
      ) {
        score -= 40;
      }
    }

    if (feed.decibelLevel > 70) {
      score -= (feed.decibelLevel - 70) * 2.5;
    } else if (feed.decibelLevel > 55 && feed.zoneType === 'quiet_library') {
      score -= (feed.decibelLevel - 55) * 3;
    }

    const tempDev = Math.abs(feed.temperatureC - 22);
    score -= tempDev * 3;

    if (feed.co2Ppm > 1000) {
      const co2Excess = (feed.co2Ppm - 1000) / 100;
      score -= co2Excess * 4;
    }

    const occupancyRatio = feed.occupancyCount / Math.max(1, feed.maxCapacity);
    if (occupancyRatio > 0.85) {
      score -= (occupancyRatio - 0.85) * 50;
    }

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Runs the rebalancing optimization pass across all active members in a venue.
   */
  public static runRebalanceOptimizationPass(
    sensors: EnvironmentalSensorFeed[],
    sessions: MemberWorkspaceSession[],
  ): {
    recommendations: RebalanceRecommendation[];
    displacedCount: number;
    avgComfortImprovement: number;
  } {
    const recommendations: RebalanceRecommendation[] = [];
    const sensorMap = new Map<string, EnvironmentalSensorFeed>();
    sensors.forEach((sensor) => sensorMap.set(sensor.zoneId, sensor));

    const candidateZones = sensors
      .filter(
        (sensor) =>
          sensor.occupancyCount < sensor.maxCapacity &&
          this.calculateZoneComfort(sensor) >= 75,
      )
      .sort(
        (a, b) => this.calculateZoneComfort(b) - this.calculateZoneComfort(a),
      );

    let totalComfortDelta = 0;

    sessions.forEach((session) => {
      const currentSensor = sensorMap.get(session.currentZoneId);
      if (!currentSensor) return;

      const currentComfort = this.calculateZoneComfort(currentSensor);
      let needsMigration = false;
      let triggerReason: RebalanceRecommendation['triggerReason'] =
        'thermal_discomfort';
      let urgency: RebalanceRecommendation['urgency'] = 'moderate';
      let explanation = '';

      if (
        currentSensor.zoneType === 'outdoor_terrace' &&
        currentSensor.weatherCondition === 'rain_storm'
      ) {
        needsMigration = true;
        triggerReason = 'sudden_rain_hazard';
        urgency = 'critical';
        explanation =
          'Sudden precipitation detected on the Rooftop Terrace. Migrated to an indoor panoramic sunlit desk.';
      } else if (
        currentSensor.decibelLevel >= 72 ||
        (session.preferences.preferredNoiseLevel === 'silent' &&
          currentSensor.decibelLevel > 58)
      ) {
        needsMigration = true;
        triggerReason = 'acoustic_noise_spike';
        urgency = 'high';
        explanation = `Acoustic spike of ${currentSensor.decibelLevel} dB detected near your desk. Relocating to acoustic focus zone.`;
      } else if (currentSensor.co2Ppm > 1300) {
        needsMigration = true;
        triggerReason = 'high_co2_lethargy';
        urgency = 'moderate';
        explanation = `CO2 levels in ${currentSensor.zoneName} reached ${currentSensor.co2Ppm} ppm (inducing fatigue). Re-balancing to high-airflow zone.`;
      } else if (currentComfort < 50) {
        needsMigration = true;
        triggerReason = 'thermal_discomfort';
        urgency = 'moderate';
        explanation = `Zone comfort dropped to ${currentComfort}%. Rerouting to optimal climate zone.`;
      }

      if (needsMigration && candidateZones.length > 0) {
        const targetZone = candidateZones[0];
        const targetComfort = this.calculateZoneComfort(targetZone);
        const delta = Math.max(10, targetComfort - currentComfort);

        const recommendation: RebalanceRecommendation = {
          id: `reb-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          memberId: session.memberId,
          memberName: session.memberName,
          currentDeskId: session.currentDeskId,
          currentZoneName: currentSensor.zoneName,
          recommendedDeskId: `Desk-${targetZone.zoneId.slice(-2)}-${Math.floor(Math.random() * 20) + 1}`,
          recommendedZoneName: targetZone.zoneName,
          triggerReason,
          urgency,
          comfortDelta: delta,
          conciergeExplanation: explanation,
          isAutoApplied: session.preferences.autoPilotEnabled,
          timestamp: Date.now(),
        };

        recommendations.push(recommendation);
        totalComfortDelta += delta;
        targetZone.occupancyCount += 1;
      }
    });

    const avgComfortImprovement =
      recommendations.length > 0
        ? Math.round(totalComfortDelta / recommendations.length)
        : 0;

    return {
      recommendations,
      displacedCount: recommendations.length,
      avgComfortImprovement,
    };
  }
}