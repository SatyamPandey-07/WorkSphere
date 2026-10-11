/**
 * route.ts
 * API endpoint that verifies the Merkle proof and applies the associated venue perks to the user's profile.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { MerkleBadgeLedger, MerkleProof } from '@/core/ledger/MerkleBadgeLedger';

// In-memory ledger for scaffold
const ledger = new MerkleBadgeLedger();

export async function POST(request: NextRequest) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { proof, venueId } = body as { proof: MerkleProof; venueId: string };

        if (!proof || !venueId) {
            return NextResponse.json({ error: 'Missing proof or venueId' }, { status: 400 });
        }

        // 1. Verify the Merkle proof
        const isValid = MerkleBadgeLedger.verifyProof(proof);
        if (!isValid) {
            return NextResponse.json({ error: 'Invalid cryptographic proof' }, { status: 403 });
        }

        // 2. Apply venue perks (Mock)
        // In production: await prisma.userPerk.create({ data: { userId, venueId, perkType: 'DISCOUNT_10' } });

        return NextResponse.json({
            success: true,
            message: 'Badge verified. Premium venue perks unlocked.',
            perkApplied: '10% discount on next booking'
        }, { status: 200 });

    } catch (error) {
        console.error('Badge claim API error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
