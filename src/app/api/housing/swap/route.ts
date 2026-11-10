import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { HousingSwapEscrow, SwapState } from '@/core/ledger/HousingSwapEscrow';
import { DigitalKeyHandover } from '@/core/iot/DigitalKeyHandover';

const proposeSchema = z.object({
    partyA: z.object({
        userId: z.string().uuid(),
        propertyId: z.string(),
        publicKey: z.string(),
        depositAmount: z.number().positive(),
    }),
    partyB: z.object({
        userId: z.string().uuid(),
        propertyId: z.string(),
        publicKey: z.string(),
        depositAmount: z.number().positive(),
    }),
    startDate: z.number().int().positive(),
    endDate: z.number().int().positive(),
});

const actionSchema = z.object({
    swapId: z.string(),
    userId: z.string().uuid(),
    action: z.enum(['fund', 'exchange', 'settle', 'dispute']),
    signature: z.string().optional(),
    reason: z.string().optional(),
});

const escrow = new HousingSwapEscrow();
const keyHandover = new DigitalKeyHandover(process.env.HOUSING_MASTER_SECRET || '0'.repeat(64));

export async function POST(req: NextRequest) {
    const url = new URL(req.url);
    const path = url.pathname.split('/').pop();

    try {
        if (path === 'propose') {
            return await handlePropose(req);
        } else if (path === 'action') {
            return await handleAction(req);
        } else if (path === 'batch-sync') {
            return await handleBatchSync(req);
        } else if (path === 'disputes') {
            return await handleDisputeCheck(req);
        }

        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    } catch (error: any) {
        console.error('Housing swap API error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}

async function handlePropose(req: NextRequest) {
    const body = await req.json();
    const validation = proposeSchema.safeParse(body);
    if (!validation.success) {
        return NextResponse.json({ error: 'Invalid payload', details: validation.error.flatten() }, { status: 400 });
    }

    const { partyA, partyB, startDate, endDate } = validation.data;
    const record = escrow.proposeSwap(partyA, partyB, startDate, endDate);

    return NextResponse.json({ success: true, swapId: record.id, state: record.state }, { status: 201 });
}

async function handleAction(req: NextRequest) {
    const body = await req.json();
    const validation = actionSchema.safeParse(body);
    if (!validation.success) {
        return NextResponse.json({ error: 'Invalid payload', details: validation.error.flatten() }, { status: 400 });
    }

    const { swapId, userId, action, signature, reason } = validation.data;
    let record;

    switch (action) {
        case 'fund':
            record = escrow.fundSwap(swapId, userId, signature || '');
            break;
        case 'exchange':
            record = escrow.confirmKeyExchange(swapId, userId, signature || '');
            if (record.state === SwapState.KEYS_EXCHANGED) {
                // Trigger atomic digital key handover
                const hostCred = keyHandover.generateTemporaryCredential(record.partyA.propertyId, record.partyB.userId, record.startDate, record.endDate);
                const guestCred = keyHandover.generateTemporaryCredential(record.partyB.propertyId, record.partyA.userId, record.startDate, record.endDate);
                keyHandover.executeAtomicTransfer(hostCred, guestCred);
            }
            break;
        case 'settle':
            record = escrow.settleSwap(swapId, userId, signature || '');
            break;
        case 'dispute':
            record = escrow.disputeSwap(swapId, userId, reason || 'No reason provided');
            break;
    }

    return NextResponse.json({ success: true, state: record!.state, record }, { status: 200 });
}

async function handleBatchSync(req: NextRequest) {
    const body = await req.json();
    // In a real app, this would sync with a global DB or blockchain
    return NextResponse.json({ updatedRecords: body.records || [] }, { status: 200 });
}

async function handleDisputeCheck(req: NextRequest) {
    const body = await req.json();
    // Mock dispute check
    return NextResponse.json({ disputedIds: [] }, { status: 200 });
}
