/**
 * ConsensusResolver.ts
 * Implements the mathematical logic to resolve conflicting agent scores into a final weighted ranking.
 * Uses a weighted average based on user preferences or default egalitarian weights.
 */

import { PersonaType, PERSONA_CONFIGS } from './AgentPersona';
import { DebateResult } from './DebateOrchestrator';

export interface UserPreferences {
    budgetWeight: number;
    focusWeight: number;
    socialWeight: number;
}

export class ConsensusResolver {
    private defaultPreferences: UserPreferences = {
        budgetWeight: 0.33,
        focusWeight: 0.34,
        socialWeight: 0.33,
    };

    public resolveConsensus(
        debateResult: DebateResult,
        userPreferences?: Partial<UserPreferences>
    ): { finalScore: number; consensusStatement: string } {
        const prefs = { ...this.defaultPreferences, ...userPreferences };

        // Normalize weights to ensure they sum to 1.0
        const totalWeight = prefs.budgetWeight + prefs.focusWeight + prefs.socialWeight;
        const normBudget = prefs.budgetWeight / totalWeight;
        const normFocus = prefs.focusWeight / totalWeight;
        const normSocial = prefs.socialWeight / totalWeight;

        const scores = debateResult.finalScores;

        // Calculate weighted final score
        const finalScore = Math.round(
            (scores.BUDGET_CONSCIOUS * normBudget) +
            (scores.FOCUS_ADVOCATE * normFocus) +
            (scores.SOCIAL_NETWORKER * normSocial)
        );

        // Generate consensus statement
        const consensusStatement = this.generateConsensusStatement(scores, finalScore, prefs);

        return { finalScore, consensusStatement };
    }

    private generateConsensusStatement(
        scores: Record<PersonaType, number>,
        finalScore: number,
        prefs: UserPreferences
    ): string {
        const highestScoringPersona = Object.entries(scores).reduce((a, b) => a[1] > b[1] ? a : b)[0] as PersonaType;
        const personaName = PERSONA_CONFIGS[highestScoringPersona].name;

        if (finalScore >= 80) {
            return `Strong Consensus: The agents agree this is an excellent venue. ${personaName} was particularly impressed, aligning well with your preferences.`;
        } else if (finalScore >= 60) {
            return `Moderate Consensus: The venue is viable but has trade-offs. ${personaName} found it most appealing, though others noted minor drawbacks.`;
        } else {
            return `Weak Consensus: The agents disagree significantly or find major flaws. ${personaName} was the most optimistic, but overall the venue may not meet your core needs.`;
        }
    }
}
