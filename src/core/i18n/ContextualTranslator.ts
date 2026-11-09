/**
 * ContextualTranslator.ts
 * Manages the Groq API calls, enforcing technical context preservation during translation 
 * by injecting the TechnicalGlossary constraints into the system prompt.
 */

import { TechnicalGlossary } from './TechnicalGlossary';

export interface TranslationRequest {
    text: string;
    sourceLang: string;
    targetLang: string;
    domain: 'workspace' | 'general';
}

export interface TranslationResponse {
    originalText: string;
    translatedText: string;
    targetLang: string;
    glossaryMatches: string[];
}

export class ContextualTranslator {
    private glossary: TechnicalGlossary;
    private apiKey: string;

    constructor(apiKey: string) {
        this.glossary = new TechnicalGlossary();
        this.apiKey = apiKey;
    }

    public async translate(request: TranslationRequest): Promise<TranslationResponse> {
        const { text, sourceLang, targetLang, domain } = request;
        const glossaryMatches: string[] = [];

        // Build glossary injection for the prompt
        let glossaryPrompt = '';
        if (domain === 'workspace') {
            const terms = this.glossary.getAllTerms();
            const relevantTranslations: string[] = [];

            for (const term of terms) {
                const translation = this.glossary.getTranslation(term, targetLang);
                if (translation && text.toLowerCase().includes(term)) {
                    relevantTranslations.push(`- "${term}" MUST be translated as "${translation}"`);
                    glossaryMatches.push(term);
                }
            }

            if (relevantTranslations.length > 0) {
                glossaryPrompt = `\n\nSTRICT GLOSSARY RULES:\nYou must use the following exact translations for technical terms:\n${relevantTranslations.join('\n')}\nDo not deviate from these terms.`;
            }
        }

        const systemPrompt = `You are a professional translator specializing in remote work and coworking environments. 
Translate the following text from ${sourceLang} to ${targetLang}. 
Maintain the original tone and formatting.${glossaryPrompt}`;

        try {
            // Mock Groq API call structure (replace with actual Groq SDK call in production)
            // const response = await groq.chat.completions.create({
            //   model: 'llama3-70b-8192',
            //   messages: [
            //     { role: 'system', content: systemPrompt },
            //     { role: 'user', content: text }
            //   ],
            //   temperature: 0.1 // Low temperature for deterministic translation
            // });
            // const translatedText = response.choices[0].message.content;

            // Simulated translation for demonstration
            const translatedText = `[TRANSLATED TO ${targetLang.toUpperCase()}]: ${text}`;

            return {
                originalText: text,
                translatedText,
                targetLang,
                glossaryMatches
            };
        } catch (error) {
            console.error('Translation API error:', error);
            throw new Error('Failed to translate text');
        }
    }
}
