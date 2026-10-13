/**
 * rent/route.ts
 * API endpoint to process rental transactions, deduct loyalty tokens, 
 * and trigger the smart-lock provisioning.
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

export interface RentalRequest {
    userId: string;
    equipmentId: string;
    durationHours: number;
    paymentMethod: 'tokens' | 'fiat';
}

export interface RentalResponse {
    rentalId: string;
    unlockToken: string;
    expiresAt: number;
    totalCost: number;
}

// Mock database / service calls
async function checkEquipmentAvailability(equipmentId: string): Promise<boolean> {
    // In reality, query EquipmentInventoryGraph or DB
    return true;
}

async function deductTokens(userId: string, amount: number): Promise<boolean> {
    // In reality, update user ledger
    console.log(`[Rent API] Deducted ${amount} tokens from ${userId}`);
    return true;
}

async function generateUnlockToken(rentalId: string, equipmentId: string, userId: string, expiresAt: number): Promise<string> {
    // In reality, call SmartLockProtocol.generateToken
    return `mock-token-${rentalId}-${equipmentId}`;
}

export async function POST(request: NextRequest) {
    try {
        const body: RentalRequest = await request.json();
        const { userId, equipmentId, durationHours, paymentMethod } = body;

        if (!userId || !equipmentId || !durationHours) {
            return NextResponse.json(
                { error: 'Missing required fields' },
                { status: 400 }
            );
        }

        const isAvailable = await checkEquipmentAvailability(equipmentId);
        if (!isAvailable) {
            return NextResponse.json(
                { error: 'Equipment is not available' },
                { status: 409 }
            );
        }

        // Calculate cost (mock: 10 tokens per hour)
        const hourlyRate = 10;
        const totalCost = durationHours * hourlyRate;

        if (paymentMethod === 'tokens') {
            const success = await deductTokens(userId, totalCost);
            if (!success) {
                return NextResponse.json(
                    { error: 'Insufficient token balance' },
                    { status: 402 }
                );
            }
        }

        const rentalId = randomUUID();
        const expiresAt = Date.now() + durationHours * 60 * 60 * 1000;

        const unlockToken = await generateUnlockToken(rentalId, equipmentId, userId, expiresAt);

        // Update equipment state to RENTED in DB/Graph
        console.log(`[Rent API] Equipment ${equipmentId} marked as RENTED for rental ${rentalId}`);

        const response: RentalResponse = {
            rentalId,
            unlockToken,
            expiresAt,
            totalCost,
        };

        return NextResponse.json({ success: true, data: response });
    } catch (error: any) {
        console.error('[Rent API] Error processing rental:', error);
        return NextResponse.json(
            { error: 'Internal server error', details: error.message },
            { status: 500 }
        );
    }
}
