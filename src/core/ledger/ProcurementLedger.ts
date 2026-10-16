/**
 * ProcurementLedger.ts
 * Tracks the lifecycle of auto-generated POs from draft to delivery, 
 * reconciling them against digital invoices.
 */

import { PurchaseOrder } from '../inventory/SupplierAutoOrder';

export interface LedgerEvent {
    timestamp: number;
    poId: string;
    action: 'CREATED' | 'SENT' | 'CONFIRMED' | 'DELIVERED' | 'INVOICE_MATCHED' | 'DISPUTED';
    metadata?: any;
}

export class ProcurementLedger {
    private events: LedgerEvent[] = [];
    private activePOs: Map<string, PurchaseOrder> = new Map();

    public recordEvent(poId: string, action: LedgerEvent['action'], metadata?: any): void {
        const event: LedgerEvent = {
            timestamp: Date.now(),
            poId,
            action,
            metadata
        };

        this.events.push(event);

        const po = this.activePOs.get(poId);
        if (po && action === 'DELIVERED') {
            po.status = 'DELIVERED';
        }
    }

    public registerPO(po: PurchaseOrder): void {
        this.activePOs.set(po.poId, po);
        this.recordEvent(po.poId, 'CREATED', { totalValue: po.totalValue, supplier: po.supplierId });
    }

    public reconcileInvoice(poId: string, invoiceAmount: number, deliveredItems: { sku: string; qty: number }[]): { matched: boolean; variance: number } {
        const po = this.activePOs.get(poId);
        if (!po) return { matched: false, variance: 0 };

        let expectedAmount = 0;
        let qtyMismatch = false;

        for (const poItem of po.items) {
            const delivered = deliveredItems.find(d => d.sku === poItem.sku);
            if (!delivered || delivered.qty !== poItem.quantity) {
                qtyMismatch = true;
            }
            expectedAmount += poItem.unitPrice * (delivered ? delivered.qty : 0);
        }

        const variance = Math.abs(invoiceAmount - expectedAmount);
        const matched = variance < 0.05 && !qtyMismatch;

        if (matched) {
            this.recordEvent(poId, 'INVOICE_MATCHED', { invoiceAmount });
        } else {
            this.recordEvent(poId, 'DISPUTED', { invoiceAmount, expectedAmount, variance });
        }

        return { matched, variance };
    }

    public getPOHistory(poId: string): LedgerEvent[] {
        return this.events.filter(e => e.poId === poId);
    }

    public getActivePOs(): PurchaseOrder[] {
        return Array.from(this.activePOs.values()).filter(po => po.status !== 'DELIVERED');
    }

    public getTotalSpendThisMonth(): number {
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        return this.events
            .filter(e => e.action === 'INVOICE_MATCHED' && e.timestamp >= startOfMonth.getTime())
            .reduce((sum, e) => sum + (e.metadata?.invoiceAmount || 0), 0);
    }
}
