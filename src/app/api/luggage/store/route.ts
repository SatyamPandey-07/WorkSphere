import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { LuggageLockerProtocol } from '@/core/iot/LuggageLockerProtocol';
import { P2PLuggageEscrow, EscrowState } from '@/core/trust/P2PLuggageEscrow';

const storageRequestSchema = z.object({
    guestId: z.string().uuid(),
    hostId: z.string().uuid(),
    lockerId: z.string().min(5),
    amount: z.number().positive(),
    currency: z.string().length(3),
});

const protocol = new LuggageLockerProtocol(process.env.LOCKER_SECRET_KEY || '0'.repeat(64));
const escrow = new P2PLuggageEscrow();

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const validation = storageRequestSchema.safeParse(body);

        if (!validation.success) {
            return NextResponse.json({ error: 'Invalid request', details: validation.error.flatten() }, { status: 400 });
        }

        const { guestId, hostId, lockerId, amount, currency } = validation.data;

        const escrowRecord = escrow.proposeEscrow(guestId, hostId, lockerId, amount, currency);

        const mockTxHash = `0x${crypto.randomUUID().replace(/-/g, '')}`;
        escrow.fundEscrow(escrowRecord.id, mockTxHash);

        const hostSig = `SIG_${crypto.randomUUID()}`;
        escrow.activateStorage(escrowRecord.id, hostSig);

        const unlockToken = protocol.generateToken(lockerId, guestId, escrowRecord.id);

        await triggerIoTUnlock(lockerId, unlockToken);

        return NextResponse.json({
            success: true,
            escrowId: escrowRecord.id,
            state: escrowRecord.state,
            unlockToken,
            expiresAt: unlockToken.payload.expiresAt,
        }, { status: 201 });

    } catch (error) {
        console.error('Luggage storage API error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

async function triggerIoTUnlock(lockerId: string, token: any): Promise<void> {
    console.log(`Triggering IoT unlock for locker ${lockerId} with token signature: ${token.signature}`);
    await new Promise(resolve => setTimeout(resolve, 100));
}

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');

    if (!userId) {
        return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const activeEscrows = escrow.getActiveEscrowsForUser(userId);
    return NextResponse.json({ escrows: activeEscrows }, { status: 200 });
}
