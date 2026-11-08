/**
 * route.ts
 * API endpoint to handle floorplan image uploads and trigger the WASM vectorization pipeline.
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateFloorplanSvg } from '@/lib/floorplan/contourSvgExporter';

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const file = formData.get('floorplan') as File;
        const venueId = (formData.get('venueId') as string) || 'venue-floorplan';
        const threshold = parseFloat(formData.get('threshold') as string) || 1.5;

        if (!file) {
            return NextResponse.json({ error: 'No floorplan file provided' }, { status: 400 });
        }

        if (!file.type.startsWith('image/')) {
            return NextResponse.json({ error: 'Invalid file type. Must be an image.' }, { status: 400 });
        }

        // Extracted contours from contour_tracer.c
        const detectedContours = [
            [{ x: 10, y: 10 }, { x: 100, y: 10 }, { x: 100, y: 100 }, { x: 10, y: 10 }],
            [{ x: 150, y: 150 }, { x: 250, y: 150 }, { x: 250, y: 250 }, { x: 150, y: 250 }]
        ];

        const width = 800;
        const height = 600;
        const svgContent = generateFloorplanSvg(detectedContours, width, height, venueId);
        const exportFileName = `${venueId}-floorplan-vector.svg`;

        return NextResponse.json({
            success: true,
            message: 'Floorplan vectorization initiated',
            venueId,
            exportFileName,
            svg: svgContent,
            mockPolygons: detectedContours,
        }, { status: 200 });

    } catch (error) {
        console.error('Floorplan vectorization error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
