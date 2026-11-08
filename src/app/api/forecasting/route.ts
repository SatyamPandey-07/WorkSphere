/**
 * route.ts
 * API route to fetch the latest aggregated telemetry data to hydrate the worker's time-series store.
 */

import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const venueId = searchParams.get('venueId');
        const hours = parseInt(searchParams.get('hours') || '168', 10); // Default 1 week

        if (!venueId) {
            return NextResponse.json({ error: 'venueId is required' }, { status: 400 });
        }

        // TODO: Replace with actual Prisma query to fetch historical occupancy telemetry
        // const telemetry = await prisma.occupancyTelemetry.findMany({
        //   where: {
        //     venueId,
        //     timestamp: { gte: new Date(Date.now() - hours * 60 * 60 * 1000) }
        //   },
        //   orderBy: { timestamp: 'asc' },
        //   select: { occupancyPercentage: true }
        // });
        // const data = telemetry.map(t => t.occupancyPercentage);

        // Mock data for demonstration (sine wave simulating daily occupancy patterns)
        const data: number[] = [];
        const now = Date.now();
        for (let i = hours; i >= 0; i--) {
            const hourOfDay = ((now / (1000 * 60 * 60)) - i) % 24;
            // Simulate peak at 14:00 (value ~80), low at 04:00 (value ~10)
            const simulatedOccupancy = 45 + 35 * Math.sin(((hourOfDay - 4) / 24) * 2 * Math.PI);
            data.push(Math.max(0, Math.min(100, simulatedOccupancy)));
        }

        return NextResponse.json({
            success: true,
            venueId,
            data
        }, { status: 200 });

    } catch (error) {
        console.error('Forecasting API error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
