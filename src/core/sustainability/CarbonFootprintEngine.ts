/**
 * CarbonFootprintEngine.ts
 * Calculates precise CO2 emissions by correlating OSRM distance/elevation data 
 * with specific vehicle emission profiles.
 */

export enum TransportMode {
    CAR_GASOLINE = 'CAR_GASOLINE',
    CAR_ELECTRIC = 'CAR_ELECTRIC',
    BUS = 'BUS',
    TRAIN = 'TRAIN',
    BICYCLE = 'BICYCLE',
    WALKING = 'WALKING',
    E_SCOOTER = 'E_SCOOTER',
}

export interface RouteSegment {
    distanceMeters: number;
    elevationGainMeters: number;
    durationSeconds: number;
    averageSpeedKmh: number;
}

export interface EmissionProfile {
    mode: TransportMode;
    baseGramsPerKm: number;
    elevationMultiplier: number; // Extra grams per 100m elevation gain
    speedEfficiencyCurve: (speedKmh: number) => number; // Returns a multiplier (1.0 = optimal)
}

export interface CommuteResult {
    totalDistanceKm: number;
    totalDurationMin: number;
    totalCO2Grams: number;
    segments: RouteSegment[];
    mode: TransportMode;
}

export class CarbonFootprintEngine {
    private profiles: Map<TransportMode, EmissionProfile> = new Map();

    constructor() {
        this.initializeProfiles();
    }

    private initializeProfiles(): void {
        this.profiles.set(TransportMode.CAR_GASOLINE, {
            mode: TransportMode.CAR_GASOLINE,
            baseGramsPerKm: 192, // Average gasoline car
            elevationMultiplier: 15,
            speedEfficiencyCurve: (speed) => {
                // Optimal efficiency around 50-80 km/h
                if (speed < 20) return 1.5; // City traffic
                if (speed > 110) return 1.3; // Highway speeds
                return 1.0;
            },
        });

        this.profiles.set(TransportMode.CAR_ELECTRIC, {
            mode: TransportMode.CAR_ELECTRIC,
            baseGramsPerKm: 50, // Grid-dependent, assuming average mix
            elevationMultiplier: 20, // EVs use more energy on hills, but regen helps on downhills
            speedEfficiencyCurve: (speed) => {
                if (speed > 100) return 1.4; // EVs lose efficiency at high speeds
                return 1.0;
            },
        });

        this.profiles.set(TransportMode.BUS, {
            mode: TransportMode.BUS,
            baseGramsPerKm: 89, // Per passenger assuming average occupancy
            elevationMultiplier: 10,
            speedEfficiencyCurve: () => 1.0,
        });

        this.profiles.set(TransportMode.TRAIN, {
            mode: TransportMode.TRAIN,
            baseGramsPerKm: 41,
            elevationMultiplier: 5,
            speedEfficiencyCurve: () => 1.0,
        });

        this.profiles.set(TransportMode.E_SCOOTER, {
            mode: TransportMode.E_SCOOTER,
            baseGramsPerKm: 35, // Including lifecycle emissions
            elevationMultiplier: 8,
            speedEfficiencyCurve: () => 1.0,
        });

        this.profiles.set(TransportMode.BICYCLE, {
            mode: TransportMode.BICYCLE,
            baseGramsPerKm: 0,
            elevationMultiplier: 0,
            speedEfficiencyCurve: () => 1.0,
        });

        this.profiles.set(TransportMode.WALKING, {
            mode: TransportMode.WALKING,
            baseGramsPerKm: 0,
            elevationMultiplier: 0,
            speedEfficiencyCurve: () => 1.0,
        });
    }

    public calculateEmissions(segments: RouteSegment[], mode: TransportMode): CommuteResult {
        const profile = this.profiles.get(mode);
        if (!profile) {
            throw new Error(`No emission profile found for mode: ${mode}`);
        }

        let totalCO2 = 0;
        let totalDistance = 0;
        let totalDuration = 0;

        for (const segment of segments) {
            const distanceKm = segment.distanceMeters / 1000;
            totalDistance += distanceKm;
            totalDuration += segment.durationSeconds;

            // Base emissions
            let segmentCO2 = distanceKm * profile.baseGramsPerKm;

            // Elevation penalty
            const elevationHundreds = segment.elevationGainMeters / 100;
            segmentCO2 += elevationHundreds * profile.elevationMultiplier;

            // Speed efficiency adjustment
            const speedMultiplier = profile.speedEfficiencyCurve(segment.averageSpeedKmh);
            segmentCO2 *= speedMultiplier;

            totalCO2 += Math.max(0, segmentCO2);
        }

        return {
            totalDistanceKm: parseFloat(totalDistance.toFixed(2)),
            totalDurationMin: parseFloat((totalDuration / 60).toFixed(1)),
            totalCO2Grams: parseFloat(totalCO2.toFixed(2)),
            segments,
            mode,
        };
    }

    public compareModes(segments: RouteSegment[]): Record<TransportMode, CommuteResult> {
        const results: any = {};
        for (const mode of Object.values(TransportMode)) {
            try {
                results[mode] = this.calculateEmissions(segments, mode);
            } catch (e) {
                // Ignore modes without profiles
            }
        }
        return results;
    }
}
