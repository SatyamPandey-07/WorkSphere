/**
 * ContractRedlineEngine.ts
 * Formats extracted clauses into structured Groq prompts designed to identify 
 * legal risks and generate alternative, fair-market phrasing.
 */

export interface LegalClause {
    id: string;
    sectionTitle: string;
    originalText: string;
    category: 'IP_ASSIGNMENT' | 'NON_COMPETE' | 'INDEMNIFICATION' | 'TERMINATION' | 'LIABILITY' | 'OTHER';
    riskLevel: 'low' | 'medium' | 'high';
}

export interface RedlineSuggestion {
    clauseId: string;
    originalText: string;
    suggestedText: string;
    reasoning: string;
    riskMitigated: boolean;
}

export class ContractRedlineEngine {
    private readonly GROQ_SYSTEM_PROMPT = `You are an expert legal assistant specializing in freelance contracts and NDAs. 
Your goal is to protect the freelancer/nomad. Identify predatory clauses (e.g., infinite IP assignment, broad non-competes, 
unlimited indemnification) and rewrite them to be fair, standard, and balanced. 
Return your response strictly in JSON format with fields: "reasoning", "suggestedText", and "riskMitigated" (boolean).`;

    constructor() { }

    /**
     * Constructs the prompt payload for the Groq LLM to analyze a specific clause.
     */
    public buildAnalysisPrompt(clause: LegalClause): string {
        return `${this.GROQ_SYSTEM_PROMPT}

Analyze the following clause from a freelance agreement:

Section: ${clause.sectionTitle}
Category: ${clause.category}
Original Text: """${clause.originalText}"""

Provide your JSON response:`;
    }

    /**
     * Parses the LLM's JSON response into a structured RedlineSuggestion object.
     */
    public parseLLMResponse(clauseId: string, originalText: string, llmResponse: string): RedlineSuggestion {
        try {
            // Clean up potential markdown formatting from LLM
            const cleanJson = llmResponse.replace(/```json/g, '').replace(/```/g, '').trim();
            const parsed = JSON.parse(cleanJson);

            return {
                clauseId,
                originalText,
                suggestedText: parsed.suggestedText || originalText,
                reasoning: parsed.reasoning || 'No reasoning provided.',
                riskMitigated: parsed.riskMitigated === true
            };
        } catch (error) {
            console.error(`[RedlineEngine] Failed to parse LLM response for clause ${clauseId}`, error);
            return {
                clauseId,
                originalText,
                suggestedText: originalText,
                reasoning: 'Failed to parse AI response. Manual review required.',
                riskMitigated: false
            };
        }
    }

    /**
     * Assigns a preliminary risk level based on keyword heuristics before LLM analysis.
     */
    public calculateHeuristicRisk(clause: LegalClause): 'low' | 'medium' | 'high' {
        const text = clause.originalText.toLowerCase();

        const highRiskKeywords = ['in perpetuity', 'universe', 'irrevocable', 'unlimited', 'all future works', 'non-compete'];
        const mediumRiskKeywords = ['indemnify', 'hold harmless', 'sole discretion', 'without notice'];

        if (highRiskKeywords.some(kw => text.includes(kw))) return 'high';
        if (mediumRiskKeywords.some(kw => text.includes(kw))) return 'medium';

        return 'low';
    }
}
