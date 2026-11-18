import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const readingSchema = z.object({
    venueId: z.string().uuid(),
    circuitId: z.string(),
    amperage: z.number(),
    wattage: z.number(),
    timestamp: z.number().int().positive(),
});

const forecastRequestSchema = z.object({
    venueId: z.string().uuid(),
    hoursAhead: z.number().int().min(1).max(24),
});

export async function POST(req: NextRequest) {
    const url = new URL(req.url);
    const path = url.pathname.split('/').pop();

    try {
        if (path === 'reading') {
            return await handleReading(req);
        } else if (path === 'forecast') {
            return await handleForecast(req);
        } else if (path === 'alert') {
            return await handleAlert(req);
        }

        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    } catch (error: any) {
        console.error('Power grid API error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}

async function handleReading(req: NextRequest) {
    const body = await req.json();
    const validation = readingSchema.safeParse(body);
    if (!validation.success) {
        return NextResponse.json({ error: 'Invalid payload', details: validation.error.flatten() }, { status: 400 });
    }

    // In a real app, this would push to a message queue or the worker directly
    await saveTelemetry(validation.data);

    return NextResponse.json({ success: true }, { status: 201 });
}

async function handleForecast(req: NextRequest) {
    const body = await req.json();
    const validation = forecastRequestSchema.safeParse(body);
    if (!validation.success) {
        return NextResponse.json({ error: 'Invalid payload', details: validation.error.flatten() }, { status: 400 });
    }

    const { venueId, hoursAhead } = validation.data;
    const forecast = await getVenueForecast(venueId, hoursAhead);

    return NextResponse.json({ forecast }, { status: 200 });
}

async function handleAlert(req: NextRequest) {
    const body = await req.json();
    // Trigger push notifications to users in the venue to switch to low-power mode
    await broadcastLowPowerAlert(body.venueId, body.circuitId, body.severity);
    return NextResponse.json({ success: true }, { status: 200 });
}

async function saveTelemetry(data: any): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 10));
}

async function getVenueForecast(venueId: string, hours: number): Promise<any[]> {
    // Mock forecast data
    return Array.from({ length: hours }, (_, i) => ({
        timestamp: Date.now() + (i + 1) * 3600000,
        predictedWatts: 5000 + Math.random() * 2000,
        upperBound: 7500,
        lowerBound: 4500,
        confidence: 0.9 - (i * 0.05),
    }));
}

async function broadcastLowPowerAlert(venueId: string, circuitId: string, severity: string): Promise<void> {
    console.log(`Broadcasting ${severity} power alert for venue ${venueId}, circuit ${circuitId}`);
    await new Promise(resolve => setTimeout(resolve, 10));
}
