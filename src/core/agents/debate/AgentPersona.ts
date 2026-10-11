/**
 * AgentPersona.ts
 * Defines the system prompts, weighting biases, and evaluation criteria for each specialized AI persona.
 * These personas evaluate venues from distinct perspectives to ensure a well-rounded debate.
 */

export type PersonaType = 'BUDGET_CONSCIOUS' | 'FOCUS_ADVOCATE' | 'SOCIAL_NETWORKER';

export interface PersonaConfig {
    id: PersonaType;
    name: string;
    systemPrompt: string;
    evaluationWeights: {
        price: number;
        noiseLevel: number;
        wifiSpeed: number;
        amenities: number;
        socialVibe: number;
    };
}

export const PERSONA_CONFIGS: Record<PersonaType, PersonaConfig> = {
    BUDGET_CONSCIOUS: {
        id: 'BUDGET_CONSCIOUS',
        name: 'The Budget Conscious',
        systemPrompt: `You are a budget-conscious remote worker. Your primary goal is to find affordable workspaces with good value. 
    Prioritize venues with low hourly rates, free WiFi, and included amenities (like free coffee or power outlets). 
    Be highly critical of overpriced venues that do not offer proportional value.`,
        evaluationWeights: {
            price: 0.50,
            noiseLevel: 0.10,
            wifiSpeed: 0.20,
            amenities: 0.15,
            socialVibe: 0.05,
        }
    },
    FOCUS_ADVOCATE: {
        id: 'FOCUS_ADVOCATE',
        name: 'The Focus Advocate',
        systemPrompt: `You are a deep-work advocate. Your primary goal is to find quiet, distraction-free environments. 
    Prioritize venues with low noise levels, ample seating, and reliable, high-speed WiFi. 
    Be highly critical of loud, crowded, or chaotic environments, regardless of price or social appeal.`,
        evaluationWeights: {
            price: 0.10,
            noiseLevel: 0.50,
            wifiSpeed: 0.25,
            amenities: 0.10,
            socialVibe: 0.05,
        }
    },
    SOCIAL_NETWORKER: {
        id: 'SOCIAL_NETWORKER',
        name: 'The Social Networker',
        systemPrompt: `You are a collaborative remote worker who thrives in vibrant, social environments. 
    Prioritize venues with a good social vibe, community events, and shared tables. 
    Moderate noise is acceptable, and you value venues where networking opportunities are high.`,
        evaluationWeights: {
            price: 0.15,
            noiseLevel: 0.15,
            wifiSpeed: 0.20,
            amenities: 0.20,
            socialVibe: 0.30,
        }
    }
};

export function getPersonaPrompt(personaType: PersonaType, venueData: Record<string, unknown>): string {
    const config = PERSONA_CONFIGS[personaType];
    return `${config.systemPrompt}\n\nEvaluate the following venue data based on your persona's priorities:\n${JSON.stringify(venueData, null, 2)}`;
}
