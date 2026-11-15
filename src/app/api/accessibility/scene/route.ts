/**
 * route.ts
 * API endpoint to serve localized audio-description vocabularies 
 * and log anonymized accessibility friction points.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const LogFrictionSchema = z.object({
    venueId: z.string().uuid(),
    userId: z.string().uuid(),
    objectType: z.enum(['obstacle', 'chair', 'outlet', 'person']),
    coordinate: z.array(z.number()).length(3),
    timestamp: z.number().int()
});

// Mock database for friction points
const frictionLogs: any[] = [];

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const parsed = LogFrictionSchema.safeParse(body);

        if (!parsed.success) {
            return NextResponse.json({ error: 'Invalid log payload' }, { status: 400 });
        }

        frictionLogs.push(parsed.data);

        // In production, aggregate this data to improve venue accessibility scores
        console.log(`[Accessibility API] Logged friction point for ${parsed.data.objectType} at venue ${parsed.data.venueId}`);

        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function GET(req: NextRequest) {
    const locale = req.nextUrl.searchParams.get('locale') || 'en-US';

    // Serve localized vocabulary for the SpatialAnnouncer
    const vocabularies: Record<string, Record<string, string>> = {
        'en-US': {
            obstacle: 'obstacle',
            chair: 'empty chair',
            outlet: 'power outlet',
            person: 'person',
            direction_left: 'to your left',
            direction_right: 'to your right',
            direction_ahead: 'ahead',
            distance_unit: 'meters away'
        },
        'es-ES': {
            obstacle: 'obstáculo',
            chair: 'silla vacía',
            outlet: 'enchufe',
            person: 'persona',
            direction_left: 'a tu izquierda',
            direction_right: 'a tu derecha',
            direction_ahead: 'adelante',
            distance_unit: 'metros de distancia'
        }
    };

    return NextResponse.json({
        locale,
        vocabulary: vocabularies[locale] || vocabularies['en-US']
    });
}
