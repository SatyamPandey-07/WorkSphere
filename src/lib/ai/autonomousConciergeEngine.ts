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