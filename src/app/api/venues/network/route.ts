import { NextRequest, NextResponse } from 'next/server';
import { NetworkFingerprinter, FingerprintResult } from '@/core/network/NetworkFingerprinter';
import { ProtocolLatencyMatrix, ProtocolScore } from '@/core/network/ProtocolLatencyMatrix';

// Mock database for venue scores
const venueScores: Map<string, { fingerprint: FingerprintResult; matrix: ProtocolScore[] }> = new Map();

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { action, venueId, fingerprint, dnsLatencies } = body;

        if (action === 'SUBMIT_FINGERPRINT') {
            if (!venueId || !fingerprint || !dnsLatencies) {
                return NextResponse.json({ error: 'Missing required data' }, { status: 400 });
            }

            const matrixGen = new ProtocolLatencyMatrix();
            const matrix = matrixGen.generateMatrix(fingerprint as FingerprintResult, dnsLatencies);

            // In production, aggregate this with existing scores for the venue
            venueScores.set(venueId, { fingerprint: fingerprint as FingerprintResult, matrix });

            return NextResponse.json({
                success: true,
                message: 'Fingerprint ingested and compatibility matrix generated.'
            });
        }

        if (action === 'RUN_LOCAL_PROBE') {
            // Triggered by client to run the fingerprinter locally and return results
            const fingerprinter = new NetworkFingerprinter();
            const result = await fingerprinter.runProbes();
            return NextResponse.json({ success: true, fingerprint: result });
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    } catch (error) {
        console.error('Network API Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function GET(req: NextRequest) {
    const venueId = req.nextUrl.searchParams.get('venueId');
    if (!venueId) {
        return NextResponse.json({ error: 'venueId is required' }, { status: 400 });
    }

    const data = venueScores.get(venueId);
    if (!data) {
        return NextResponse.json({
            message: 'No network data available for this venue yet. Run a probe to contribute.'
        }, { status: 404 });
    }

    return NextResponse.json(data);
}
