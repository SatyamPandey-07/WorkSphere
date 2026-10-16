/**
 * route.ts
 * API endpoint to authenticate the team's physical presence and 
 * authorize the IoT lockdown commands.
 */

import { NextRequest, NextResponse } from 'next/server';
import { WarRoomTrigger } from '@/core/collab/WarRoomTrigger';
import { PodLockdownProtocol } from '@/core/iot/PodLockdownProtocol';
import { z } from 'zod';

const trigger = new WarRoomTrigger({
    minFilesAffected: 5,
    minTotalLines: 100,
    criticalFilePatterns: ['src/core/auth/*', 'prisma/*', 'src/app/api/*']
});

const iotProtocol = new PodLockdownProtocol();
// Register mock devices
iotProtocol.registerDevice({ id: 'lock-1', type: 'smart-lock', endpoint: 'http://iot/lock', apiKey: 'key' });
iotProtocol.registerDevice({ id: 'light-1', type: 'lighting', endpoint: 'http://iot/light', apiKey: 'key' });

const TriggerSchema = z.object({
    repository: z.string(),
    branch: z.string(),
    targetBranch: z.string(),
    author: z.string(),
    conflicts: z.array(z.object({
        filePath: z.string(),
        conflictMarkers: z.number(),
        linesAffected: z.number()
    })),
    podId: z.string(),
    teamMembers: z.array(z.string().uuid())
});

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const parsed = TriggerSchema.safeParse(body);

        if (!parsed.success) {
            return NextResponse.json({ error: 'Invalid merge event payload' }, { status: 400 });
        }

        const event = { ...parsed.data, timestamp: Date.now() };
        const evaluation = trigger.evaluateMergeEvent(event);

        if (!evaluation.trigger) {
            return NextResponse.json({
                triggered: false,
                reason: evaluation.reason
            });
        }

        // Verify team members are physically present in the pod via BLE/WiFi triangulation
        // (Mocked verification)
        const allPresent = true;

        if (!allPresent) {
            return NextResponse.json({
                error: 'War Room aborted: Not all required team members are physically present in the pod.'
            }, { status: 403 });
        }

        // Enforce IoT Lockdown
        const lockdownSuccess = await iotProtocol.enforceLockdown(parsed.data.podId, {
            name: 'Deep Focus War Room',
            lights: { brightness: 40, colorTemp: 3000 }, // Warm, dim focus lighting
            lockState: 'LOCKED',
            hvac: { fanSpeed: 'LOW', tempC: 21 },
            dndSignage: true
        }, 120); // 2 hours

        return NextResponse.json({
            triggered: true,
            roomId: evaluation.roomId,
            reason: evaluation.reason,
            lockdownActive: lockdownSuccess,
            partyKitRoom: `warroom-${parsed.data.repository}`
        });

    } catch (error: any) {
        console.error('[WarRoom API] Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    const podId = req.nextUrl.searchParams.get('podId');
    if (!podId) return NextResponse.json({ error: 'podId required' }, { status: 400 });

    await iotProtocol.releaseLockdown(podId);
    return NextResponse.json({ success: true, message: 'Lockdown released' });
}
