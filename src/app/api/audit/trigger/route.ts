/**
 * route.ts
 * Scheduled API endpoint that initiates the daily audit batch process and commits penalty adjustments.
 */

import { NextRequest, NextResponse } from 'next/server';
import { SLACalculator, SLAThresholds } from '@/core/audit/SLACalculator';
import { TelemetryAggregator, TelemetryPoint } from '@/core/audit/TelemetryAggregator';
import { VenuePenaltyEngine } from '@/core/audit/VenuePenaltyEngine';

// Default SLA thresholds for WorkSphere venues
const DEFAULT_THRESHOLDS: SLAThresholds = {
    minWifiUptimePercent: 95,
    minAverageWifiSpeedMbps: 40,
    maxNoiseLevelDb: 65,
    minSeatAvailabilityPercent: 20
};

export async function POST(request: NextRequest) {
    try {
        // Verify authorization (e.g., cron secret or admin token)
        const authHeader = request.headers.get('authorization');
        if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { venues } = body as { venues: { id: string; baseRankScore: number; telemetry: TelemetryPoint[] }[] };

        const calculator = new SLACalculator(DEFAULT_THRESHOLDS);
        const aggregator = new TelemetryAggregator();
        const penaltyEngine = new VenuePenaltyEngine();

        const auditResults = [];

        for (const venue of venues) {
            // 1. Aggregate telemetry
            const metrics = aggregator.aggregate(venue.id, venue.telemetry);

            // 2. Evaluate against SLA
            const slaResult = calculator.evaluate(
                venue.id,
                metrics.wifiUptimePercent,
                metrics.avgWifiSpeedMbps,
                metrics.avgNoiseLevelDb,
                metrics.avgSeatAvailabilityPercent
            );

            // 3. Apply penalties to ranking
            const penaltyResult = penaltyEngine.applyPenalties(
                venue.id,
                venue.baseRankScore,
                slaResult
            );

            auditResults.push({
                venueId: venue.id,
                slaCompliant: slaResult.isCompliant,
                complianceScore: slaResult.complianceScore,
                penaltyApplied: penaltyResult.penaltyPoints,
                newRankScore: penaltyResult.finalRankScore,
                violations: slaResult.violations
            });

            // TODO: Persist penaltyResult to database (e.g., Prisma)
            // await prisma.venue.update({
            //   where: { id: venue.id },
            //   data: { rankScore: penaltyResult.finalRankScore, lastAuditDate: new Date() }
            // });
        }

        return NextResponse.json({
            success: true,
            processedCount: auditResults.length,
            results: auditResults
        }, { status: 200 });

    } catch (error) {
        console.error('Audit trigger API error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
