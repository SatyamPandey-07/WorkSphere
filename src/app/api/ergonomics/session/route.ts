/**
 * route.ts
 * API endpoint to log anonymized, aggregate ergonomic health metrics for venue seating evaluations.
 * Does not store personally identifiable information or video data.
 */

import { NextRequest, NextResponse } from 'next/server';

export interface ErgonomicMetric {
    venueId: string;
    averageScore: number;
    slouchingFrequency: number;
    sampleSize: number;
    timestamp: number;
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { venueId, averageScore, slouchingFrequency, sampleSize } = body;

        if (!venueId || typeof averageScore !== 'number' || typeof sampleSize !== 'number') {
            return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
        }

        // Mock database aggregation
        // In production: update venue's ergonomic profile with new crowdsourced data

        const metric: ErgonomicMetric = {
            venueId,
            averageScore,
            slouchingFrequency,
            sampleSize,
            timestamp: Date.now()
        };

        return NextResponse.json({
            success: true,
            message: 'Ergonomic metric recorded',
            data: metric
        }, { status: 200 });

    } catch (error) {
        console.error('Ergonomic metric logging error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const venueId = searchParams.get('venueId');

    if (!venueId) {
        return NextResponse.json({ error: 'Missing venueId' }, { status: 400 });
    }

    // Mock response
    return NextResponse.json({
        success: true,
        venueId,
        ergonomics: {
            averageScore: 82.5,
            slouchingFrequency: 0.15,
            sampleSize: 89,
            rating: 'Good'
        }
    }, { status: 200 });
}
