/**
 * route.ts
 * API endpoint to provision the virtual cards, handle 3D Secure (3DS) 
 * challenge callbacks, and serve transaction statuses.
 */

import { NextRequest, NextResponse } from 'next/server';
import { VirtualCardIssuer } from '@/core/finance/VirtualCardIssuer';
import { WebhookReconciler } from '@/core/finance/WebhookReconciler';
import { ExpenseLedger } from '@/core/ledger/ExpenseLedger';
import { z } from 'zod';

const issuer = new VirtualCardIssuer();
const reconciler = new WebhookReconciler();
const ledger = new ExpenseLedger();

const IssueCardSchema = z.object({
    userId: z.string().uuid(),
    amount: z.number().positive(),
    merchant: z.string().optional(),
    expiresIn: z.number().int().min(60).max(86400).default(3600)
});

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const action = req.nextUrl.searchParams.get('action');

        if (action === 'issue') {
            const parsed = IssueCardSchema.safeParse(body);
            if (!parsed.success) {
                return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
            }

            const { userId, amount, merchant, expiresIn } = parsed.data;

            const card = await issuer.issueCard({
                userId,
                amountLimit: amount,
                currency: 'USD',
                merchantName: merchant,
                expiresInSeconds: expiresIn
            });

            ledger.appendEntry('CARD_ISSUED', card.cardId, { userId, limit: amount });

            // Return masked card details for the frontend
            return NextResponse.json({
                success: true,
                card: {
                    id: card.cardId,
                    last4: card.pan.slice(-4),
                    expiry: `${card.expiryMonth}/${card.expiryYear}`,
                    status: card.status
                }
            });
        }

        if (action === 'webhook') {
            // Handle settlement webhook from BaaS provider
            const result = reconciler.processSettlement(body);
            ledger.appendEntry('SETTLEMENT', body.transactionId, {
                amount: body.settledAmount,
                status: result.status
            });

            return NextResponse.json({ success: true, reconciliation: result });
        }

        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });

    } catch (error: any) {
        console.error('[Finance API] Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function GET(req: NextRequest) {
    const cardId = req.nextUrl.searchParams.get('cardId');

    if (cardId) {
        const history = ledger.getEntriesByReference(cardId);
        return NextResponse.json({ cardId, history });
    }

    // Return overall ledger health and stats
    return NextResponse.json({
        integrityValid: ledger.verifyChainIntegrity(),
        totalEntries: ledger.getLedgerLength(),
        totalSpend: ledger.getTotalSpend(),
        discrepancies: reconciler.getDiscrepancies().length
    });
}
