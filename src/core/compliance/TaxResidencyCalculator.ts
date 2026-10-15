/**
 * TaxResidencyCalculator.ts
 * Evaluates rolling 183-day and 12-month physical presence rules against a database 
 * of international tax treaties.
 */

export interface LocationStay {
    country: string;
    entryDate: string; // ISO 8601
    exitDate?: string; // ISO 8601, undefined if currently in country
}

export interface TaxResidencyResult {
    country: string;
    isResident: boolean;
    daysPresent: number;
    threshold: number;
    ruleTriggered: string;
    warningLevel: 'safe' | 'approaching' | 'breached';
}

export interface TaxTreatyOverride {
    countryA: string;
    countryB: string;
    tieBreakerRule: 'permanent-home' | 'center-of-vital-interests' | 'habitual-abode' | 'nationality';
}

export class TaxResidencyCalculator {
    private stays: LocationStay[] = [];
    private treatyOverrides: TaxTreatyOverride[] = [];

    // Standard 183-day rule threshold
    private readonly STANDARD_THRESHOLD = 183;

    constructor(stays: LocationStay[] = [], treaties: TaxTreatyOverride[] = []) {
        this.stays = stays;
        this.treatyOverrides = treaties;
    }

    public addStay(stay: LocationStay): void {
        this.stays.push(stay);
        this.sortStays();
    }

    public clearStays(): void {
        this.stays = [];
    }

    private sortStays(): void {
        this.stays.sort((a, b) => new Date(a.entryDate).getTime() - new Date(b.entryDate).getTime());
    }

    /**
     * Calculates days present in a specific country within a given tax year.
     * Supports the US Substantial Presence Test weighting (current year = 1, prev year = 1/3, 2 yrs ago = 1/6).
     */
    public calculateDaysPresent(country: string, targetDate: Date, useWeighting: boolean = false): number {
        let totalDays = 0;
        const targetYear = targetDate.getFullYear();

        for (const stay of this.stays) {
            if (stay.country !== country) continue;

            const entry = new Date(stay.entryDate);
            const exit = stay.exitDate ? new Date(stay.exitDate) : new Date();

            for (let year = targetYear - 2; year <= targetYear; year++) {
                const yearStart = new Date(year, 0, 1);
                const yearEnd = new Date(year, 11, 31);

                const overlapStart = entry > yearStart ? entry : yearStart;
                const overlapEnd = exit < yearEnd ? exit : yearEnd;

                if (overlapStart <= overlapEnd && overlapEnd.getFullYear() === year) {
                    let daysInYear = Math.floor((overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;

                    if (useWeighting) {
                        if (year === targetYear) totalDays += daysInYear;
                        else if (year === targetYear - 1) totalDays += daysInYear / 3;
                        else if (year === targetYear - 2) totalDays += daysInYear / 6;
                    } else {
                        if (year === targetYear) totalDays += daysInYear;
                    }
                }
            }
        }

        return Math.floor(totalDays);
    }

    /**
     * Evaluates tax residency status for all countries visited in the current year.
     */
    public evaluateResidency(targetDate: Date = new Date()): TaxResidencyResult[] {
        const results: TaxResidencyResult[] = [];
        const visitedCountries = new Set(this.stays.map(s => s.country));

        for (const country of visitedCountries) {
            const days = this.calculateDaysPresent(country, targetDate, false);
            const threshold = this.getThresholdForCountry(country);

            let warningLevel: 'safe' | 'approaching' | 'breached' = 'safe';
            if (days >= threshold) warningLevel = 'breached';
            else if (days >= threshold * 0.8) warningLevel = 'approaching';

            results.push({
                country,
                isResident: days >= threshold,
                daysPresent: days,
                threshold,
                ruleTriggered: days >= threshold ? '183-Day Rule' : 'None',
                warningLevel,
            });
        }

        return results;
    }

    private getThresholdForCountry(country: string): number {
        // In a real app, this would query a database of country-specific rules
        // e.g., UK has the Statutory Residence Test, US has Substantial Presence
        const customThresholds: Record<string, number> = {
            'UK': 183,
            'US': 183, // Simplified for this engine
            'DE': 183,
            'TH': 180, // Thailand tax residency rule
            'PT': 183,
        };
        return customThresholds[country] || this.STANDARD_THRESHOLD;
    }

    /**
     * Applies tax treaty tie-breaker rules if dual residency is detected.
     */
    public applyTreatyTieBreaker(countryA: string, countryB: string): string | null {
        const treaty = this.treatyOverrides.find(
            t => (t.countryA === countryA && t.countryB === countryB) ||
                (t.countryA === countryB && t.countryB === countryA)
        );

        if (!treaty) return null;

        // In a real implementation, this would evaluate user data against the tie-breaker rule
        // For now, we just return the rule that needs to be evaluated
        return treaty.tieBreakerRule;
    }

    public getUpcomingBreaches(daysLookahead: number = 30): TaxResidencyResult[] {
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + daysLookahead);

        const futureResults = this.evaluateResidency(futureDate);
        return futureResults.filter(r => r.warningLevel === 'approaching' || r.warningLevel === 'breached');
    }
}
