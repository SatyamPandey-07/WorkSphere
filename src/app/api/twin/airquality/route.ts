import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AirQualityOrchestrator } from '@/core/digitaltwin/AirQualityOrchestrator';
import { HVACPurgeProtocol } from '@/core/iot/HVACPurgeProtocol';

const sensorUpdateSchema = z.object({
    venueId: z.string().uuid(),
    zoneId: z.string(),
    co2: z.number().min(0).max(5000),
    voc: z.number().min(0).max(2000),
    occupancy: z.number().int().min(0).optional(),
});

const orchestrator = new AirQualityOrchestrator();
const hvacProtocol = new HVACPurgeProtocol();

// Initialize with mock zones for demonstration
orchestrator.registerZone({ id: 'zone-a', name: 'Main Hall', capacity: 50, currentOccupancy: 20, volumeCubicMeters: 1500 });
orchestrator.registerZone({ id: 'zone-b', name: 'Quiet Room', capacity: 10, currentOccupancy: 5, volumeCubicMeters: 200 });

export async function POST(req: NextRequest) {
    const url = new URL(req.url);
    const path = url.pathname.split('/').pop();

    try {
        if (path === 'update') {
            return await handleSensorUpdate(req);
        } else if (path === 'status') {
            return await handleStatusRequest(req);
        }

        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    } catch (error: any) {
        console.error('Air quality API error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}

async function handleSensorUpdate(req: NextRequest) {
    const body = await req.json();
    const validation = sensorUpdateSchema.safeParse(body);
    if (!validation.success) {
        return NextResponse.json({ error: 'Invalid payload', details: validation.error.flatten() }, { status: 400 });
    }

    const { zoneId, co2, voc, occupancy } = validation.data;

    const updatedZone = orchestrator.updateSensorData(zoneId, co2, voc, occupancy);
    if (!updatedZone) {
        return NextResponse.json({ error: 'Zone not found' }, { status: 404 });
    }

    const { status, command } = orchestrator.evaluateZoneHealth(zoneId);

    if (command && command.action === 'purge') {
        // Trigger HVAC system
        await hvacProtocol.executePurge('main-system', {
            zoneIdentifier: zoneId,
            openPercentage: 100,
            fanSpeed: 'high',
            durationMinutes: Math.ceil(command.estimatedDurationMs / 60000),
        });
    }

    return NextResponse.json({
        success: true,
        zone: updatedZone,
        status,
        commandTriggered: command?.action === 'purge'
    }, { status: 200 });
}

async function handleStatusRequest(req: NextRequest) {
    const statuses = orchestrator.getAllZoneStatuses();
    const activePurges = hvacProtocol.getActiveCommands();

    return NextResponse.json({
        zones: statuses,
        activePurges,
        timestamp: Date.now()
    }, { status: 200 });
}
