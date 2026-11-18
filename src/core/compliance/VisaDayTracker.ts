/**
 * VisaDayTracker.ts
 * Tracks consecutive and cumulative days in specific Schengen/global zones, 
 * accounting for midnight timezone rollovers.
 */

export interface VisaZone {
    id: string;
    name: string;
    maxDays: number;
    rollingWindowDays: number;
    countries: string[];
}

export interface VisaStatus {
    zoneId: string;
    zoneName: string;
    daysUsed: number;
    daysRemaining: number;
    maxDays: number;
    rollingWindowDays: number;
    expirationDate: string | null; // When the oldest day in the window expires
    isBreached: boolean;
    isApproachingLimit: boolean;
}

export class VisaDayTracker {
    private zones: Map<string, VisaZone> = new Map();
    private entryExitLog: Array<{ country: string; date: string; type: 'entry' | 'exit' }> = [];

    constructor() {
        this.initializeDefaultZones();
    }

    private initializeDefaultZones(): void {
        // Schengen Area
        this.zones.set('schengen', {
            id: 'schengen',
            name: 'Schengen Area',
            maxDays: 90,
            rollingWindowDays: 180,
            countries: ['FR', 'DE', 'IT', 'ES', 'PT', 'NL', 'BE', 'AT', 'GR', 'CH', 'SE', 'NO', 'DK', 'FI', 'PL', 'CZ', 'HU', 'SK', 'SI', 'EE', 'LV', 'LT', 'MT', 'LU', 'LI', 'IS'],
        });

        // UK
        this.zones.set('uk', {
            id: 'uk',
            name: 'United Kingdom',
            maxDays: 180,
            rollingWindowDays: 365,
            countries: ['GB'],
        });

        // Thailand (Tourist Visa Exemption)
        this.zones.set('th-tourist', {
            id: 'th-tourist',
            name: 'Thailand (Tourist Exemption)',
            maxDays: 60,
            rollingWindowDays: 180,
            countries: ['TH'],
        });
    }

    public logMovement(country: string, date: string, type: 'entry' | 'exit'): void {
        this.entryExitLog.push({ country, date, type });
        this.entryExitLog.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    }

    public getZoneForCountry(countryCode: string): VisaZone | undefined {
        for (const zone of this.zones.values()) {
            if (zone.countries.includes(countryCode)) {
                return zone;
            }
        }
        return undefined;
    }

    /**
     * Calculates days spent in a specific zone within its rolling window, 
     * relative to a target date.
     */
    public calculateDaysInZone(zoneId: string, targetDate: Date = new Date()): number {
        const zone = this.zones.get(zoneId);
        if (!zone) return 0;

        const windowStart = new Date(targetDate);
        windowStart.setDate(windowStart.getDate() - zone.rollingWindowDays);

        let days = 0;
        let currentEntry: Date | null = null;

        for (const log of this.entryExitLog) {
            const logDate = new Date(log.date);

            // Ignore logs outside the rolling window
            if (logDate < windowStart || logDate > targetDate) {
                if (logDate > targetDate) break;
                continue;
            }

            if (zone.countries.includes(log.country)) {
                if (log.type === 'entry') {
                    currentEntry = logDate;
                } else if (log.type === 'exit' && currentEntry) {
                    // Calculate days between entry and exit
                    const diffTime = logDate.getTime() - currentEntry.getTime();
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    days += diffDays;
                    currentEntry = null;
                }
            }
        }

        // If currently inside the zone (no exit logged)
        if (currentEntry && currentEntry <= targetDate) {
            const diffTime = targetDate.getTime() - currentEntry.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            days += diffDays;
        }

        return days;
    }

    public evaluateAllZones(targetDate: Date = new Date()): VisaStatus[] {
        const statuses: VisaStatus[] = [];

        for (const zone of this.zones.values()) {
            const daysUsed = this.calculateDaysInZone(zone.id, targetDate);
            const daysRemaining = zone.maxDays - daysUsed;

            // Find when the oldest day in the current window will expire
            const windowStart = new Date(targetDate);
            windowStart.setDate(windowStart.getDate() - zone.rollingWindowDays);

            let expirationDate: string | null = null;
            for (const log of this.entryExitLog) {
                if (log.type === 'entry' && zone.countries.includes(log.country)) {
                    const entryDate = new Date(log.date);
                    if (entryDate >= windowStart && entryDate <= targetDate) {
                        const expiry = new Date(entryDate);
                        expiry.setDate(expiry.getDate() + zone.rollingWindowDays);
                        expirationDate = expiry.toISOString();
                        break;
                    }
                }
            }

            statuses.push({
                zoneId: zone.id,
                zoneName: zone.name,
                daysUsed,
                daysRemaining,
                maxDays: zone.maxDays,
                rollingWindowDays: zone.rollingWindowDays,
                expirationDate,
                isBreached: daysUsed > zone.maxDays,
                isApproachingLimit: daysRemaining <= 10 && daysRemaining > 0,
            });
        }

        return statuses;
    }

    public simulateFutureStay(country: string, entryDate: Date, durationDays: number): VisaStatus[] {
        // Temporarily add the future stay to the log
        const exitDate = new Date(entryDate);
        exitDate.setDate(exitDate.getDate() + durationDays);

        this.logMovement(country, entryDate.toISOString(), 'entry');
        this.logMovement(country, exitDate.toISOString(), 'exit');

        const statuses = this.evaluateAllZones(exitDate);

        // Remove the simulated stay
        this.entryExitLog.pop();
        this.entryExitLog.pop();

        return statuses;
    }
}
