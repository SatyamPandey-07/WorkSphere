import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const { userId } = auth();
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { sessionDurationMin, averageDelayMs, venueId } = body;

        if (!sessionDurationMin || averageDelayMs === undefined || !venueId) {
            return NextResponse.json({ error: 'Missing metrics payload' }, { status: 400 });
        }

        await db.privacyJammerSession.create({
            data: {
                userId,
                venueId,
                durationMinutes: sessionDurationMin,
                averageDelayMs,
                completedAt: new Date()
            }
        });

        return NextResponse.json({
            success: true,
            message: 'Jammer telemetry logged.'
        }, { status: 200 });

    } catch (error: any) {
        console.error('[JAMMER_API]', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function GET(req: NextRequest) {
    try {
        const { userId } = auth();
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const sessions = await db.privacyJammerSession.findMany({
            where: { userId },
            orderBy: { completedAt: 'desc' },
            take: 10
        });

        return NextResponse.json({
            success: true,
            sessions
        }, { status: 200 });

    } catch (error: any) {
        console.error('[JAMMER_FETCH]', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
