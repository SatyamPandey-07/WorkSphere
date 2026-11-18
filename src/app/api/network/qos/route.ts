import { NextRequest, NextResponse } from 'next/server';

/**
 * API endpoint to log anonymized network congestion events and update 
 * the venue's aggregate bandwidth capacity profile.
 */

interface CongestionEvent {
    venueId: string;
    timestamp: number;
    peakBandwidthBps: number;
    throttledPeers: number;
}

// Mock analytics storage
const congestionLogs: CongestionEvent[] = [];

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { action } = body;

        if (action === 'LOG_CONGESTION') {
            const event: CongestionEvent = {
                venueId: body.venueId,
                timestamp: Date.now(),
                peakBandwidthBps: body.peakBandwidthBps,
                throttledPeers: body.throttledPeers,
            };

            congestionLogs.push(event);

            // In production: Update the venue's historical bandwidth profile 
            // to adjust the QoSPolicy maxBandwidthBps for future sessions.

            return NextResponse.json({ success: true, logged: true });
        }

        if (action === 'GET_VENUE_CAPACITY') {
            const { venueId } = body;
            // Calculate average available bandwidth from recent logs
            const recentLogs = congestionLogs.filter(l => l.venueId === venueId && Date.now() - l.timestamp < 3600000);

            const avgCapacity = recentLogs.length > 0
                ? recentLogs.reduce((sum, l) => sum + l.peakBandwidthBps, 0) / recentLogs.length
                : 50000000; // Default 50Mbps

            return NextResponse.json({
                success: true,
                estimatedCapacityBps: avgCapacity,
            });
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
