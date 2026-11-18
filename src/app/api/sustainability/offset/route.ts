/**
 * offset/route.ts
 * API endpoint that interfaces with carbon-offset APIs to process micro-transactions for commute neutralization.
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

export interface OffsetRequest {
    userId: string;
    amountGrams: number;
    projectId: string; // e.g., 'reforestation-amazon', 'wind-farm-india'
    paymentMethod: 'tokens' | 'fiat';
}

export interface OffsetCertificate {
    certificateId: string;
    userId: string;
    amountGrams: number;
    projectId: string;
    retiredAt: number;
    registryUrl: string;
}

// Mock carbon offset projects
const projects: Record<string, { name: string; pricePerTonUSD: number }> = {
    'reforestation-amazon': { name: 'Amazon Reforestation', pricePerTonUSD: 15 },
    'wind-farm-india': { name: 'India Wind Power', pricePerTonUSD: 12 },
    'direct-air-capture': { name: 'Direct Air Capture', pricePerTonUSD: 250 },
};

export async function POST(request: NextRequest) {
    try {
        const body: OffsetRequest = await request.json();
        const { userId, amountGrams, projectId, paymentMethod } = body;

        if (!userId || !amountGrams || !projectId) {
            return NextResponse.json(
                { error: 'Missing required fields' },
                { status: 400 }
            );
        }

        const project = projects[projectId];
        if (!project) {
            return NextResponse.json(
                { error: 'Invalid project ID' },
                { status: 404 }
            );
        }

        if (amountGrams <= 0) {
            return NextResponse.json(
                { error: 'Amount must be greater than 0' },
                { status: 400 }
            );
        }

        // Calculate cost
        const tons = amountGrams / 1000000;
        const costUSD = tons * project.pricePerTonUSD;

        // Mock payment processing
        if (paymentMethod === 'tokens') {
            console.log(`[Offset API] Deducted equivalent tokens for $${costUSD.toFixed(2)}`);
        } else {
            console.log(`[Offset API] Processed fiat payment of $${costUSD.toFixed(2)}`);
        }

        // Mock retiring the carbon credits in a registry (e.g., Verra, Gold Standard)
        const certificateId = randomUUID();
        const certificate: OffsetCertificate = {
            certificateId,
            userId,
            amountGrams,
            projectId,
            retiredAt: Date.now(),
            registryUrl: `https://registry.mock/certificates/${certificateId}`,
        };

        console.log(`[Offset API] Retired ${amountGrams}g of CO2 via ${project.name}`);

        return NextResponse.json({
            success: true,
            data: {
                certificate,
                costUSD: parseFloat(costUSD.toFixed(2)),
                projectName: project.name,
            },
        });
    } catch (error: any) {
        console.error('[Offset API] Error processing offset:', error);
        return NextResponse.json(
            { error: 'Internal server error', details: error.message },
            { status: 500 }
        );
    }
}
