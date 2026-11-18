import { NextRequest, NextResponse } from 'next/server';
import { CoffeeRunEscrow } from '@/core/batching/CoffeeRunEscrow';
import { MicroTransactionSplitter, OrderItem } from '@/core/batching/MicroTransactionSplitter';

const escrowManager = new CoffeeRunEscrow();
const splitter = new MicroTransactionSplitter();

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { action, userId, venueId, threshold, items, batchId } = body;

        if (action === 'CREATE') {
            if (!userId || !venueId || !threshold) {
                return NextResponse.json({ error: 'Missing required fields for creation' }, { status: 400 });
            }
            const batch = escrowManager.createBatch(userId, venueId, threshold);
            return NextResponse.json({ success: true, batchId: batch.batchId });
        }

        if (action === 'JOIN') {
            if (!batchId || !userId || !items) {
                return NextResponse.json({ error: 'Missing required fields for joining' }, { status: 400 });
            }

            const splits = splitter.calculateSplits(items as OrderItem[]);
            const userSplit = splits.find(s => s.userId === userId);

            if (!userSplit) {
                return NextResponse.json({ error: 'User not found in split calculation' }, { status: 400 });
            }

            const joined = escrowManager.joinBatch(batchId, userId, userSplit.totalDue);
            if (!joined) {
                return NextResponse.json({ error: 'Failed to join batch (expired or locked)' }, { status: 400 });
            }

            return NextResponse.json({ success: true, split: userSplit });
        }

        if (action === 'EXECUTE') {
            if (!batchId) return NextResponse.json({ error: 'batchId required' }, { status: 400 });
            const executed = escrowManager.executeBatch(batchId);
            return NextResponse.json({ success: executed });
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    } catch (error) {
        console.error('Batch Order API Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
