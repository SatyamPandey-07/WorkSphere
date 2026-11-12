import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const scanResultSchema = z.object({
    userId: z.string().uuid(),
    venueId: z.string().uuid(),
    deskId: z.string(),
    metrics: z.object({
        deskHeight: z.number(),
        monitorAngle: z.number(),
        keyboardDistance: z.number(),
        chairDistance: z.number(),
    }),
    timestamp: z.number().int().positive(),
});

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const validation = scanResultSchema.safeParse(body);

        if (!validation.success) {
            return NextResponse.json(
                { error: 'Invalid scan data', details: validation.error.flatten() },
                { status: 400 }
            );
        }

        const { userId, venueId, deskId, metrics, timestamp } = validation.data;

        const riskScore = calculateRiskScore(metrics);

        await logErgonomicScan({
            userId,
            venueId,
            deskId,
            metrics,
            riskScore,
            timestamp,
        });

        if (riskScore > 70) {
            await updateVenueDeskScore(venueId, deskId, riskScore);
        }

        return NextResponse.json({
            success: true,
            riskScore,
            message: riskScore > 70 ? 'High risk setup logged' : 'Setup within acceptable limits',
        }, { status: 201 });

    } catch (error) {
        console.error('Ergonomic scan API error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

function calculateRiskScore(metrics: any): number {
    let score = 0;
    if (metrics.deskHeight < 0.65 || metrics.deskHeight > 0.80) score += 30;
    if (metrics.monitorAngle < 10 || metrics.monitorAngle > 40) score += 25;
    if (metrics.keyboardDistance < 0.10 || metrics.keyboardDistance > 0.40) score += 20;
    if (metrics.chairDistance < 0.30 || metrics.chairDistance > 0.90) score += 25;
    return score;
}

async function logErgonomicScan(data: any): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 50));
}

async function updateVenueDeskScore(venueId: string, deskId: string, score: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 50));
}
