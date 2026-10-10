/**
 * route.ts
 * API endpoint to check token balances and validate signatures for desk booking redemptions.
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { walletAddress, signature, amountToRedeem } = body;

        if (!walletAddress || !signature || !amountToRedeem) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // Mock signature verification and balance check
        // In production: verify Ed25519 signature and query ledger

        const mockBalance = 150;
        const isSignatureValid = signature.startsWith('valid_sig_');

        if (!isSignatureValid) {
            return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
        }

        if (mockBalance < amountToRedeem) {
            return NextResponse.json({ error: 'Insufficient token balance' }, { status: 402 });
        }

        return NextResponse.json({
            success: true,
            message: 'Redemption authorized',
            newBalance: mockBalance - amountToRedeem
        }, { status: 200 });

    } catch (error) {
        console.error('Token verification error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
