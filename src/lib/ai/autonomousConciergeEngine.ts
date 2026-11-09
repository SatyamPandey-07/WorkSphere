/**
 * Autonomous AI Concierge & Weather / Noise Re-balancing Auto-Pilot Engine
 * Continuously evaluates environmental telemetry (sudden precipitation, thermal drift,
 * acoustic spikes, HVAC CO2 accumulation) and autonomously rebalances desk bookings
 * to maximize coworker comfort, focus, and productivity.
 */

export interface EnvironmentalSensorFeed {
  venueId: string;
  zoneId: string;
  zoneName: string;
  zoneType: 'outdoor_terrace' | 'open_floor' | 'quiet_library' | 'window_bay' | 'phone_booths';
  temperatureC: number;
  humidityPercent: number;
  co2Ppm: number;
  decibelLevel: number;
  weatherCondition: 'clear' | 'partly_cloudy' | 'rain_storm' | 'high_wind' | 'extreme_uv';
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
  currentComfortIndex: number; // 0 - 100
}

export interface RebalanceRecommendation {
  id: string;
  memberId: string;
  memberName: string;
  currentDeskId: string;
  currentZoneName: string;
  recommendedDeskId: string;
  recommendedZoneName: string;
  triggerReason: 'sudden_rain_hazard' | 'acoustic_noise_spike' | 'high_co2_lethargy' | 'thermal_discomfort';
  urgency: 'critical' | 'high' | 'moderate';
  comfortDelta: number; // e.g. +35 points
  conciergeExplanation: string;
  isAutoApplied: boolean;
  timestamp: number;
}

export class AutonomousConciergeEngine {
  /**
   * Evaluates zone comfort score (0 - 100) based on environmental sensor metrics
   */
  public static calculateZoneComfort(feed: EnvironmentalSensorFeed): number {
    let score = 100;

    // 1. Weather impact on outdoor zones
    if (feed.zoneType === 'outdoor_terrace') {
      if (feed.weatherCondition === 'rain_storm') {
        return 10; // unusable in heavy rain
      }
      if (feed.weatherCondition === 'high_wind' || feed.weatherCondition === 'extreme_uv') {
        score -= 40;
      }
    }

    // 2. Acoustic impact
    if (feed.decibelLevel > 70) {
      score -= (feed.decibelLevel - 70) * 2.5;
    } else if (feed.decibelLevel > 55 && feed.zoneType === 'quiet_library') {
      score -= (feed.decibelLevel - 55) * 3;
    }

    // 3. Thermal comfort (optimal ~ 21 - 23°C)
    const tempDev = Math.abs(feed.temperatureC - 22);
    score -= tempDev * 3;

    // 4. CO2 levels (optimal < 800 ppm, > 1200 induces fatigue)
    if (feed.co2Ppm > 1000) {
      const co2Excess = (feed.co2Ppm - 1000) / 100;
      score -= co2Excess * 4;
    }

    // 5. Crowd density
    const occupancyRatio = feed.occupancyCount / Math.max(1, feed.maxCapacity);
    if (occupancyRatio > 0.85) {
      score -= (occupancyRatio - 0.85) * 50;
    }

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Runs the rebalancing optimization pass across all active members in a venue
   */
  public static runRebalanceOptimizationPass(
    sensors: EnvironmentalSensorFeed[],
    sessions: MemberWorkspaceSession[]
  ): {
    recommendations: RebalanceRecommendation[];
    displacedCount: number;
    avgComfortImprovement: number;
  } {
    const recommendations: RebalanceRecommendation[] = [];
    const sensorMap = new Map<string, EnvironmentalSensorFeed>();
    sensors.forEach((s) => sensorMap.set(s.zoneId, s));

    // Find viable target indoor/quiet zones with capacity
    const candidateZones = sensors
      .filter((s) => s.occupancyCount < s.maxCapacity && this.calculateZoneComfort(s) >= 75)
      .sort((a, b) => this.calculateZoneComfort(b) - this.calculateZoneComfort(a));

    let totalComfortDelta = 0;

    sessions.forEach((session) => {
      const currentSensor = sensorMap.get(session.currentZoneId);
      if (!currentSensor) return;

      const currentComfort = this.calculateZoneComfort(currentSensor);
      let needsMigration = false;
      let triggerReason: RebalanceRecommendation['triggerReason'] = 'thermal_discomfort';
      let urgency: RebalanceRecommendation['urgency'] = 'moderate';
      let explanation = '';

      // Check sudden precipitation on outdoor terrace
      if (
        currentSensor.zoneType === 'outdoor_terrace' &&
        currentSensor.weatherCondition === 'rain_storm'
      ) {
        needsMigration = true;
        triggerReason = 'sudden_rain_hazard';
        urgency = 'critical';
        explanation =
          'Sudden precipitation detected on the Rooftop Terrace. Migrated to an indoor panoramic sunlit desk.';
      }
      // Check noise spikes (> 72 dB or > 58 in quiet zones)
      else if (
        currentSensor.decibelLevel >= 72 ||
        (session.preferences.preferredNoiseLevel === 'silent' && currentSensor.decibelLevel > 58)
      ) {
        needsMigration = true;
        triggerReason = 'acoustic_noise_spike';
        urgency = 'high';
        explanation = `Acoustic spike of ${currentSensor.decibelLevel} dB detected near your desk. Relocating to acoustic focus zone.`;
      }
      // Check high CO2 lethargy (> 1300 ppm)
      else if (currentSensor.co2Ppm > 1300) {
        needsMigration = true;
        triggerReason = 'high_co2_lethargy';
        urgency = 'moderate';
        explanation = `CO2 levels in ${currentSensor.zoneName} reached ${currentSensor.co2Ppm} ppm (inducing fatigue). Re-balancing to high-airflow zone.`;
      }
      // Check thermal drift
      else if (currentComfort < 50) {
        needsMigration = true;
        triggerReason = 'thermal_discomfort';
        urgency = 'moderate';
        explanation = `Zone comfort dropped to ${currentComfort}%. Rerouting to optimal climate zone.`;
      }

      if (needsMigration && candidateZones.length > 0) {
        const targetZone = candidateZones[0];
        const targetComfort = this.calculateZoneComfort(targetZone);
        const delta = Math.max(10, targetComfort - currentComfort);

        const rec: RebalanceRecommendation = {
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

        recommendations.push(rec);
        totalComfortDelta += delta;

        // Increment target zone occupancy for balancing calculation
        targetZone.occupancyCount += 1;
      }
    });

    const avgComfortImprovement =
      recommendations.length > 0 ? Math.round(totalComfortDelta / recommendations.length) : 0;

    return {
      recommendations,
      displacedCount: recommendations.length,
      avgComfortImprovement,
    };
  }
}
