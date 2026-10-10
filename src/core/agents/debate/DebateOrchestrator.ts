/**
 * DebateOrchestrator.ts
 * Manages the multi-turn conversation loop and state between the debating AI agents.
 * Coordinates the Groq API calls to simulate a structured debate and collect individual scores.
 */

import { PersonaType, PERSONA_CONFIGS, getPersonaPrompt } from './AgentPersona';

export interface DebateRound {
    roundNumber: number;
    persona: PersonaType;
    argument: string;
    score: number; // 0-100
}

export interface DebateResult {
    rounds: DebateRound[];
    finalScores: Record<PersonaType, number>;
}

export class DebateOrchestrator {
    private maxRounds: number;
    private personas: PersonaType[];

    constructor(maxRounds: number = 2) {
        this.maxRounds = maxRounds;
        this.personas = Object.keys(PERSONA_CONFIGS) as PersonaType[];
    }

    /**
     * Simulates a multi-agent debate for a given venue.
     * In a production environment, this would call the Groq API for each persona.
     */
    public async runDebate(venueData: Record<string, unknown>): Promise<DebateResult> {
        const rounds: DebateRound[] = [];
        const finalScores: Record<PersonaType, number> = {
            BUDGET_CONSCIOUS: 0,
            FOCUS_ADVOCATE: 0,
            SOCIAL_NETWORKER: 0,
        };

        for (let round = 1; round <= this.maxRounds; round++) {
            for (const persona of this.personas) {
                const prompt = getPersonaPrompt(persona, venueData);

                // Mock API call to Groq LLM
                const { argument, score } = await this.mockGroqCall(persona, prompt);

                rounds.push({
                    roundNumber: round,
                    persona,
                    argument,
                    score
                });

                // Accumulate scores for final consensus
                finalScores[persona] += score;
            }
        }

        // Average the scores across rounds
        for (const persona of this.personas) {
            finalScores[persona] = Math.round(finalScores[persona] / this.maxRounds);
        }

        return { rounds, finalScores };
    }

    private async mockGroqCall(persona: PersonaType, prompt: string): Promise<{ argument: string; score: number }> {
        // Simulate network latency
        await new Promise(resolve => setTimeout(resolve, 300));

        const config = PERSONA_CONFIGS[persona];
        let score = 50; // Base score

        // Mock scoring logic based on weights
        if (persona === 'BUDGET_CONSCIOUS') score = 75;
        if (persona === 'FOCUS_ADVOCATE') score = 60;
        if (persona === 'SOCIAL_NETWORKER') score = 85;

        const argument = `As ${config.name}, I evaluate this venue. Based on my priorities, I assign it a score of ${score}/100. The venue shows promise but has room for improvement in specific areas.`;

        return { argument, score };
    }
}
