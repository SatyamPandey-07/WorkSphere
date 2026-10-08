/**
 * TimeWindowConstraint.ts
 * Implements the time-window validation to prevent routing to closed venues.
 * Parses opening hours and validates if a proposed arrival time falls within operational bounds.
 */

import { VenueNode } from './ItineraryGraph';

export interface TimeWindow {
    startMinutes: number; // Minutes from midnight
    endMinutes: number;   // Minutes from midnight
    daysOfWeek: number[]; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
}

export class TimeWindowConstraint {
    private parsedWindows: Map<string, TimeWindow[]>;

    constructor() {
        this.parsedWindows = new Map();
    }

    public parseOpeningHours(venueId: string, hoursString: string): void {
        if (hoursString.trim().toUpperCase() === '24/7') {
            this.parsedWindows.set(venueId, [{
                startMinutes: 0,
                endMinutes: 1439,
                daysOfWeek: [0, 1, 2, 3, 4, 5, 6]
            }]);
            return;
        }

        // Simplified parser for "Mo-Fr 08:00-18:00" format
        const windows: TimeWindow[] = [];
        const dayMap: Record<string, number[]> = {
            'Mo': [1], 'Tu': [2], 'We': [3], 'Th': [4], 'Fr': [5], 'Sa': [6], 'Su': [0],
            'Mo-Fr': [1, 2, 3, 4, 5], 'Sa-Su': [6, 0]
        };

        const segments = hoursString.split(',').map(s => s.trim());
        for (const segment of segments) {
            const match = segment.match(/^([A-Za-z\-]+)\s+(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
            if (match) {
                const daysStr = match[1];
                const startH = parseInt(match[2], 10);
                const startM = parseInt(match[3], 10);
                const endH = parseInt(match[4], 10);
                const endM = parseInt(match[5], 10);

                const days = dayMap[daysStr] || [1, 2, 3, 4, 5, 6, 0];
                windows.push({
                    startMinutes: startH * 60 + startM,
                    endMinutes: endH * 60 + endM,
                    daysOfWeek: days
                });
            }
        }
        this.parsedWindows.set(venueId, windows);
    }

    public isVenueOpenAt(venueId: string, date: Date): boolean {
        const windows = this.parsedWindows.get(venueId);
        if (!windows || windows.length === 0) {
            return true; // Default to open if no constraints are defined
        }

        const dayOfWeek = date.getDay();
        const minutesFromMidnight = date.getHours() * 60 + date.getMinutes();

        for (const window of windows) {
            if (window.daysOfWeek.includes(dayOfWeek)) {
                if (minutesFromMidnight >= window.startMinutes && minutesFromMidnight <= window.endMinutes) {
                    return true;
                }
            }
        }
        return false;
    }

    public getNextOpeningTime(venueId: string, fromDate: Date): Date | null {
        const windows = this.parsedWindows.get(venueId);
        if (!windows || windows.length === 0) return null;

        let checkDate = new Date(fromDate);
        for (let i = 0; i < 14; i++) { // Check up to 2 weeks ahead
            const dayOfWeek = checkDate.getDay();
            const relevantWindow = windows.find(w => w.daysOfWeek.includes(dayOfWeek));

            if (relevantWindow) {
                const openTime = new Date(checkDate);
                openTime.setHours(Math.floor(relevantWindow.startMinutes / 60), relevantWindow.startMinutes % 60, 0, 0);
                if (openTime > fromDate) {
                    return openTime;
                }
            }
            checkDate.setDate(checkDate.getDate() + 1);
            checkDate.setHours(0, 0, 0, 0);
        }
        return null;
    }
}