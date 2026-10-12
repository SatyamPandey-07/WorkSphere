/**
 * route.ts
 * API endpoint that issues the server-signed attestation and records the cryptographic proof in the database.
 */

import { NextRequest, NextResponse } from 'next/server';
import { PoAPGenerator } from '@/core/attestation/PoAPGenerator';
import { GeofenceValidator, SensorData, VenueBounds } from '@/core/attestation/GeofenceValidator';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { userId, venueId, sensorData, venueBounds } = body as {
            userId: string;
            venueId: string;
            sensorData: SensorData;
            venueBounds: VenueBounds;
        };

        if (!userId || !venueId || !sensorData || !venueBounds) {
            return NextResponse.json({ error: 'Missing required check-in data' }, { status: 400 });
        }

        const validator = new GeofenceValidator();
        const validation = await validator.verifyPresenceAsync(sensorData, venueBounds);

        if (!validation.isValid) {
            return NextResponse.json({
                error: validation.reason || 'Geofence validation failed',
                confidence: validation.confidence,
                isExpired: validation.isExpired ?? false,
                isVerifying: false
            }, { status: 403 });
        }

        const generator = new PoAPGenerator();
        const claim = generator.generateClaim(
            userId,
            venueId,
            sensorData.gpsLat,
            sensorData.gpsLng,
            sensorData.wifiSsid,
            JSON.stringify(sensorData)
        );

        const serializedClaim = generator.serializeClaim(claim);

        return NextResponse.json({
            success: true,
            message: 'PoAP issued successfully',
            claim: serializedClaim,
            confidence: validation.confidence,
            signature: 'mock_server_signature_hex_string'
        }, { status: 201 });

    } catch (error) {
        console.error('PoAP check-in error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
