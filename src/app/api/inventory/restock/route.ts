/**
 * route.ts
 * API endpoint to securely proxy POS data, trigger the forecasting 
 * batch jobs, and finalize supplier transactions.
 */

import { NextRequest, NextResponse } from 'next/server';
import { DepletionForecaster } from '@/core/inventory/DepletionForecaster';
import { SupplierAutoOrder } from '@/core/inventory/SupplierAutoOrder';
import { ProcurementLedger } from '@/core/ledger/ProcurementLedger';
import { z } from 'zod';

const forecaster = new DepletionForecaster();
const autoOrder = new SupplierAutoOrder();
const ledger = new ProcurementLedger();

// Mock supplier setup
autoOrder.registerSupplier({
    id: 'sup-1', name: 'Local Dairy Co', supportedSKUs: ['OAT-MILK-1L'],
    leadTimeHours: 12, minimumOrderValue: 50, reliabilityScore: 0.95, apiEndpoint: 'https://api.dairy.com'
});
autoOrder.setSKUPrice('OAT-MILK-1L', 4.50);

const POSSchema = z.object({
    timestamp: z.number(),
    items: z.array(z.object({ sku: z.string(), quantity: z.number() }))
});

export async function POST(req: NextRequest) {
    try {
        const action = req.nextUrl.searchParams.get('action');
        const body = await req.json();

        if (action === 'pos-ingest') {
            const parsed = POSSchema.safeParse(body);
            if (!parsed.success) return NextResponse.json({ error: 'Invalid POS data' }, { status: 400 });

            // In a real app, this would message the Worker. Here we update the forecaster directly for demo.
            for (const item of parsed.data.items) {
                // Mocking historical data update
                const mockHistory = Array(168).fill(0).map(() => Math.floor(Math.random() * 5));
                forecaster.updateItem({
                    sku: item.sku,
                    name: item.sku,
                    currentStock: 20 - item.quantity,
                    unit: 'units',
                    historicalUsage: mockHistory
                });
            }
            return NextResponse.json({ success: true });
        }

        if (action === 'run-forecast') {
            const criticalItems = forecaster.getCriticalItems(24);
            if (criticalItems.length === 0) {
                return NextResponse.json({ message: 'No critical items require restocking.' });
            }

            const pos = autoOrder.generatePurchaseOrders(criticalItems);
            for (const po of pos) {
                ledger.registerPO(po);
                await autoOrder.dispatchPO(po);
                ledger.recordEvent(po.poId, 'SENT');
            }

            return NextResponse.json({
                success: true,
                purchaseOrdersGenerated: pos.length,
                totalValue: pos.reduce((sum, po) => sum + po.totalValue, 0)
            });
        }

        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });

    } catch (error: any) {
        console.error('[Inventory API] Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
