/**
 * aec/route.ts
 * API endpoint to serve venue-specific acoustic impulse response profiles 
 * to optimize the WASM beamformer for specific glass pods.
 */
import { NextRequest, NextResponse } from 'next/server';

export interface ImpulseResponseProfile {
    venueId: string;
    roomId: string;
    roomType: 'glass-pod' | 'open-plan' | 'soundproof-booth';
    rt60Ms: number; // Reverberation time
    reflectionDelaysMs: number[]; // Major reflection delays
    recommendedFilterLength: number;
    recommendedStepSize: number;
}

// Mock database of venue acoustic profiles
const venueProfiles: Record<string, ImpulseResponseProfile> = {
    'venue-A-pod-1': {
        venueId: 'venue-A',
        roomId: 'pod-1',
        roomType: 'glass-pod',
        rt60Ms: 450, // Glass pods have high reverb
        reflectionDelaysMs: [12, 24, 36], // Early reflections from glass walls
        recommendedFilterLength: 1024, // Needs longer filter for glass reverb
        recommendedStepSize: 0.15, // Slower adaptation to handle complex reflections
    },
    'venue-A-booth-2': {
        venueId: 'venue-A',
        roomId: 'booth-2',
        roomType: 'soundproof-booth',
        rt60Ms: 150,
        reflectionDelaysMs: [5],
        recommendedFilterLength: 256,
        recommendedStepSize: 0.3,
    },
    'venue-B-open': {
        venueId: 'venue-B',
        roomId: 'open-plan',
        roomType: 'open-plan',
        rt60Ms: 600,
        reflectionDelaysMs: [20, 40, 60, 80],
        recommendedFilterLength: 512,
        recommendedStepSize: 0.2,
    },
};

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const venueId = searchParams.get('venueId');
    const roomId = searchParams.get('roomId');

    if (!venueId || !roomId) {
        return NextResponse.json(
            { error: 'venueId and roomId are required' },
            { status: 400 }
        );
    }

    const key = `${venueId}-${roomId}`;
    const profile = venueProfiles[key];

    if (!profile) {
        // Return a generic open-plan profile as fallback
        return NextResponse.json({
            success: true,
            data: {
                venueId,
                roomId,
                roomType: 'open-plan',
                rt60Ms: 500,
                reflectionDelaysMs: [15, 30, 45],
                recommendedFilterLength: 512,
                recommendedStepSize: 0.2,
            },
            message: 'Using generic acoustic profile',
        });
    }

    return NextResponse.json({
        success: true,
        data: profile,
    });
}

export async function POST(request: NextRequest) {
    // Admin endpoint to upload new acoustic profiles measured via sine sweeps
    try {
        const body: ImpulseResponseProfile = await request.json();
        const { venueId, roomId } = body;

        if (!venueId || !roomId) {
            return NextResponse.json(
                { error: 'Missing required fields' },
                { status: 400 }
            );
        }

        const key = `${venueId}-${roomId}`;
        venueProfiles[key] = body;

        console.log(`[AEC API] Updated acoustic profile for ${key}`);

        return NextResponse.json({
            success: true,
            message: 'Profile updated successfully',
        });
    } catch (error: any) {
        console.error('[AEC API] Error updating profile:', error);
        return NextResponse.json(
            { error: 'Internal server error', details: error.message },
            { status: 500 }
        );
    }
}
