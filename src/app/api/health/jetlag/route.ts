import { NextRequest, NextResponse } from 'next/server';
import { JetlagRecoveryEngine, FlightItinerary } from '@/core/health/JetlagRecoveryEngine';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { originTimezone, destinationTimezone, departureTime, arrivalTime, flightDurationHours, days } = body;

        if (!originTimezone || !destinationTimezone || !departureTime || !arrivalTime || !flightDurationHours) {
            return NextResponse.json({ error: 'Missing required itinerary fields' }, { status: 400 });
        }

        const itinerary: FlightItinerary = {
            originTimezone,
            destinationTimezone,
            departureTime: new Date(departureTime).getTime(),
            arrivalTime: new Date(arrivalTime).getTime(),
            flightDurationHours
        };

        const engine = new JetlagRecoveryEngine(itinerary);
        const schedules = engine.generateRecoveryProtocol(days || 3);
        const summary = engine.getPhaseShiftSummary();

        await db.jetLagProtocol.upsert({
            where: {
                userId_originTimezone_destinationTimezone: {
                    userId,
                    originTimezone,
                    destinationTimezone
                }
            },
            update: {
                protocolData: JSON.stringify(schedules),
                summary,
                updatedAt: new Date()
            },
            create: {
                userId,
                originTimezone,
                destinationTimezone,
                protocolData: JSON.stringify(schedules),
                summary
            }
        });

        return NextResponse.json({
            success: true,
            schedules,
            summary,
            message: 'Circadian recovery protocol generated and synced.'
        }, { status: 200 });

    } catch (error: any) {
        console.error('[JETLAG_RECOVERY_API]', error);
        return NextResponse.json({
            error: 'Internal Server Error',
            details: error.message
        }, { status: 500 });
    }
}

export async function GET(req: NextRequest) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const origin = searchParams.get('origin');
        const destination = searchParams.get('destination');

        if (!origin || !destination) {
            return NextResponse.json({ error: 'Missing origin or destination query params' }, { status: 400 });
        }

        const protocol = await db.jetLagProtocol.findUnique({
            where: {
                userId_originTimezone_destinationTimezone: {
                    userId,
                    originTimezone: origin,
                    destinationTimezone: destination
                }
            }
        });

        if (!protocol) {
            return NextResponse.json({
                message: 'No active recovery protocol found for this route.'
            }, { status: 404 });
        }

        return NextResponse.json({
            success: true,
            schedules: JSON.parse(protocol.protocolData),
            summary: protocol.summary,
            lastUpdated: protocol.updatedAt
        }, { status: 200 });

    } catch (error: any) {
        console.error('[JETLAG_RECOVERY_FETCH]', error);
        return NextResponse.json({
            error: 'Internal Server Error',
            details: error.message
        }, { status: 500 });
    }
}
