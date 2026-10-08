/**
 * AccessibleRouter.ts
 * Modifies standard OSRM graph weights to heavily penalize non-accessible routes based on elevation and OSM tags.
 */

import { ElevationMatrix, ElevationProfile } from './ElevationMatrix';
import { OSMAccessibilityParser, AccessibilityFeatures } from './OSMAccessibilityParser';

export interface RouteSegment {
    distance: number;
    duration: number;
    elevationGain: number;
    osmTags: Record<string, string>;
}

export interface AccessibilityWeightedRoute {
    totalDistance: number;
    totalDuration: number;
    accessibilityScore: number;
    penaltyMultiplier: number;
    isRecommended: boolean;
    segments: RouteSegment[];
}

export class AccessibleRouter {
    private elevationMatrix: ElevationMatrix;
    private osmParser: OSMAccessibilityParser;

    constructor() {
        this.elevationMatrix = new ElevationMatrix();
        this.osmParser = new OSMAccessibilityParser();
    }

    /**
     * Evaluates a route and applies accessibility penalties to its duration/weight.
     * @param segments Route segments from OSRM.
     * @param wheelchairMode If true, strictly penalizes non-compliant segments.
     */
    public evaluateRoute(segments: RouteSegment[], wheelchairMode: boolean = true): AccessibilityWeightedRoute {
        let totalDistance = 0;
        let totalDuration = 0;
        let totalElevationGain = 0;
        let totalPenaltyMultiplier = 1.0;
        let minSegmentScore = 100;

        const evaluatedSegments: RouteSegment[] = [];

        for (const segment of segments) {
            totalDistance += segment.distance;
            totalDuration += segment.duration;
            totalElevationGain += segment.elevationGain;

            const features = this.osmParser.parseFeatures(segment.osmTags);
            const segmentScore = this.osmParser.calculateScore(features);

            if (segmentScore < minSegmentScore) {
                minSegmentScore = segmentScore;
            }

            // Calculate penalty based on features and elevation
            let segmentMultiplier = 1.0;

            if (wheelchairMode) {
                if (!features.isWheelchairAccessible && !features.hasRamp) {
                    segmentMultiplier += 2.0; // Heavy penalty for missing ramps/accessibility
                }

                // Simulate elevation check (in real impl, this uses DEM data per segment)
                const simulatedGrade = this.elevationMatrix.calculateGrade(segment.elevationGain, segment.distance);
                if (simulatedGrade > 8.33) {
                    segmentMultiplier += (simulatedGrade - 8.33) / 5; // Progressive penalty for steepness
                }
            }

            totalPenaltyMultiplier = Math.max(totalPenaltyMultiplier, segmentMultiplier);
            evaluatedSegments.push(segment);
        }

        const adjustedDuration = totalDuration * totalPenaltyMultiplier;
        const isRecommended = minSegmentScore >= 60 && totalPenaltyMultiplier < 1.5;

        return {
            totalDistance,
            totalDuration: adjustedDuration,
            accessibilityScore: minSegmentScore,
            penaltyMultiplier: totalPenaltyMultiplier,
            isRecommended,
            segments: evaluatedSegments
        };
    }
}
