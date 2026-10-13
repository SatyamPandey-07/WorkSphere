/**
 * TimeWindowConstraint.ts
 * Implements the time-window validation to prevent routing to closed venues.
 * Parses opening hours and validates if a proposed arrival time falls within operational bounds.
 */

import { VenueNode, ItineraryGraph, MobilityMode, DEFAULT_TRANSIT_SPEEDS_KMH } from './ItineraryGraph';

export interface TimeWindow {
    startMinutes: number; // Minutes from midnight
    endMinutes: number;   // Minutes from midnight
    daysOfWeek: number[]; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
}

export interface MeetingSlot {
    venue: VenueNode;
    startTime: Date | string;
    endTime: Date | string;
}

export const DEFAULT_TRANSIT_BUFFER_MIN = 15;
export const MIN_BREAK_DURATION_MINUTES = 0;
export const MAX_BREAK_DURATION_MINUTES = 240;

export interface TransitConstraintOptions {
    customBreakDurationMinutes?: number;
    breakDurationMinutes?: number;
    minBreakDuration?: number;
    segmentBreakDurations?: Record<string, number>;
}

/**
 * Validates that custom break duration is within the acceptable range [0, 240] minutes.
 */
export function validateBreakDuration(duration?: number): number {
    if (duration === undefined || duration === null) {
        return 0;
    }
    if (typeof duration !== 'number' || !Number.isFinite(duration) || isNaN(duration)) {
        throw new Error("Invalid break duration: must be a finite number.");
    }
    if (duration < MIN_BREAK_DURATION_MINUTES || duration > MAX_BREAK_DURATION_MINUTES) {
        throw new Error(
            `customBreakDurationMinutes must be between ${MIN_BREAK_DURATION_MINUTES} and ${MAX_BREAK_DURATION_MINUTES} minutes (received ${duration}).`
        );
    }
    return duration;
}

export interface TimeWindowValidationResult {
    isValid: boolean;
    requiredTransitBufferMinutes: number;
    availableGapMinutes: number;
    error?: string;
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

    /**
     * Calculates the minimum transit buffer in minutes between two venues
     * based on distance (or optional graph) and selected mobility mode.
     */
    public calculateTransitBufferMinutes(
        fromVenue: VenueNode,
        toVenue: VenueNode,
        mode: MobilityMode = 'walking',
        graph?: ItineraryGraph
    ): number {
        if (fromVenue.id === toVenue.id) return 0;

        if (graph) {
            return graph.getRequiredTransitBufferMinutes(fromVenue.id, toVenue.id, mode);
        }

        // Haversine distance in meters
        const R = 6371e3;
        const rad = Math.PI / 180;
        const lat1 = fromVenue.latitude * rad;
        const lat2 = toVenue.latitude * rad;
        const dLat = (toVenue.latitude - fromVenue.latitude) * rad;
        const dLon = (toVenue.longitude - fromVenue.longitude) * rad;

        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distanceMeters = Math.round(R * c);

        const speedKmh = DEFAULT_TRANSIT_SPEEDS_KMH[mode] || DEFAULT_TRANSIT_SPEEDS_KMH.walking;
        const speedMpm = (speedKmh * 1000) / 60; // meters per minute

        return Math.ceil(distanceMeters / speedMpm);
    }

    /**
     * Resolves the configured break duration in minutes from TransitConstraintOptions.
     */
    public resolveBreakDuration(
        options?: TransitConstraintOptions,
        fromVenueId?: string,
        toVenueId?: string
    ): number {
        if (!options) return 0;

        if (fromVenueId && toVenueId && options.segmentBreakDurations) {
            const segmentKey = `${fromVenueId}->${toVenueId}`;
            const altKey = `${fromVenueId}-${toVenueId}`;
            const segmentBreak = options.segmentBreakDurations[segmentKey] ?? options.segmentBreakDurations[altKey];
            if (segmentBreak !== undefined) {
                return validateBreakDuration(segmentBreak);
            }
        }

        const candidate =
            options.customBreakDurationMinutes ??
            options.breakDurationMinutes ??
            options.minBreakDuration ??
            0;

        return validateBreakDuration(candidate);
    }

