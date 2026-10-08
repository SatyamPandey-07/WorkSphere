/**
 * TechnicalGlossary.ts
 * A strict dictionary and rule engine to force exact translations of remote-work terminology.
 * Prevents standard i18n from mistranslating domain-specific terms.
 */

export interface GlossaryEntry {
    term: string;
    translations: Record<string, string>; // targetLanguageCode -> translatedTerm
    context: string;
}

export class TechnicalGlossary {
    private dictionary: Map<string, GlossaryEntry>;

    constructor() {
        this.dictionary = new Map();
        this.initializeDefaultGlossary();
    }

    private initializeDefaultGlossary(): void {
        const entries: GlossaryEntry[] = [
            {
                term: 'power outlet',
                translations: { es: 'enchufe eléctrico', fr: 'prise électrique', de: 'Steckdose' },
                context: 'Physical electrical socket for charging devices.'
            },
            {
                term: 'WiFi speed',
                translations: { es: 'velocidad del WiFi', fr: 'vitesse du WiFi', de: 'WLAN-Geschwindigkeit' },
                context: 'Network bandwidth performance.'
            },
            {
                term: 'noise level',
                translations: { es: 'nivel de ruido', fr: 'niveau sonore', de: 'Geräuschpegel' },
                context: 'Ambient decibel measurement.'
            },
            {
                term: 'coworking space',
                translations: { es: 'espacio de coworking', fr: 'espace de coworking', de: 'Coworking-Space' },
                context: 'Shared professional workspace.'
            },
            {
                term: 'ergonomic chair',
                translations: { es: 'silla ergonómica', fr: 'chaise ergonomique', de: 'ergonomischer Stuhl' },
                context: 'Workplace furniture designed for comfort.'
            }
        ];

        for (const entry of entries) {
            this.dictionary.set(entry.term.toLowerCase(), entry);
        }
    }

    public getTranslation(term: string, targetLang: string): string | null {
        const entry = this.dictionary.get(term.toLowerCase());
        if (!entry) return null;
        return entry.translations[targetLang] || null;
    }

    public getAllTerms(): string[] {
        return Array.from(this.dictionary.keys());
    }

    public addCustomEntry(entry: GlossaryEntry): void {
        this.dictionary.set(entry.term.toLowerCase(), entry);
    }
}
