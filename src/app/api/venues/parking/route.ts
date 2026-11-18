/**
 * POST /api/venues/parking
 * Returns the predicted availability matrix and optimal routing coordinates.
 */

import { NextRequest, NextResponse } from 'next/server';
import { ParkingForecaster } from '@/core/predictive/ParkingForecaster';
import { EVChargerLoadBalancer, ChargerStatus } from '@/core/predictive/EVChargerLoadBalancer';

// Mocked initialization
const mockStations = [
    { stationId: 'ev-1', zoneId: 'zone-A', maxKw: 50, currentLoadKw: 10, status: ChargerStatus.AVAILABLE, connectorType: 'CCS' as const, queueDepth: 0 },
    { stationId: 'ev-2', zoneId: 'zone-A', maxKw: 50, currentLoadKw: 45, status: ChargerStatus.OCCUPIED, connectorType: 'CCS' as const, queueDepth: 1 },
    { stationId: 'ev-3', zoneId: 'zone-B', maxKw: 150, currentLoadKw: 20, status: ChargerStatus.AVAILABLE, connectorType: 'CHAdeMO' as const, queueDepth: 0 }
];

const forecaster = new ParkingForecaster();
const loadBalancer = new EVChargerLoadBalancer(mockStations, { 'zone-A': 100, 'zone-B': 200 });

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { action, zoneId, request } = body;

        if (action === 'GET_FORECAST') {
            const forecast = forecaster.forecast(zoneId, 4);
            return NextResponse.json({ success: true, forecast }, { status: 200 });
        }

        if (action === 'REQUEST_EV_CHARGING') {
            const decision = loadBalancer.assignRequest(request);
            return NextResponse.json({ success: true, decision }, { status: 200 });
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function GET() {
    return NextResponse.json({
        zones: ['zone-A', 'zone-B'],
        timestamp: Date.now()
    });
}