    /**
     * Calculates the earliest arrival time at the next venue considering departure time,
     * transit duration, and configured custom break duration.
     */
    public calculateEarliestArrival(
        departureTime: Date,
        transitMinutes: number,
        options?: TransitConstraintOptions
    ): Date {
        const breakMinutes = this.resolveBreakDuration(options);
        const totalMinutes = Math.max(0, transitMinutes) + breakMinutes;
        return new Date(departureTime.getTime() + totalMinutes * 60000);
    }

    /**
     * Validates if a transit window between venues is feasible, taking into account
     * mobility mode transit buffer and configured custom break duration.
     */
    public validateTransitWindow(
        previousSlot: MeetingSlot,
        nextSlot: MeetingSlot,
        mode: MobilityMode = 'walking',
        graph?: ItineraryGraph,
        options?: TransitConstraintOptions
    ): TimeWindowValidationResult {
        return this.validateConsecutiveSlots(previousSlot, nextSlot, mode, graph, options);
    }

    /**
     * Validates if a transition between two consecutive meeting time windows is feasible
     * by enforcing a minimum transit buffer based on distance, mobility mode, and custom break duration.
     */
    public validateConsecutiveSlots(
        previousSlot: MeetingSlot,
        nextSlot: MeetingSlot,
        mode: MobilityMode = 'walking',
        graph?: ItineraryGraph,
        options?: TransitConstraintOptions
    ): TimeWindowValidationResult {
        const prevEnd = previousSlot.endTime instanceof Date ? previousSlot.endTime : new Date(previousSlot.endTime);
        const nextStart = nextSlot.startTime instanceof Date ? nextSlot.startTime : new Date(nextSlot.startTime);

        const availableGapMinutes = (nextStart.getTime() - prevEnd.getTime()) / 60000;
        const requiredTransitMinutes = this.calculateTransitBufferMinutes(
            previousSlot.venue,
            nextSlot.venue,
            mode,
            graph
        );

        const breakMinutes = this.resolveBreakDuration(
            options,
            previousSlot.venue.id,
            nextSlot.venue.id
        );

        const totalRequiredMinutes = requiredTransitMinutes + breakMinutes;

        if (availableGapMinutes < totalRequiredMinutes) {
            const breakDetail = breakMinutes > 0 ? ` (${requiredTransitMinutes}m transit + ${breakMinutes}m break)` : "";
            return {
                isValid: false,
                requiredTransitBufferMinutes: totalRequiredMinutes,
                availableGapMinutes: Math.round(availableGapMinutes * 10) / 10,
                error: `Insufficient transit allowance between '${previousSlot.venue.name}' and '${nextSlot.venue.name}'. Required: ${totalRequiredMinutes} mins${breakDetail} via ${mode}, available: ${Math.round(availableGapMinutes * 10) / 10} mins.`
            };
        }

        return {
            isValid: true,
            requiredTransitBufferMinutes: totalRequiredMinutes,
            availableGapMinutes: Math.round(availableGapMinutes * 10) / 10
        };
    }

    /**
     * Validates a sequence of meeting slots to guarantee that every transition satisfies
     * the required minimum transit buffer and break duration without overlapping time windows.
     */
    public validateItinerarySlots(
        slots: MeetingSlot[],
        mode: MobilityMode = 'walking',
        graph?: ItineraryGraph,
        options?: TransitConstraintOptions
    ): TimeWindowValidationResult {
        if (!slots || slots.length < 2) {
            return { isValid: true, requiredTransitBufferMinutes: 0, availableGapMinutes: 0 };
        }

        for (let i = 0; i < slots.length - 1; i++) {
            const validation = this.validateConsecutiveSlots(slots[i], slots[i + 1], mode, graph, options);
            if (!validation.isValid) {
                return validation;
            }
        }

        return { isValid: true, requiredTransitBufferMinutes: 0, availableGapMinutes: 0 };
    }
}
