/**
 * route.ts
 * API endpoint to securely proxy flight webhooks and trigger 
 * the automated itinerary reconstruction pipeline.
 */

import { NextRequest, NextResponse } from 'next/server';
import { FlightTelemetryEngine } from '@/core/travel/FlightTelemetryEngine';
import { ItineraryAutoRerouter } from '@/core/travel/ItineraryAutoRerouter';
import { LoungeEscrow } from '@/core/ledger/LoungeEscrow';
import { z } from 'zod';

// Singleton instances for the server runtime
const escrow = new LoungeEscrow();
const telemetry = new FlightTelemetryEngine({
    pollingIntervalMs: 60000,
    delayThresholdMinutes: 45,
    cancellationThreshold: 1
});
const rerouter = new ItineraryAutoRerouter(escrow);

const WebhookSchema = z.object({
    flightNumber: z.string(),
    userId: z.string(),
    status: z.enum(['DELAYED', 'CANCELLED', 'ON_TIME']),
    delayMinutes: z.number().optional(),
    estimatedArrival: z.number().optional()
});

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const parsed = WebhookSchema.safeParse(body);

        if (!parsed.success) {
            return NextResponse.json({ error: 'Invalid webhook payload' }, { status: 400 });
        }

        const { flightNumber, userId, status, delayMinutes } = parsed.data;

        // Mock fetching the user's current itinerary from the database
        const mockItinerary = [
            { id: 'desk-1', type: 'desk-booking' as const, provider: 'WorkSphere', startTime: Date.now() + 7200000, endTime: Date.now() + 36000000, status: 'active' as const, referenceId: 'ref-123' },
            { id: 'transit-1', type: 'transit' as const, provider: 'Uber', startTime: Date.now() + 3600000, endTime: Date.now() + 5400000, status: 'active' as const, referenceId: 'ref-456' }
        ];

        let result;

        if (status === 'CANCELLED') {
            result = await rerouter.handleCancellation(userId, {
                flightNumber,
                airline: 'MockAir',
                departureAirport: 'JFK',
                arrivalAirport: 'LHR',
                scheduledDeparture: Date.now(),
                estimatedDeparture: Date.now(),
                scheduledArrival: Date.now() + 36000000,
                estimatedArrival: Date.now() + 36000000,
                status: 'CANCELLED',
                delayMinutes: 0
            }, mockItinerary);
        } else if (status === 'DELAYED' && delayMinutes) {
            result = await rerouter.handleDelay(userId, {
                flightNumber,
                airline: 'MockAir',
                departureAirport: 'JFK',
                arrivalAirport: 'LHR',
                scheduledDeparture: Date.now(),
                estimatedDeparture: Date.now() + (delayMinutes * 60000),
                scheduledArrival: Date.now() + 36000000,
                estimatedArrival: Date.now() + 36000000 + (delayMinutes * 60000),
                status: 'DELAYED',
                delayMinutes
            }, mockItinerary);
        } else {
            return NextResponse.json({ message: 'No rerouting action required' });
        }

        return NextResponse.json({
            success: true,
            rerouteResult: result,
            newBalance: escrow.getUserBalance(userId)
        });

    } catch (error: any) {
        console.error('[Travel Reroute API] Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
