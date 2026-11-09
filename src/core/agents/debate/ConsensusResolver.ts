/**
 * ConsensusResolver.ts
 * Implements the mathematical logic to resolve conflicting agent scores into a final weighted ranking.
 * Uses a weighted average based on user preferences or default egalitarian weights.
 * Integrates factual concessions parsed during adversarial cross-examination (#5775).
 */

import { PersonaType, PERSONA_CONFIGS } from './AgentPersona';
import { DebateResult } from './DebateOrchestrator';

export interface UserPreferences {
    budgetWeight: number;
    focusWeight: number;
    socialWeight: number;
}

export interface ConsensusResult {
    finalScore: number;
    consensusStatement: string;
    isTied?: boolean;
    dominantPersona?: PersonaType;
    tiedPersonas?: PersonaType[];
    crossExaminationConcessions?: number;
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
    ): ConsensusResult {
        const prefs = { ...this.defaultPreferences, ...userPreferences };

        // Normalize weights safely, guarding against 0, negative, or NaN values
        const rawBudget = Number.isFinite(prefs.budgetWeight) && prefs.budgetWeight >= 0 ? prefs.budgetWeight : 0.33;
        const rawFocus = Number.isFinite(prefs.focusWeight) && prefs.focusWeight >= 0 ? prefs.focusWeight : 0.34;
        const rawSocial = Number.isFinite(prefs.socialWeight) && prefs.socialWeight >= 0 ? prefs.socialWeight : 0.33;

        const totalWeight = rawBudget + rawFocus + rawSocial;
        const normBudget = totalWeight > 0 ? rawBudget / totalWeight : 1 / 3;
        const normFocus = totalWeight > 0 ? rawFocus / totalWeight : 1 / 3;
        const normSocial = totalWeight > 0 ? rawSocial / totalWeight : 1 / 3;

        const normWeights: Record<PersonaType, number> = {
            BUDGET_CONSCIOUS: normBudget,
            FOCUS_ADVOCATE: normFocus,
            SOCIAL_NETWORKER: normSocial,
        };

        const scores = debateResult.finalScores;

        // Calculate weighted final score with bounds clamping
        const rawScore =
            ((scores.BUDGET_CONSCIOUS ?? 50) * normBudget) +
            ((scores.FOCUS_ADVOCATE ?? 50) * normFocus) +
            ((scores.SOCIAL_NETWORKER ?? 50) * normSocial);

        const finalScore = Math.max(0, Math.min(100, Math.round(Number.isFinite(rawScore) ? rawScore : 50)));

        // Resolve ties and deadlocks
        const { dominantPersona, isTied, tiedPersonas } = this.resolveTieBreak(scores, normWeights);

        // Generate consensus statement incorporating tie resolution
        let consensusStatement = this.generateConsensusStatement(
            scores,
            finalScore,
            normWeights,
            dominantPersona,
            isTied,
            tiedPersonas
        );

        // Incorporate factual cross-examination concessions into consensus summary (#5775)
        const concededList = debateResult.crossExaminations?.filter(ce => ce.isConceded) ?? [];
        if (concededList.length > 0) {
            const details = concededList
                .map(c => `${PERSONA_CONFIGS[c.respondent].name} conceded regarding "${c.claim}" (-${c.scorePenalty} pts)`)
                .join('; ');
            consensusStatement += ` Factual cross-examination adjustment: ${details}.`;
        }

        return {
            finalScore,
            consensusStatement,
            isTied,
            dominantPersona,
            tiedPersonas,
            crossExaminationConcessions: concededList.length,
        };
    }

    /**
     * Resolves tied persona scores deterministically using user preference weights as tie-breakers.
     */
    public resolveTieBreak(
        scores: Record<PersonaType, number>,
        normWeights: Record<PersonaType, number>
    ): { dominantPersona: PersonaType; isTied: boolean; tiedPersonas: PersonaType[] } {
        const entries = Object.entries(scores) as [PersonaType, number][];
        const maxScore = Math.max(...entries.map(([, s]) => s));
        const topPersonas = entries.filter(([, s]) => Math.abs(s - maxScore) < 1e-6).map(([p]) => p);
        const isTied = topPersonas.length > 1;

        if (!isTied) {
            return {
                dominantPersona: topPersonas[0],
                isTied: false,
                tiedPersonas: topPersonas,
            };
        }

        // Rank tied personas by user preference weight
        const sortedTied = [...topPersonas].sort((a, b) => normWeights[b] - normWeights[a]);
        const dominantPersona = sortedTied[0];

        // Check if top 2 weights are identical (true deadlock)
        const topWeights = sortedTied.map(p => normWeights[p]);
        const isExactWeightTie = topWeights.length > 1 && Math.abs(topWeights[0] - topWeights[1]) < 1e-6;

        if (!isExactWeightTie) {
            return {
                dominantPersona,
                isTied: true,
                tiedPersonas: topPersonas,
            };
        }

        return {
            dominantPersona,
            isTied: true,
            tiedPersonas: topPersonas,
        };
    }

    private generateConsensusStatement(
        scores: Record<PersonaType, number>,
        finalScore: number,
        normWeights: Record<PersonaType, number>,
        dominantPersona: PersonaType,
        isTied: boolean,
        tiedPersonas: PersonaType[]
    ): string {
        const entries = Object.entries(scores) as [PersonaType, number][];
        const maxScore = Math.max(...entries.map(([, s]) => s));
        const minScore = Math.min(...entries.map(([, s]) => s));
        const isFullTie = maxScore === minScore;

        const dominantName = PERSONA_CONFIGS[dominantPersona].name;

        // Check if top personas have identical preference weights
        const tiedWeights = tiedPersonas.map(p => normWeights[p]);
        const isWeightTied = tiedWeights.length > 1 && Math.max(...tiedWeights) === Math.min(...tiedWeights);

        if (isFullTie) {
            return `Balanced Consensus (Score ${finalScore}/100): All agents reached an identical score of ${maxScore}/100 across budget, focus, and social perspectives, indicating a well-rounded venue with uniform consensus.`;
        }

        if (isTied && isWeightTied) {
            const tiedNames = tiedPersonas.map(p => PERSONA_CONFIGS[p].name).join(' and ');
            return `Joint Consensus (Score ${finalScore}/100): A tie was reached between ${tiedNames} (both ${maxScore}/100). The venue strikes an even balance across both priorities.`;
        }

        if (isTied && !isWeightTied) {
            return `Decisive Consensus (Score ${finalScore}/100): A tie occurred between top personas at ${maxScore}/100, broken in favor of ${dominantName} due to higher user preference weighting.`;
        }

        if (finalScore >= 80) {
            return `Strong Consensus: The agents agree this is an excellent venue. ${dominantName} was particularly impressed, aligning well with your preferences.`;
        } else if (finalScore >= 60) {
            return `Moderate Consensus: The venue is viable but has trade-offs. ${dominantName} found it most appealing, though others noted minor drawbacks.`;
        } else {
            return `Weak Consensus: The agents disagree significantly or find major flaws. ${dominantName} was the most optimistic, but overall the venue may not meet your core needs.`;
        }
    }
}
