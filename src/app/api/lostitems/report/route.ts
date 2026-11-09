/**
 * report/route.ts
 * API endpoint to register a lost item, generate the cryptographic beacon keys, 
 * and initiate the mesh search.
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

export interface LostItemReport {
    userId: string;
    itemName: string;
    description: string;
    lastSeenLocation: { lat: number; lng: number };
    lastSeenTime: string;
}

export interface ReportResponse {
    reportId: string;
    itemId: string;
    rotationKeys: string[];
    partyKitRoomUrl: string;
}

// Mock database
const lostItems: Map<string, any> = new Map();

export async function POST(request: NextRequest) {
    try {
        const body: LostItemReport = await request.json();
        const { userId, itemName, description, lastSeenLocation, lastSeenTime } = body;

        if (!userId || !itemName || !lastSeenLocation) {
            return NextResponse.json(
                { error: 'Missing required fields' },
                { status: 400 }
            );
        }

        const reportId = randomUUID();
        const itemId = `item-${randomUUID()}`;

        // Generate a set of rotation keys that the beacon will cycle through.
        // The owner keeps the secret seed to decrypt location pings that use these keys.
        const rotationKeys: string[] = [];
        for (let i = 0; i < 10; i++) {
            const key = Array.from(crypto.getRandomValues(new Uint8Array(16)))
                .map(b => b.toString(16).padStart(2, '0'))
                .join('');
            rotationKeys.push(key);
        }

        const reportData = {
            reportId,
            itemId,
            userId,
            itemName,
            description,
            lastSeenLocation,
            lastSeenTime,
            rotationKeys,
            status: 'searching',
            createdAt: Date.now(),
        };

        lostItems.set(reportId, reportData);

        const partyKitBaseUrl = process.env.NEXT_PUBLIC_PARTYKIT_URL || 'http://localhost:1999';
        const partyKitRoomUrl = `${partyKitBaseUrl}/party/lost-and-found-${userId}`;

        const response: ReportResponse = {
            reportId,
            itemId,
            rotationKeys,
            partyKitRoomUrl,
        };

        console.log(`[LostItems API] Registered lost item ${itemId} for user ${userId}`);

        return NextResponse.json({
            success: true,
            data: response,
        });
    } catch (error: any) {
        console.error('[LostItems API] Error reporting item:', error);
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

    const userReports = Array.from(lostItems.values()).filter(r => r.userId === userId);

    return NextResponse.json({
        success: true,
        data: userReports,
    });
}

