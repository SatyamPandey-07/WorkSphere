/**
 * settle/route.ts
 * API endpoint that processes the final cryptographic settlement of a completed time-barter session.
 */
import { NextRequest, NextResponse } from 'next/server';

export interface SettlementRequest {
    agreementId: string;
    providerId: string;
    receiverId: string;
    amountMinutes: number;
    providerSignature: string;
    receiverSignature: string;
    timestamp: number;
}

// Mock ledger
const settledAgreements: Set<string> = new Set();

export async function POST(request: NextRequest) {
    try {
        const body: SettlementRequest = await request.json();
        const {
            agreementId,
            providerId,
            receiverId,
            amountMinutes,
            providerSignature,
            receiverSignature,
            timestamp,
        } = body;

        if (!agreementId || !providerId || !receiverId || !amountMinutes) {
            return NextResponse.json(
                { error: 'Missing required fields' },
                { status: 400 }
            );
        }

        if (settledAgreements.has(agreementId)) {
            return NextResponse.json(
                { error: 'Agreement already settled (double-spend attempt)' },
                { status: 409 }
            );
        }

        // In a real implementation, we would verify the ECDSA signatures here
        // using the IOUCryptographicSigner.verifyIOU method and the users' public keys.

        // Mock verification
        const isProviderSigValid = providerSignature.length === 128; // Hex string length for P-256
        const isReceiverSigValid = receiverSignature.length === 128;

        if (!isProviderSigValid || !isReceiverSigValid) {
            return NextResponse.json(
                { error: 'Invalid cryptographic signatures' },
                { status: 401 }
            );
        }

        // Record settlement
        settledAgreements.add(agreementId);

        // Update user balances in DB
        console.log(`[Settle API] Credited ${amountMinutes} mins to ${providerId}`);
        console.log(`[Settle API] Debited ${amountMinutes} mins from ${receiverId}`);

        return NextResponse.json({
            success: true,
            message: 'Settlement processed successfully',
            data: {
                agreementId,
                settledAt: Date.now(),
            },
        });
    } catch (error: any) {
        console.error('[Settle API] Error processing settlement:', error);
        return NextResponse.json(
            { error: 'Internal server error', details: error.message },
            { status: 500 }
        );
    }
}