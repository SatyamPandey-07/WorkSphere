/**
 * vibe/route.ts
 * API endpoint to aggregate crowdsourced acoustic profiles and serve pre-computed 
 * masking stems for known venues.
 */
import { NextRequest, NextResponse } from 'next/server';

export interface AcousticProfile {
    venueId: string;
    avgDecibels: number;
    dominantFrequencies: number[]; // Hz
    noiseFloor: number;
    vibeTags: string[]; // e.g., 'chatter-heavy', 'espresso-machine', 'street-traffic'
    lastUpdated: number;
}

// Mock database of venue acoustic profiles
const venueProfiles: Map<string, AcousticProfile> = new Map([
    ['venue-1', {
        venueId: 'venue-1',
        avgDecibels: 65,
        dominantFrequencies: [250, 500, 1000], // Human speech range
        noiseFloor: 45,
        vibeTags: ['chatter-heavy', 'coffee-grinder'],
        lastUpdated: Date.now() - 3600000,
    }],
    ['venue-2', {
        venueId: 'venue-2',
        avgDecibels: 55,
        dominantFrequencies: [100, 200], // Low frequency hum (HVAC)
        noiseFloor: 35,
        vibeTags: ['hvac-hum', 'quiet-chatter'],
        lastUpdated: Date.now() - 7200000,
    }],
]);

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const venueId = searchParams.get('venueId');

    if (!venueId) {
        return NextResponse.json(
            { error: 'venueId is required' },
            { status: 400 }
        );
    }

    const profile = venueProfiles.get(venueId);

    if (!profile) {
        return NextResponse.json({
            success: true,
            data: null,
            message: 'No acoustic profile found for this venue. Using generic masking.',
        });
    }

    // Generate a mock pre-computed masking stem URL based on the profile
    const stemUrl = `/api/audio/stems/${venueId}?freqs=${profile.dominantFrequencies.join(',')}`;

    return NextResponse.json({
        success: true,
        data: {
            profile,
            stemUrl,
            recommendedMaskingIntensity: Math.min(1.0, (profile.avgDecibels - 40) / 40),
        },
    });
}

export async function POST(request: NextRequest) {
    // Endpoint for clients to submit new acoustic telemetry
    try {
        const body = await request.json();
        const { venueId, decibelReadings, frequencyData } = body;

        if (!venueId || !Array.isArray(decibelReadings)) {
            return NextResponse.json(
                { error: 'Invalid payload' },
                { status: 400 }
            );
        }

        // Calculate average decibels
        const sum = decibelReadings.reduce((a: number, b: number) => a + b, 0);
        const avgDb = sum / decibelReadings.length;

        // Mock frequency analysis
        const dominantFreqs = frequencyData || [500, 1000];

        const existing = venueProfiles.get(venueId);
        const newProfile: AcousticProfile = {
            venueId,
            avgDecibels: existing ? (existing.avgDecibels + avgDb) / 2 : avgDb,
            dominantFrequencies: dominantFreqs,
            noiseFloor: Math.min(...decibelReadings),
            vibeTags: existing?.vibeTags || ['unknown'],
            lastUpdated: Date.now(),
        };

        venueProfiles.set(venueId, newProfile);
        console.log(`[Vibe API] Updated acoustic profile for ${venueId}`);

        return NextResponse.json({
            success: true,
            message: 'Telemetry aggregated successfully',
        });
    } catch (error: any) {
        console.error('[Vibe API] Error processing telemetry:', error);
        return NextResponse.json(
            { error: 'Internal server error', details: error.message },
            { status: 500 }
        );
    }
}
