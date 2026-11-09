/**
 * NetworkingGraphMatcher.ts
 * Evaluates the user's professional profile against the event's knowledge graph 
 * to calculate a "Networking ROI" score and suggest high-value connections.
 */

import { StructuredEvent } from './LocalEventScraper';

export interface UserProfile {
    userId: string;
    skills: string[];
    interests: string[];
    industry: string;
    currentLat: number;
    currentLng: number;
}

export interface MatchResult {
    eventId: string;
    eventTitle: string;
    roiScore: number; // 0 to 100
    distanceKm: number;
    matchedTags: string[];
    recommendation: string;
}

export class NetworkingGraphMatcher {
    private readonly MAX_DISTANCE_KM = 50;
    private readonly EARTH_RADIUS_KM = 6371;

    constructor() { }

    /**
     * Evaluates a list of local events against a user profile to generate ranked recommendations.
     */
    public matchEvents(user: UserProfile, events: StructuredEvent[]): MatchResult[] {
        const results: MatchResult[] = [];

        for (const event of events) {
            const distance = this.calculateHaversineDistance(
                user.currentLat, user.currentLng,
                event.venueLat, event.venueLng
            );

            if (distance > this.MAX_DISTANCE_KM) continue;

            const roiScore = this.calculateRoiScore(user, event, distance);

            if (roiScore > 20) { // Minimum threshold for recommendation
                results.push({
                    eventId: event.externalId,
                    eventTitle: event.title,
                    roiScore,
                    distanceKm: Math.round(distance * 10) / 10,
                    matchedTags: this.findIntersectingTags(user, event),
                    recommendation: this.generateRecommendation(roiScore, event)
                });
            }
        }

        return results.sort((a, b) => b.roiScore - a.roiScore);
    }

    /**
     * Calculates the Networking ROI (Return on Investment) score.
     * Factors in tag overlap, distance penalty, and attendee density.
     */
    private calculateRoiScore(user: UserProfile, event: StructuredEvent, distance: number): number {
        let score = 0;

        // Tag Overlap (Max 50 points)
        const intersectingTags = this.findIntersectingTags(user, event);
        score += Math.min(intersectingTags.length * 15, 50);

        // Distance Penalty (Max 30 points deduction)
        const distancePenalty = (distance / this.MAX_DISTANCE_KM) * 30;
        score -= distancePenalty;

        // Attendee Density Bonus (Max 20 points)
        if (event.attendeeCount > 50) score += 10;
        if (event.attendeeCount > 200) score += 10;

        // Industry Match Bonus (Max 20 points)
        if (event.description.toLowerCase().includes(user.industry.toLowerCase())) {
            score += 20;
        }

        return Math.max(0, Math.min(100, Math.round(score)));
    }

    private findIntersectingTags(user: UserProfile, event: StructuredEvent): string[] {
        const userTags = [...user.skills, ...user.interests].map(t => t.toLowerCase());
        return event.tags.filter(et => userTags.includes(et.toLowerCase()));
    }

    private calculateHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
        if (lat1 === 0 || lon1 === 0 || lat2 === 0 || lon2 === 0) return 0; // Fallback for missing coords

        const dLat = this.deg2rad(lat2 - lat1);
        const dLon = this.deg2rad(lon2 - lon1);
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return this.EARTH_RADIUS_KM * c;
    }

    private deg2rad(deg: number): number {
        return deg * (Math.PI / 180);
    }

    private generateRecommendation(score: number, event: StructuredEvent): string {
        if (score >= 80) {
            return `Highly Recommended: "${event.title}" aligns perfectly with your professional graph.`;
        } else if (score >= 50) {
            return `Good Match: "${event.title}" offers solid networking opportunities in your field.`;
        } else {
            return `Casual Interest: "${event.title}" might be worth attending if you have free time.`;
        }
    }
}
