/**
 * calibrate/route.ts
 * API endpoint to store user-specific privacy sensitivity thresholds 
 * and calibrate the detection engine.
 */
import { NextRequest, NextResponse } from 'next/server';

export interface CalibrationData {
    userId: string;
    gazeSensitivity: number; // 0.0 to 1.0
    shoulderSurfDistance: number; // in cm
    enableAutoBlur: boolean;
    updatedAt: number;
}

// Mock database
const userCalibrations: Map<string, CalibrationData> = new Map();

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { userId, gazeSensitivity, shoulderSurfDistance, enableAutoBlur } = body;

        if (!userId) {
            return NextResponse.json(
                { error: 'userId is required' },
                { status: 400 }
            );
        }

        // Validate ranges
        if (gazeSensitivity < 0 || gazeSensitivity > 1) {
            return NextResponse.json(
                { error: 'gazeSensitivity must be between 0.0 and 1.0' },
                { status: 400 }
            );
        }

        if (shoulderSurfDistance < 30 || shoulderSurfDistance > 200) {
            return NextResponse.json(
                { error: 'shoulderSurfDistance must be between 30cm and 200cm' },
                { status: 400 }
            );
        }

        const calibration: CalibrationData = {
            userId,
            gazeSensitivity: gazeSensitivity ?? 0.6,
            shoulderSurfDistance: shoulderSurfDistance ?? 100,
            enableAutoBlur: enableAutoBlur ?? true,
            updatedAt: Date.now(),
        };

        // Save to DB
        userCalibrations.set(userId, calibration);
        console.log(`[Calibrate API] Saved calibration for user ${userId}`);

        return NextResponse.json({
            success: true,
            data: calibration,
        });
    } catch (error: any) {
        console.error('[Calibrate API] Error saving calibration:', error);
        return NextResponse.json(
            { error: 'Internal server error', details: error.message },
            { status: 500 }
        );
    }
}

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
        return NextResponse.json(
            { error: 'userId is required' },
            { status: 400 }
        );
    }

    const calibration = userCalibrations.get(userId);

    if (!calibration) {
        return NextResponse.json({
            success: true,
            data: null,
            message: 'No calibration found, using defaults',
        });
    }

    return NextResponse.json({
        success: true,
        data: calibration,
    });
}
