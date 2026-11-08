/**
 * route.ts
 * API endpoint to fetch WebAuthn passkey creation options for the registration ceremony.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

export async function GET(request: NextRequest) {
    try {
        // In production, fetch user ID and name from Clerk session
        const userId = 'user_12345';
        const userName = 'user@example.com';

        const challenge = crypto.randomBytes(32).toString('base64url');

        // Store challenge in session/Redis for verification (mocked here)
        // await redis.set(`webauthn_challenge:${userId}`, challenge, { ex: 60 });

        const options = {
            challenge,
            rp: { name: 'WorkSphere', id: process.env.NEXT_PUBLIC_APP_URL?.replace('https://', '') || 'localhost' },
            user: {
                id: Buffer.from(userId).toString('base64url'),
                name: userName,
                displayName: userName,
            },
            pubKeyCredParams: [
                { type: 'public-key', alg: -7 }, // ES256
                { type: 'public-key', alg: -257 }, // RS256
            ],
            timeout: 60000,
            attestation: 'none',
            authenticatorSelection: {
                residentKey: 'required',
                userVerification: 'required',
            },
        };

        return NextResponse.json(options, { status: 200 });
    } catch (error) {
        console.error('Passkey options generation error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
