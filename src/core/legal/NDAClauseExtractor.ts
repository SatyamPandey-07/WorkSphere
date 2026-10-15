/**
 * NDAClauseExtractor.ts
 * Uses regex and NLP heuristics to isolate specific legal sections 
 * (Indemnification, IP, Termination) from unstructured PDF/DOCX text.
 */

import { LegalClause } from './ContractRedlineEngine';

export class NDAClauseExtractor {
    private readonly SECTION_PATTERNS: Record<string, RegExp> = {
        IP_ASSIGNMENT: /(intellectual property|work made for hire|assignment of rights|inventions).*?(\n\n|\r\n\r\n)/gis,
        NON_COMPETE: /(non-competition|non-compete|restrictive covenants|competitor).*?(\n\n|\r\n\r\n)/gis,
        INDEMNIFICATION: /(indemnification|indemnify|hold harmless|liability).*?(\n\n|\r\n\r\n)/gis,
        TERMINATION: /(termination|term and termination|effect of termination).*?(\n\n|\r\n\r\n)/gis,
        LIABILITY: /(limitation of liability|damages|cap on liability).*?(\n\n|\r\n\r\n)/gis
    };

    constructor() { }

    /**
     * Extracts structured clauses from raw document text.
     */
    public extractClauses(rawText: string): LegalClause[] {
        const clauses: LegalClause[] = [];
        const normalizedText = this.normalizeWhitespace(rawText);

        Object.entries(this.SECTION_PATTERNS).forEach(([category, regex]) => {
            let match;
            let index = 0;

            while ((match = regex.exec(normalizedText)) !== null) {
                const sectionTitle = this.extractTitle(match[0]);
                const originalText = match[0].trim();

                if (originalText.length > 20 && originalText.length < 5000) {
                    clauses.push({
                        id: `clause_${category.toLowerCase()}_${index++}`,
                        sectionTitle: sectionTitle || category,
                        originalText,
                        category: category as any,
                        riskLevel: 'medium' // Default, will be updated by Engine
                    });
                }
            }
        });

        // Fallback for documents without clear headers
        if (clauses.length === 0) {
            const paragraphs = normalizedText.split(/\n\s*\n/);
            paragraphs.forEach((p, i) => {
                if (p.length > 100 && this.isLegalText(p)) {
                    clauses.push({
                        id: `clause_unstructured_${i}`,
                        sectionTitle: 'Unstructured Clause',
                        originalText: p.trim(),
                        category: 'OTHER',
                        riskLevel: 'medium'
                    });
                }
            });
        }

        return clauses;
    }

    private normalizeWhitespace(text: string): string {
        return text
            .replace(/\r\n/g, '\n')
            .replace(/\t/g, ' ')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    private extractTitle(text: string): string {
        const lines = text.split('\n');
        if (lines.length > 0) {
            const firstLine = lines[0].trim();
            // If the first line is short and mostly uppercase, it's likely a header
            if (firstLine.length < 100 && firstLine === firstLine.toUpperCase()) {
                return firstLine;
            }
        }
        return '';
    }

    private isLegalText(text: string): boolean {
        const legalKeywords = ['shall', 'hereby', 'agreement', 'parties', 'liability', 'warrant', 'represent'];
        const lowerText = text.toLowerCase();
        const matchCount = legalKeywords.filter(kw => lowerText.includes(kw)).length;
        return matchCount >= 2;
    }
}
