/**
 * route.ts
 * API endpoint to handle floorplan image uploads and trigger the WASM vectorization pipeline.
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const file = formData.get('floorplan') as File;
        const threshold = parseFloat(formData.get('threshold') as string) || 1.5;

        if (!file) {
            return NextResponse.json({ error: 'No floorplan file provided' }, { status: 400 });
        }

        if (!file.type.startsWith('image/')) {
            return NextResponse.json({ error: 'Invalid file type. Must be an image.' }, { status: 400 });
        }

        // In a real implementation, we would convert the image to grayscale Uint8Array here
        // and send it to the worker. For this scaffold, we return a mock success response.

        return NextResponse.json({
            success: true,
            message: 'Floorplan vectorization initiated',
            mockPolygons: [
                [{ x: 10, y: 10 }, { x: 100, y: 10 }, { x: 100, y: 100 }, { x: 10, y: 10 }]
            ]
        }, { status: 200 });

    } catch (error) {
        console.error('Floorplan vectorization error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
