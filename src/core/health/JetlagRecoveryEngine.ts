/**
 * JetlagRecoveryEngine.ts
 * Calculates the optimal phase-shifting schedule based on the user's origin timezone,
 * destination timezone, and flight duration to minimize circadian misalignment.
 */

export interface FlightItinerary {
    originTimezone: string;
    destinationTimezone: string;
    departureTime: number;
    arrivalTime: number;
    flightDurationHours: number;
}

export interface CircadianSchedule {
    date: string;
    lightExposureBlocks: TimeBlock[];
    caffeineIntakeBlocks: TimeBlock[];
    melatoninBlocks: TimeBlock[];
    sleepWindow: TimeBlock;
    coreBodyTempMin: number;
}

export interface TimeBlock {
    startHour: number;
    endHour: number;
    intensity?: number;
    description: string;
}

export class JetlagRecoveryEngine {
    private originOffset: number;
    private destinationOffset: number;
    private shiftDirection: 'east' | 'west';
    private phaseShiftHours: number;

    constructor(itinerary: FlightItinerary) {
        this.originOffset = this.getTimezoneOffset(itinerary.originTimezone);
        this.destinationOffset = this.getTimezoneOffset(itinerary.destinationTimezone);
        this.phaseShiftHours = Math.abs(this.destinationOffset - this.originOffset);
        this.shiftDirection = this.destinationOffset > this.originOffset ? 'east' : 'west';
    }

    /**
     * Parses the timezone string to calculate the UTC offset in hours.
     * Uses Intl.DateTimeFormat to reliably extract the offset regardless of DST.
     */
    private getTimezoneOffset(tz: string): number {
        try {
            const now = new Date();
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: tz,
                timeZoneName: 'shortOffset'
            });
            const parts = formatter.formatToParts(now);
            const offsetPart = parts.find(part => part.type === 'timeZoneName');
            if (!offsetPart) return 0;

            const match = offsetPart.value.match(/([+-]\d{1,2})(?::(\d{2}))?/);
            if (!match) return 0;

            const hours = parseInt(match[1], 10);
            const minutes = match[2] ? parseInt(match[2], 10) : 0;
            return hours + (minutes / 60) * Math.sign(hours || 1);
        } catch (error) {
            console.error(`[JetlagEngine] Failed to parse timezone: ${tz}`, error);
            return 0;
        }
    }

    /**
     * Generates a multi-day recovery protocol to gradually shift the circadian rhythm.
     * The human body can typically adjust 1-2 hours per day safely.
     */
    public generateRecoveryProtocol(days: number = 3): CircadianSchedule[] {
        const schedules: CircadianSchedule[] = [];
        const maxDailyShift = 2.0; // Maximum safe shift per day in hours
        const dailyShift = Math.min(this.phaseShiftHours / days, maxDailyShift);

        for (let day = 0; day < days; day++) {
            const currentShift = dailyShift * (day + 1);
            const schedule = this.buildDailySchedule(day, currentShift);
            schedules.push(schedule);
        }

        return schedules;
    }

    /**
     * Constructs the specific interventions for a single day of the recovery protocol.
     */
    private buildDailySchedule(dayIndex: number, currentShift: number): CircadianSchedule {
        const baseWakeHour = 7;
        const shiftMultiplier = this.shiftDirection === 'east' ? -1 : 1;
        const adjustedWakeHour = (baseWakeHour + (currentShift * shiftMultiplier) + 24) % 24;

        const sleepDuration = 8;
        const sleepStart = (adjustedWakeHour - sleepDuration + 24) % 24;
        const sleepEnd = adjustedWakeHour;

        // Core body temperature minimum typically occurs 2-3 hours before spontaneous awakening
        const coreBodyTempMin = (adjustedWakeHour - 2.5 + 24) % 24;

        const lightBlocks = this.calculateLightExposure(adjustedWakeHour, dayIndex, coreBodyTempMin);
        const caffeineBlocks = this.calculateCaffeineIntake(adjustedWakeHour, sleepStart);
        const melatoninBlocks = this.calculateMelatoninIntake(sleepStart);

        const date = new Date();
        date.setDate(date.getDate() + dayIndex);

        return {
            date: date.toISOString().split('T')[0],
            lightExposureBlocks: lightBlocks,
            caffeineIntakeBlocks: caffeineBlocks,
            melatoninBlocks: melatoninBlocks,
            sleepWindow: {
                startHour: sleepStart,
                endHour: sleepEnd,
                description: 'Core Sleep Window - Maintain strict dark environment'
            },
            coreBodyTempMin
        };
    }

    /**
     * Calculates light exposure blocks based on the phase response curve (PRC).
     * Eastward travel requires morning light (phase advance).
     * Westward travel requires evening light (phase delay).
     */
    private calculateLightExposure(wakeHour: number, dayIndex: number, cbtMin: number): TimeBlock[] {
        const blocks: TimeBlock[] = [];

        if (this.shiftDirection === 'east') {
            blocks.push({
                startHour: wakeHour,
                endHour: (wakeHour + 3) % 24,
                intensity: 10000,
                description: 'Morning Bright Light Exposure (Phase Advance)'
            });
            blocks.push({
                startHour: (cbtMin - 2 + 24) % 24,
                endHour: cbtMin,
                intensity: 50,
                description: 'Avoid Bright Light before CBT Min (Blue Light Blocking)'
            });
        } else {
            blocks.push({
                startHour: (wakeHour + 8) % 24,
                endHour: (wakeHour + 12) % 24,
                intensity: 10000,
                description: 'Afternoon/Evening Bright Light Exposure (Phase Delay)'
            });
            blocks.push({
                startHour: wakeHour,
                endHour: (wakeHour + 4) % 24,
                intensity: 50,
                description: 'Morning Light Avoidance (Prevent premature phase advance)'
            });
        }

        return blocks;
    }

    /**
     * Calculates safe caffeine intake windows respecting the 10-hour half-life rule.
     */
    private calculateCaffeineIntake(wakeHour: number, sleepStart: number): TimeBlock[] {
        const lastSafeCaffeineHour = (sleepStart - 10 + 24) % 24;
        const blocks: TimeBlock[] = [];

        blocks.push({
            startHour: wakeHour,
            endHour: (wakeHour + 2) % 24,
            description: 'Morning Caffeine Window (Max 200mg)'
        });

        if (this.isHourBetween((wakeHour + 4) % 24, lastSafeCaffeineHour, (wakeHour + 6) % 24)) {
            blocks.push({
                startHour: (wakeHour + 4) % 24,
                endHour: lastSafeCaffeineHour,
                description: 'Early Afternoon Caffeine Window (Max 100mg)'
            });
        }

        return blocks;
    }

    /**
     * Calculates exogenous melatonin supplementation timing.
     */
    private calculateMelatoninIntake(sleepStart: number): TimeBlock[] {
        if (this.shiftDirection === 'east') {
            return [
                {
                    startHour: (sleepStart - 2 + 24) % 24,
                    endHour: (sleepStart - 1.5 + 24) % 24,
                    description: 'Exogenous Melatonin Supplementation (0.5mg - 3mg)'
                }
            ];
        }
        return [];
    }

    private isHourBetween(hour: number, start: number, end: number): boolean {
        if (start <= end) {
            return hour >= start && hour <= end;
        } else {
            return hour >= start || hour <= end;
        }
    }

    public getPhaseShiftSummary(): string {
        return `Total Phase Shift Required: ${this.phaseShiftHours.toFixed(1)} hours ${this.shiftDirection}ward.`;
    }
}
