import { NextRequest, NextResponse } from 'next/server';

// Mock database for venue geometry and pre-calculated matrices
const venueGeometry: Map<string, { desks: any[], windows: any[] }> = new Map();
const glareMatrices: Map<string, Record<string, any[]>> = new Map();

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { action, venueId, geometry, matrix } = body;

        if (action === 'UPDATE_GEOMETRY') {
            if (!venueId || !geometry) {
                return NextResponse.json({ error: 'Missing venueId or geometry' }, { status: 400 });
            }
            venueGeometry.set(venueId, geometry);
            return NextResponse.json({ success: true, message: 'Geometry updated. Trigger worker to recalculate matrix.' });
        }

        if (action === 'SUBMIT_MATRIX') {
            if (!venueId || !matrix) {
                return NextResponse.json({ error: 'Missing venueId or matrix' }, { status: 400 });
            }
            glareMatrices.set(venueId, matrix);
            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    } catch (error) {
        console.error('Glare API Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function GET(req: NextRequest) {
    const venueId = req.nextUrl.searchParams.get('venueId');
    const timestamp = req.nextUrl.searchParams.get('timestamp');

    if (!venueId) {
        return NextResponse.json({ error: 'venueId is required' }, { status: 400 });
    }

    const matrix = glareMatrices.get(venueId);
    if (!matrix) {
        return NextResponse.json({
            message: 'No glare matrix available. Geometry may not be mapped yet.'
        }, { status: 404 });
    }

    if (timestamp) {
        // Filter matrix for specific time
        const targetTime = new Date(parseInt(timestamp)).getTime();
        const filtered: Record<string, any> = {};

        for (const [deskId, results] of Object.entries(matrix)) {
            const closest = (results as any[]).reduce((prev, curr) => {
                return Math.abs(curr.timestamp - targetTime) < Math.abs(prev.timestamp - targetTime) ? curr : prev;
            });
            filtered[deskId] = closest;
        }

        return NextResponse.json({ venueId, timestamp, glareData: filtered });
    }

    return NextResponse.json({ venueId, matrix });
}
