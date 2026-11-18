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

        const body = await req.json();
        const { messages } = body;

        if (!Array.isArray(messages)) {
            return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
        }

        let syncedCount = 0;

        for (const msg of messages) {
            await db.emergencyMessage.upsert({
                where: { id: msg.id },
                update: {
                    hopCount: msg.hopCount,
                    lastSyncedAt: new Date()
                },
                create: {
                    id: msg.id,
                    senderId: msg.senderId,
                    encryptedPayload: msg.payload,
                    gpsLat: msg.gpsCoordinates?.lat,
                    gpsLng: msg.gpsCoordinates?.lng,
                    hopCount: msg.hopCount,
                    createdAt: new Date(msg.timestamp),
                    lastSyncedAt: new Date()
                }
            });
            syncedCount++;
        }

        return NextResponse.json({
            success: true,
            syncedCount,
            message: 'Mesh payloads successfully bridged to central database.'
        }, { status: 200 });

    } catch (error: any) {
        console.error('[SURVIVAL_MESH_API]', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
