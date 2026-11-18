/**
 * unlock/route.ts
 * API endpoint that verifies the user's active rental session and broadcasts 
 * the unlock signal to the specific IoT device.
 */
import { NextRequest, NextResponse } from 'next/server';

export interface UnlockRequest {
    lockerId: string;
    token: string;
    userId: string;
}

// Mock IoT Hub communication
async function sendUnlockSignalToHub(lockerId: string, rentalId: string): Promise<boolean> {
    // In reality, publish to MQTT topic or send WebSocket message to IoT hub
    console.log(`[Unlock API] Sending unlock signal to locker ${lockerId} for rental ${rentalId}`);
    return true;
}

// Mock Token Verification
async function verifyToken(token: string, lockerId: string): Promise<{ valid: boolean; rentalId?: string; userId?: string }> {
    // In reality, call SmartLockProtocol.verifyToken
    if (token.startsWith('mock-token-')) {
        const parts = token.split('-');
        return {
            valid: true,
            rentalId: parts[2],
            userId: 'mock-user',
        };
    }
    return { valid: false };
}

export async function POST(request: NextRequest) {
    try {
        const body: UnlockRequest = await request.json();
        const { lockerId, token, userId } = body;

        if (!lockerId || !token || !userId) {
            return NextResponse.json(
                { error: 'Missing required fields' },
                { status: 400 }
            );
        }

        const verification = await verifyToken(token, lockerId);

        if (!verification.valid) {
            return NextResponse.json(
                { error: 'Invalid or expired unlock token' },
                { status: 401 }
            );
        }

        if (verification.userId !== userId) {
            return NextResponse.json(
                { error: 'Token does not belong to this user' },
                { status: 403 }
            );
        }

        const signalSent = await sendUnlockSignalToHub(lockerId, verification.rentalId!);

        if (!signalSent) {
            return NextResponse.json(
                { error: 'Failed to communicate with IoT hub' },
                { status: 502 }
            );
        }

        return NextResponse.json({
            success: true,
            message: 'Unlock signal sent successfully',
            rentalId: verification.rentalId,
        });
    } catch (error: any) {
        console.error('[Unlock API] Error processing unlock:', error);
        return NextResponse.json(
            { error: 'Internal server error', details: error.message },
            { status: 500 }
        );
    }
}
