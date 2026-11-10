import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const venueAcousticProfileSchema = z.object({
    venueId: z.string().uuid(),
    baselineNoiseDb: z.number(),
    reverberationTimeMs: z.number(),
    dominantFrequencies: z.array(z.number()),
    recommendedMixRatio: z.number().min(0).max(1),
});

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const validation = venueAcousticProfileSchema.safeParse(body);

        if (!validation.success) {
            return NextResponse.json(
                { error: 'Invalid acoustic profile', details: validation.error.flatten() },
                { status: 400 }
            );
        }

        const profile = validation.data;

        await saveVenueAcousticProfile(profile);

        const optimizedThreshold = calculateOptimalThreshold(profile);

        return NextResponse.json({
            success: true,
            optimizedThreshold,
            message: 'Acoustic profile updated and shield thresholds calibrated',
        }, { status: 201 });

    } catch (error) {
        console.error('Acoustic shield API error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const venueId = searchParams.get('venueId');

    if (!venueId) {
        return NextResponse.json({ error: 'venueId is required' }, { status: 400 });
    }

    const profile = await fetchVenueAcousticProfile(venueId);
    if (!profile) {
        return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    return NextResponse.json({ profile }, { status: 200 });
}

async function saveVenueAcousticProfile(profile: any): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 50));
}

async function fetchVenueAcousticProfile(venueId: string): Promise<any> {
    return {
        venueId,
        baselineNoiseDb: -45,
        reverberationTimeMs: 300,
        dominantFrequencies: [500, 1200],
        recommendedMixRatio: 0.5,
    };
}

function calculateOptimalThreshold(profile: any): number {
    const noiseFloor = profile.baselineNoiseDb;
    const reverbFactor = profile.reverberationTimeMs / 1000;

    let threshold = noiseFloor + 10;
    threshold -= reverbFactor * 5;

    return Math.max(-60, Math.min(-20, threshold));
}
