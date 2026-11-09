/**
 * OSMAccessibilityParser.ts
 * Parses OpenStreetMap Overpass API responses to extract specific accessibility tags 
 * such as ramps, elevators, and tactile paving.
 */

export interface AccessibilityFeatures {
    hasElevator: boolean;
    hasRamp: boolean;
    hasTactilePaving: boolean;
    isWheelchairAccessible: boolean;
    accessibleEntrance: boolean;
    rawTags: Record<string, string>;
}

export class OSMAccessibilityParser {
    /**
     * Extracts accessibility features from OSM element tags.
     */
    public parseFeatures(tags: Record<string, string>): AccessibilityFeatures {
        const wheelchair = tags['wheelchair']?.toLowerCase();
        const entrance = tags['entrance']?.toLowerCase();

        return {
            hasElevator: tags['highway'] === 'elevator' || tags['amenity'] === 'elevator' || tags['wheelchair:place'] === 'elevator',
            hasRamp: tags['kerb']?.toLowerCase() === 'lowered' || tags['footway']?.toLowerCase() === 'ramp' || tags['incline']?.toLowerCase() === 'up' || tags['incline']?.toLowerCase() === 'down',
            hasTactilePaving: tags['tactile_paving']?.toLowerCase() === 'yes',
            isWheelchairAccessible: wheelchair === 'yes' || wheelchair === 'limited',
            accessibleEntrance: entrance === 'yes' && (wheelchair === 'yes' || tags['wheelchair:entrance'] === 'yes'),
            rawTags: tags
        };
    }

    /**
     * Calculates an accessibility score from 0 to 100 based on parsed features.
     */
    public calculateScore(features: AccessibilityFeatures): number {
        let score = 0;
        if (features.isWheelchairAccessible) score += 40;
        if (features.hasElevator) score += 20;
        if (features.hasRamp) score += 20;
        if (features.accessibleEntrance) score += 10;
        if (features.hasTactilePaving) score += 10;

        return Math.min(100, score);
    }
}
