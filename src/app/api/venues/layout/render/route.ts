/**
 * route.ts
 * API endpoint that serves the compiled binary mesh data and texture atlases for the venue layouts.
 */

import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const venueId = searchParams.get('venueId');

    if (!venueId) {
        return NextResponse.json({ error: 'Missing venueId' }, { status: 400 });
    }

    // Mock response for scaffold
    // In production, this would serve actual binary glTF/GLB data or optimized mesh buffers
    return NextResponse.json({
        success: true,
        venueId,
        meshUrl: `/assets/venues/${venueId}/desk_layout.glb`,
        textureAtlasUrl: `/assets/venues/${venueId}/texture_atlas.png`,
        instances: [
            { id: 'desk-1', x: 10, y: 10, z: 0, rotation: 0, isAvailable: true },
            { id: 'desk-2', x: 15, y: 10, z: 0, rotation: 0, isAvailable: false }
        ]
    }, { status: 200 });
}
