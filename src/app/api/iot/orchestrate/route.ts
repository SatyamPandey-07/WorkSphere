import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { EnvironmentOrchestrator, SessionState } from '@/core/iot/EnvironmentOrchestrator';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { sessionState, zoneId, deskId } = body;

        if (!sessionState || !zoneId || !deskId) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const activeBooking = await db.booking.findFirst({
            // Booking has no start/end timestamps or ACTIVE status: a booking
            // is "active" when it is for this seat, today, and confirmed or
            // checked in.
            where: {
                userId,
                seatId: deskId,
                status: { in: ['CONFIRMED', 'CHECKED_IN'] },
                date: new Date().toISOString().slice(0, 10)
            }
        });

        if (!activeBooking) {
            return NextResponse.json({ error: 'No active booking found for this desk' }, { status: 403 });
        }

        const orchestrator = new EnvironmentOrchestrator();
        const commands = orchestrator.transitionState(sessionState as SessionState, zoneId);

        await db.ioTOrchestrationLog.create({
            data: {
                userId,
                zoneId,
                deskId,
                sessionState,
                commandsIssued: commands.length,
                executedAt: new Date()
            }
        });

        return NextResponse.json({
            success: true,
            commands,
            message: `Environment adjusted for ${sessionState} mode.`
        }, { status: 200 });

    } catch (error: any) {
        console.error('[IOT_ORCHESTRATE_API]', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}