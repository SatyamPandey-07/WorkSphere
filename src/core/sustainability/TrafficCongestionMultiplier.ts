/**
 * TrafficCongestionMultiplier.ts
 * Ingests real-time traffic API data to apply idle-time and stop-and-go emission penalties to the commute score.
 */

export interface TrafficCondition {
    segmentIndex: number;
    congestionLevel: 'free-flow' | 'moderate' | 'heavy' | 'standstill';
    idleTimeSeconds: number;
    averageSpeedKmh: number;
}

export interface CongestionAdjustment {
    segmentIndex: number;
    additionalCO2Grams: number;
    reason: string;
}

export class TrafficCongestionMultiplier {
    // Grams of CO2 emitted per minute of idling for a standard gasoline car
    private readonly IDLE_EMISSION_RATE_GASOLINE = 2.4;
    private readonly IDLE_EMISSION_RATE_DIESEL = 3.1;
    private readonly IDLE_EMISSION_RATE_EV = 0.1; // Minimal, mostly HVAC

    private readonly CONGESTION_MULTIPLIERS: Record<string, number> = {
        'free-flow': 1.0,
        'moderate': 1.15,
        'heavy': 1.35,
        'standstill': 1.8, // Stop-and-go driving is highly inefficient
    };

    /**
     * Calculates the additional emissions caused by traffic congestion.
     * @param baseSegments The original route segments
     * @param trafficConditions Real-time traffic data mapped to segments
     * @param vehicleType 'gasoline' | 'diesel' | 'electric'
     */
    public calculateCongestionPenalty(
        baseSegments: Array<{ distanceMeters: number; durationSeconds: number }>,
        trafficConditions: TrafficCondition[],
        vehicleType: 'gasoline' | 'diesel' | 'electric' = 'gasoline'
    ): CongestionAdjustment[] {
        const adjustments: CongestionAdjustment[] = [];

        let idleRate = this.IDLE_EMISSION_RATE_GASOLINE;
        if (vehicleType === 'diesel') idleRate = this.IDLE_EMISSION_RATE_DIESEL;
        if (vehicleType === 'electric') idleRate = this.IDLE_EMISSION_RATE_EV;

        for (const condition of trafficConditions) {
            if (condition.segmentIndex < 0 || condition.segmentIndex >= baseSegments.length) {
                continue;
            }

            let additionalCO2 = 0;
            let reason = '';

            // 1. Idle time penalty
            if (condition.idleTimeSeconds > 0) {
                const idleMinutes = condition.idleTimeSeconds / 60;
                const idleCO2 = idleMinutes * idleRate;
                additionalCO2 += idleCO2;
                reason += `Idling for ${Math.round(condition.idleTimeSeconds)}s (+${idleCO2.toFixed(1)}g). `;
            }

            // 2. Stop-and-go multiplier
            const multiplier = this.CONGESTION_MULTIPLIERS[condition.congestionLevel] || 1.0;
            if (multiplier > 1.0) {
                // Estimate base emissions for this segment roughly (using 192g/km as baseline)
                const distanceKm = baseSegments[condition.segmentIndex].distanceMeters / 1000;
                const baseSegmentCO2 = distanceKm * 192;
                const congestionPenalty = baseSegmentCO2 * (multiplier - 1.0);

                additionalCO2 += congestionPenalty;
                reason += `${condition.congestionLevel} traffic (+${congestionPenalty.toFixed(1)}g).`;
            }

            if (additionalCO2 > 0) {
                adjustments.push({
                    segmentIndex: condition.segmentIndex,
                    additionalCO2Grams: parseFloat(additionalCO2.toFixed(2)),
                    reason: reason.trim(),
                });
            }
        }

        return adjustments;
    }

    /**
     * Fetches mock traffic data for a route. In production, this would call TomTom, Google Maps, or OSRM traffic tiles.
     */
    public async fetchTrafficConditions(routePolyline: string): Promise<TrafficCondition[]> {
        // Simulate API latency
        await new Promise(resolve => setTimeout(resolve, 200));

        // Mock data: assume 3 segments
        return [
            {
                segmentIndex: 0,
                congestionLevel: 'free-flow',
                idleTimeSeconds: 0,
                averageSpeedKmh: 60,
            },
            {
                segmentIndex: 1,
                congestionLevel: 'heavy',
                idleTimeSeconds: 45,
                averageSpeedKmh: 15,
            },
            {
                segmentIndex: 2,
                congestionLevel: 'moderate',
                idleTimeSeconds: 10,
                averageSpeedKmh: 35,
            },
        ];
    }
}
