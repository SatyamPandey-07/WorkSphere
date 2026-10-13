/**
 * route.ts
 * API endpoint that verifies the PoW and mints loyalty tokens to the user's cryptographic wallet.
 */

import { NextRequest, NextResponse } from 'next/server';
import { ProofOfWorkValidator, PoWSubmission } from '@/core/ledger/ProofOfWorkValidator';
import { MerkleTree } from '@/core/ledger/MerkleTree';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { submission, telemetryData, walletAddress } = body;

        if (!submission || !telemetryData || !walletAddress) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // Reconstruct Merkle root from submitted data to verify the PoW is for the correct dataset
        const tree = new MerkleTree(telemetryData);
        const calculatedRoot = tree.getRoot();

        if (calculatedRoot !== submission.merkleRoot) {
            return NextResponse.json({ error: 'Merkle root mismatch' }, { status: 403 });
        }

        const validator = new ProofOfWorkValidator();
        const isValidPoW = validator.validate(submission as PoWSubmission);

        if (!isValidPoW) {
            return NextResponse.json({ error: 'Invalid Proof-of-Work' }, { status: 403 });
        }

        // Mock token minting logic
        const tokensMinted = 10;
        const transactionId = `tx_${crypto.randomUUID()}`;

        return NextResponse.json({
            success: true,
            transactionId,
            tokensMinted,
            walletAddress
        }, { status: 200 });

    } catch (error) {
        console.error('Token minting error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
