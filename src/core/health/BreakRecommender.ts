/**
 * BreakRecommender
 * Maps fatigue metrics to specific venue amenities, generating context-aware break suggestions.
 */

export enum FatigueLevel {
    NORMAL = 0,
    MODERATE = 1,
    HIGH = 2,
    CRITICAL = 3
}

export interface VenueAmenity {
    id: string;
    type: 'TERRACE' | 'CAFE' | 'LOUNGE' | 'GYM' | 'MEDITATION_ROOM';
    distanceMeters: number;
    description: string;
}

export interface BreakSuggestion {
    message: string;
    recommendedAmenity?: VenueAmenity;
    durationMinutes: number;
    urgency: 'LOW' | 'MEDIUM' | 'HIGH';
}

export class BreakRecommender {
    private amenities: VenueAmenity[];

    constructor(amenities: VenueAmenity[]) {
        this.amenities = amenities;
    }

    public generateSuggestion(fatigueLevel: FatigueLevel, perclos: number): BreakSuggestion | null {
        if (fatigueLevel === FatigueLevel.NORMAL) return null;

        let message = '';
        let duration = 5;
        let urgency: BreakSuggestion['urgency'] = 'LOW';
        let preferredType: VenueAmenity['type'] | null = null;

        switch (fatigueLevel) {
            case FatigueLevel.MODERATE:
                message = "You've been focusing hard. How about a quick stretch?";
                duration = 5;
                urgency = 'LOW';
                preferredType = 'TERRACE';
                break;
            case FatigueLevel.HIGH:
                message = "Your eye strain is increasing. A caffeine boost or a walk might help.";
                duration = 10;
                urgency = 'MEDIUM';
                preferredType = 'CAFE';
                break;
            case FatigueLevel.CRITICAL:
                message = "High fatigue detected. Please take a significant break to rest your eyes.";
                duration = 20;
                urgency = 'HIGH';
                preferredType = 'LOUNGE';
                break;
        }

        const recommended = this.findBestAmenity(preferredType);

        return {
            message,
            recommendedAmenity: recommended,
            durationMinutes: duration,
            urgency
        };
    }

    private findBestAmenity(type: VenueAmenity['type'] | null): VenueAmenity | undefined {
        if (!type) return this.amenities[0];

        const candidates = this.amenities.filter(a => a.type === type);
        if (candidates.length === 0) return this.amenities[0];

        // Prefer closer amenities
        return candidates.sort((a, b) => a.distanceMeters - b.distanceMeters)[0];
    }
}
