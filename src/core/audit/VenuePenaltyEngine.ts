/**
 * VenuePenaltyEngine.ts
 * Calculates and applies dynamic score deductions to the venue's discovery ranking algorithm based on SLA violations.
 */

import { SLAResult, SLAViolation } from './SLACalculator';

export interface PenaltyResult {
    venueId: string;
    originalRankScore: number;
    penaltyPoints: number;
    finalRankScore: number;
    reason: string;
}

export class VenuePenaltyEngine {
    private readonly HIGH_SEVERITY_PENALTY = 15;
    private readonly MEDIUM_SEVERITY_PENALTY = 8;
    private readonly LOW_SEVERITY_PENALTY = 3;

    /**
     * Applies penalties to a venue's base ranking score based on SLA violations.
     */
    public applyPenalties(venueId: string, originalRankScore: number, slaResult: SLAResult): PenaltyResult {
        let totalPenalty = 0;
        const reasons: string[] = [];

        for (const violation of slaResult.violations) {
            let penalty = 0;
            switch (violation.severity) {
                case 'HIGH':
                    penalty = this.HIGH_SEVERITY_PENALTY;
                    break;
                case 'MEDIUM':
                    penalty = this.MEDIUM_SEVERITY_PENALTY;
                    break;
                case 'LOW':
                    penalty = this.LOW_SEVERITY_PENALTY;
                    break;
            }
            totalPenalty += penalty;
            reasons.push(`${violation.metric} (${violation.severity})`);
        }

        // Compound penalty if multiple violations exist
        if (slaResult.violations.length >= 3) {
            totalPenalty += 10; // Additional "chronic offender" penalty
            reasons.push('Chronic multiple violations');
        }

        const finalScore = Math.max(0, originalRankScore - totalPenalty);

        return {
            venueId,
            originalRankScore,
            penaltyPoints: totalPenalty,
            finalRankScore: finalScore,
            reason: reasons.join('; ')
        };
    }
}
