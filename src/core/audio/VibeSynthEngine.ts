import { NextRequest, NextResponse } from 'next/server';

/**
 * API endpoint to serve venue-specific audio grain libraries and 
 * metadata presets for the generative synthesizer.
 */

interface VibePreset {
    venueType: string;
    grainDensity: number;
    grainDurationMs: number;
    pitchShift: number;
    lfoFrequency: number;
    grainLibraryUrl: string;
}

// Mock database of venue acoustic presets
const presets: Record<string, VibePreset> = {
    'cafe_bust': {
        venueType: 'cafe',
        grainDensity: 80,
        grainDurationMs: 150,
        pitchShift: 0.95,
        lfoFrequency: 0.2,
        grainLibraryUrl: '/audio/grains/espresso_machine.wav',
    },
    'quiet_library': {
        venueType: 'library',
        grainDensity: 20,
        grainDurationMs: 400,
        pitchShift: 1.0,
        lfoFrequency: 0.05,
        grainLibraryUrl: '/audio/grains/paper_rustle.wav',
    },
    'coworking_hub': {
        venueType: 'coworking',
        grainDensity: 45,
        grainDurationMs: 200,
        pitchShift: 1.05,
        lfoFrequency: 0.15,
        grainLibraryUrl: '/audio/grains/keyboard_clack.wav',
    }
};

export async function GET(req: NextRequest) {
    const venueType = req.nextUrl.searchParams.get('type') || 'cafe';

    const preset = presets[venueType] || presets['cafe_bust'];

    return NextResponse.json({
        success: true,
        preset,
        sampleRate: 44100,
    });
}