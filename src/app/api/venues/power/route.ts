/**
 * POST /api/venues/power
 * Aggregates bulk outlet telemetry, processes anomalies, 
 * and returns the venue's real-time power availability map.
 */

import { NextRequest, NextResponse } from 'next/server';
import { OutletLoadBalancer, AnomalyReport, DeskOutlet } from '@/core/sensors/OutletLoadBalancer';
import { getClientIp } from '@/lib/rateLimit';

// Mocked initial venue topology
const mockOutlets: DeskOutlet[] = [
    { outletId: 'out-1', deskId: 'desk-A1', circuitId: 'circ-1', maxCapacityWatts: 1800, currentLoadWatts: 450, status: 'HEALTHY' },
    { outletId: 'out-2', deskId: 'desk-A2', circuitId: 'circ-1', maxCapacityWatts: 1800, currentLoadWatts: 1200, status: 'HEALTHY' },
    { outletId: 'out-3', deskId: 'desk-B1', circuitId: 'circ-2', maxCapacityWatts: 1800, currentLoadWatts: 200, status: 'HEALTHY' },
    { outletId: 'out-4', deskId: 'desk-B2', circuitId: 'circ-2', maxCapacityWatts: 1800, currentLoadWatts: 800, status: 'HEALTHY' }
];

// Singleton instance for the serverless function context (simulated state)
let balancer: OutletLoadBalancer | null = null;

function getBalancer(): OutletLoadBalancer {
    if (!balancer) {
        balancer = new OutletLoadBalancer(mockOutlets);
    }
    return balancer;
}

export function resetBalancer(): void {
    balancer = null;
}

export async function POST(req: NextRequest) {
    let body: any;
    try {
        body = await req.json();
    } catch {
        const sourceIp = getClientIp(req);
        const contentLength = req.headers.get('content-length');
        const payloadLength = contentLength ? parseInt(contentLength, 10) : undefined;
        console.warn('[API] Power telemetry ingestion rejected - malformed JSON payload', {
            sourceIp,
            payloadLength: isNaN(payloadLength as number) ? undefined : payloadLength,
        });
        return NextResponse.json(
            { error: 'Malformed JSON payload' },
            { status: 400 }
        );
    }

    try {
        const { telemetryBatch, queryDeskId } = body || {};

        const lb = getBalancer();

        // 1. Process incoming telemetry batch
        if (telemetryBatch && Array.isArray(telemetryBatch)) {
            for (const report of telemetryBatch as AnomalyReport[]) {
                if (report && report.status !== 'NORMAL') {
                    lb.ingestAnomaly(report);
                }
            }
        }

        // 2. Evaluate specific desk if requested
        let deskDecision = null;
        if (queryDeskId) {
            deskDecision = lb.evaluateDeskSafety(queryDeskId);
        }

        // 3. Return grid summary
        const summary = lb.getGridHealthSummary();

        return NextResponse.json({
            success: true,
            gridHealth: summary,
            deskEvaluation: deskDecision,
            timestamp: Date.now()
        }, { status: 200 });

    } catch (error: any) {
        console.error('[API] Power telemetry processing failed:', error);
        return NextResponse.json(
            { error: error.message || 'Internal Server Error' },
            { status: 500 }
        );
    }
}

export async function GET() {
    const lb = getBalancer();
    return NextResponse.json({
        gridHealth: lb.getGridHealthSummary(),
        timestamp: Date.now()
    });
}
