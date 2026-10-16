/**
 * @file CulturalPrompter.ts
 * @description Formats the user's origin country and current venue location into 
 * structured Groq prompts to generate context-aware, polite etiquette reminders.
 */

import { Groq } from 'groq-sdk';
import { CulturalNorm } from '../culture/EtiquetteGraph';

export interface PromptContext {
    userOriginCountry: string;
    currentCountry: string;
    venueType: string;
    applicableNorms: CulturalNorm[];
    userLanguage: string;
}

export interface EtiquetteReminder {
    title: string;
    message: string;
    severity: 'info' | 'warning' | 'critical';
    category: string;
}

export class CulturalPrompter {
    private groq: Groq;
    private readonly model = 'llama3-70b-8192';

    constructor(apiKey: string) {
        this.groq = new Groq({ apiKey });
    }

    public async generateReminders(context: PromptContext): Promise<EtiquetteReminder[]> {
        if (context.applicableNorms.length === 0) return [];
        if (context.userOriginCountry === context.currentCountry) return []; // No cross-cultural friction

        const prompt = this.buildPrompt(context);

        try {
            const response = await this.groq.chat.completions.create({
                messages: [
                    {
                        role: 'system',
                        content: `You are a polite, culturally aware assistant helping a digital nomad avoid social faux pas. Generate brief, respectful reminders in ${context.userLanguage}. Return a JSON array.`
                    },
                    { role: 'user', content: prompt },
                ],
                model: this.model,
                temperature: 0.3,
                max_tokens: 512,
                response_format: { type: 'json_object' },
            });

            const content = response.choices[0].message.content;
            if (!content) return this.fallbackReminders(context);

            const parsed = JSON.parse(content);
            return parsed.reminders || this.fallbackReminders(context);
        } catch (error) {
            console.error('Cultural prompt generation failed:', error);
            return this.fallbackReminders(context);
        }
    }

    private buildPrompt(context: PromptContext): string {
        const normsText = context.applicableNorms.map(n =>
            `- [${n.severity.toUpperCase()}] ${n.category}: ${n.title} - ${n.description}`
        ).join('\n');

        return `
      User from: ${context.userOriginCountry}
      Currently in: ${context.currentCountry}
      Venue type: ${context.venueType}
      
      Local norms to highlight:
      ${normsText}
      
      Generate 1 to 3 brief, polite reminders to help the user adapt. 
      Focus on the most critical or surprising differences for someone from ${context.userOriginCountry}.
      
      Return JSON: { "reminders": [ { "title": string, "message": string, "severity": string, "category": string } ] }
    `;
    }

    private fallbackReminders(context: PromptContext): EtiquetteReminder[] {
        return context.applicableNorms.slice(0, 3).map(norm => ({
            title: norm.title,
            message: norm.description,
            severity: norm.severity,
            category: norm.category,
        }));
    }
}
