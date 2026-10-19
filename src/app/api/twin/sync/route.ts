import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Verify user is a venue manager to allow telemetry ingestion
        const user = await db.user.findUnique({ where: { id: userId } });
        // There is no role column on User; venue managers are admins.
        if (!user || !user.isAdmin) {
            return NextResponse.json({ error: 'Forbidden: Manager access required' }, { status: 403 });
        }

        const body = await req.json();
        const { venueId, roomId, sensorReadings } = body;

        if (!venueId || !roomId || !Array.isArray(sensorReadings)) {
            return NextResponse.json({ error: 'Invalid payload structure' }, { status: 400 });
        }

        // Batch insert telemetry data for historical digital twin playback
        const dataToInsert = sensorReadings.map((r: any) => ({
            venueId,
            roomId,
            sensorId: r.sensorId,
            type: r.type,
            value: r.value,
            recordedAt: new Date(r.timestamp || Date.now())
        }));

        if (dataToInsert.length > 0) {
            await db.venueTelemetry.createMany({
                data: dataToInsert,
                skipDuplicates: true
            });
        }

        return NextResponse.json({
            success: true,
            ingestedCount: dataToInsert.length,
            message: 'Digital Twin telemetry synced successfully.'
        }, { status: 200 });

    } catch (error: any) {
        console.error('[TWIN_SYNC_API]', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const venueId = searchParams.get('venueId');

        if (!venueId) {
            return NextResponse.json({ error: 'venueId is required' }, { status: 400 });
        }

        // Fetch the latest state snapshot for the digital twin dashboard
        const latestSnapshot = await db.venueStateSnapshot.findFirst({
            where: { venueId },
            orderBy: { createdAt: 'desc' }
        });

        if (!latestSnapshot) {
            return NextResponse.json({ message: 'No twin state available yet.' }, { status: 404 });
        }

        return NextResponse.json({
            success: true,
            state: JSON.parse(latestSnapshot.stateJson),
            timestamp: latestSnapshot.createdAt
        }, { status: 200 });

    } catch (error: any) {
        console.error('[TWIN_FETCH_API]', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
