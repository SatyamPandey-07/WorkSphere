/**
 * ItineraryAutoRerouter.ts
 * Executes the cascading cancellation and rebooking logic across 
 * desk, transit, and accommodation providers.
 */

import { FlightStatus } from './FlightTelemetryEngine';
import { LoungeEscrow } from '../ledger/LoungeEscrow';

export interface ItinerarySegment {
    id: string;
    type: 'desk-booking' | 'transit' | 'accommodation' | 'lounge';
    provider: string;
    startTime: number;
    endTime: number;
    status: 'active' | 'cancelled' | 'rebooked';
    referenceId: string;
}

export interface RerouteResult {
    success: boolean;
    cancelledSegments: string[];
    rebookedSegments: string[];
    escrowActivated: boolean;
    message: string;
}

export class ItineraryAutoRerouter {
    private escrow: LoungeEscrow;

    constructor(escrow: LoungeEscrow) {
        this.escrow = escrow;
    }

    public async handleDelay(userId: string, flight: FlightStatus, itinerary: ItinerarySegment[]): Promise<RerouteResult> {
        console.log(`[AutoRerouter] Processing delay of ${flight.delayMinutes}m for user ${userId}`);

        const cancelled: string[] = [];
        const rebooked: string[] = [];

        // 1. Identify segments that are now impossible to fulfill
        const affectedSegments = itinerary.filter(seg =>
            seg.status === 'active' &&
            seg.startTime < flight.estimatedArrival + 3600000 // 1 hour buffer after landing
        );

        for (const segment of affectedSegments) {
            try {
                if (segment.type === 'desk-booking') {
                    await this.cancelDeskBooking(segment);
                    cancelled.push(segment.id);
                } else if (segment.type === 'transit') {
                    const newTransit = await this.rerouteTransit(segment, flight.estimatedArrival);
                    if (newTransit) rebooked.push(newTransit);
                    cancelled.push(segment.id);
                }
            } catch (error) {
                console.error(`[AutoRerouter] Failed to process segment ${segment.id}:`, error);
            }
        }

        // 2. If delay is massive (>4 hours) or overnight, trigger lounge/hotel escrow
        let escrowActivated = false;
        if (flight.delayMinutes > 240 || this.isOvernightDelay(flight)) {
            const success = await this.bookEmergencyLounge(userId, flight);
            escrowActivated = success;
        }

        return {
            success: true,
            cancelledSegments: cancelled,
            rebookedSegments: rebooked,
            escrowActivated,
            message: `Rerouted ${cancelled.length} segments, activated escrow: ${escrowActivated}`
        };
    }

    public async handleCancellation(userId: string, flight: FlightStatus, itinerary: ItinerarySegment[]): Promise<RerouteResult> {
        console.log(`[AutoRerouter] Processing cancellation for user ${userId}`);

        const cancelled: string[] = [];

        // Cancel ALL future segments dependent on this flight
        for (const segment of itinerary) {
            if (segment.status === 'active' && segment.startTime > Date.now()) {
                await this.cancelSegment(segment);
                cancelled.push(segment.id);
            }
        }

        // Full refund via escrow
        await this.escrow.refund(userId, 'flight-cancellation');

        return {
            success: true,
            cancelledSegments: cancelled,
            rebookedSegments: [],
            escrowActivated: false,
            message: `All dependent segments cancelled and refunded.`
        };
    }

    private async cancelDeskBooking(segment: ItinerarySegment): Promise<void> {
        // Mock API call to venue booking system
        console.log(`[AutoRerouter] Cancelling desk booking ${segment.referenceId}`);
        segment.status = 'cancelled';
    }

    private async rerouteTransit(segment: ItinerarySegment, newArrivalTime: number): Promise<string | null> {
        // Mock API call to Uber/Lyft/Transit API
        console.log(`[AutoRerouter] Rerouting transit ${segment.referenceId} to ${newArrivalTime}`);
        return `transit-${crypto.randomUUID()}`;
    }

    private async cancelSegment(segment: ItinerarySegment): Promise<void> {
        console.log(`[AutoRerouter] Cancelling generic segment ${segment.referenceId}`);
        segment.status = 'cancelled';
    }

    private async bookEmergencyLounge(userId: string, flight: FlightStatus): Promise<boolean> {
        const cost = 75.00; // Mock lounge day-rate
        return this.escrow.lockFunds(userId, cost, `lounge-${flight.flightNumber}`);
    }

    private isOvernightDelay(flight: FlightStatus): boolean {
        const originalDay = new Date(flight.scheduledArrival).getDate();
        const newDay = new Date(flight.estimatedArrival).getDate();
        return originalDay !== newDay;
    }
}
