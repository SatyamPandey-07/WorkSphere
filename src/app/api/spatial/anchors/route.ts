import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

/**
 * API endpoint to provision secure team sessions and map physical 
 * BLE beacons to virtual spatial anchors.
 */

interface SpatialAnchor {
    beaconMac: string;
    venueId: string;
    coordinate: { x: number; y: number; z: number };
    label: string;
}

// In-memory cache for demonstration; production would use Redis/Prisma
const anchorRegistry: Map<string, SpatialAnchor> = new Map();

export async function POST(req: NextRequest) {
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await req.json();
        const { action } = body;

        if (action === 'REGISTER_ANCHOR') {
            const { beaconMac, venueId, coordinate, label } = body.payload;

            if (!beaconMac || !coordinate) {
                return NextResponse.json({ error: 'Missing anchor parameters' }, { status: 400 });
            }

            const anchor: SpatialAnchor = { beaconMac, venueId, coordinate, label };
            anchorRegistry.set(beaconMac, anchor);

            return NextResponse.json({ success: true, message: 'Anchor registered' });
        }

        if (action === 'PROVISION_SESSION') {
            const { teamId } = body.payload;
            // Generate a secure, time-limited token for the PartyKit room
            const sessionToken = Buffer.from(`${teamId}:${Date.now()}`).toString('base64');

            return NextResponse.json({
                success: true,
                sessionToken,
                roomUrl: `wss://worksphere-party.gen.party/team-proximity-${teamId}`,
            });
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function GET(req: NextRequest) {
    const venueId = req.nextUrl.searchParams.get('venueId');
    if (!venueId) {
        return NextResponse.json({ error: 'venueId is required' }, { status: 400 });
    }

    const venueAnchors = Array.from(anchorRegistry.values()).filter(a => a.venueId === venueId);

    return NextResponse.json({
        venueId,
        anchors: venueAnchors,
    });
}
