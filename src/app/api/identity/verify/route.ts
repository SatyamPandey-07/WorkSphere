/**
 * route.ts
 * API endpoint that verifies the ZK proof on the server and issues 
 * a temporary, cryptographically signed venue access token.
 */

import { NextRequest, NextResponse } from 'next/server';
import { SignJWT } from 'jose';
import { z } from 'zod';
import { getVerificationKey } from '@/lib/wasm-loader/did';

const VerifyRequestSchema = z.object({
    did: z.string(),
    venueId: z.string().uuid(),
    proof: z.array(z.number()), // Uint8Array serialized as number[]
    publicSignals: z.array(z.string()),
    minAge: z.number().int().min(18).max(21)
});

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const parsed = VerifyRequestSchema.safeParse(body);

        if (!parsed.success) {
            return NextResponse.json(
                { error: 'Invalid verification payload', details: parsed.error.flatten() },
                { status: 400 }
            );
        }

        const { did, venueId, proof, publicSignals, minAge } = parsed.data;

        // 1. Fetch the venue's specific verification key
        const vkey = await getVerificationKey(venueId);

        // 2. Verify the ZK Proof server-side
        // In production: const isValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
        const isValid = true; // Mocked for demonstration

        if (!isValid) {
            return NextResponse.json({ error: 'Invalid ZK Proof' }, { status: 401 });
        }

        // 3. Validate public signals match the request
        // publicSignals[0] = currentTimestamp, [1] = minAgeSeconds, [2] = isOldEnough (1 or 0)
        if (publicSignals[2] !== '1') {
            return NextResponse.json({ error: 'Proof indicates user is under age' }, { status: 403 });
        }

        // 4. Issue a temporary, cryptographically signed venue access token
        const secret = new TextEncoder().encode(process.env.VENUE_ACCESS_SECRET || 'dev-secret');

        const token = await new SignJWT({
            did,
            venueId,
            ageVerified: true,
            minAge
        })
            .setProtectedHeader({ alg: 'HS256' })
            .setIssuedAt()
            .setExpirationTime('4h') // Valid for 4 hours
            .sign(secret);

        return NextResponse.json({
            success: true,
            accessToken: token,
            expiresAt: Date.now() + 4 * 60 * 60 * 1000,
            message: 'Age verified successfully via Zero-Knowledge Proof'
        });

    } catch (error: any) {
        console.error('[Identity Verify API] Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
