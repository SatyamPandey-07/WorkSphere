/**
 * WebhookReconciler.ts
 * Ingests payment settlement webhooks and mathematically matches them 
 * against pending OCR receipt payloads to detect discrepancies.
 */

export interface SettlementWebhook {
    transactionId: string;
    cardId: string;
    authorizedAmount: number;
    settledAmount: number;
    currency: string;
    merchantName: string;
    timestamp: number;
    tipAmount?: number;
    taxAmount?: number;
}

export interface OCRReceiptData {
    receiptId: string;
    cardId: string;
    extractedTotal: number;
    extractedSubtotal: number;
    extractedTax: number;
    lineItems: { description: string; amount: number }[];
    confidence: number;
    timestamp: number;
}

export interface ReconciliationResult {
    status: 'MATCHED' | 'DISCREPANCY' | 'PENDING_OCR' | 'PENDING_SETTLEMENT';
    transactionId: string;
    variance: number;
    flags: string[];
}

export class WebhookReconciler {
    private pendingSettlements: Map<string, SettlementWebhook> = new Map();
    private pendingReceipts: Map<string, OCRReceiptData> = new Map();
    private reconciled: Map<string, ReconciliationResult> = new Map();

    public processSettlement(webhook: SettlementWebhook): ReconciliationResult {
        this.pendingSettlements.set(webhook.cardId, webhook);
        return this.attemptReconciliation(webhook.cardId);
    }

    public processOCRReceipt(receipt: OCRReceiptData): ReconciliationResult {
        this.pendingReceipts.set(receipt.cardId, receipt);
        return this.attemptReconciliation(receipt.cardId);
    }

    private attemptReconciliation(cardId: string): ReconciliationResult {
        const settlement = this.pendingSettlements.get(cardId);
        const receipt = this.pendingReceipts.get(cardId);

        if (!settlement) {
            return { status: 'PENDING_SETTLEMENT', transactionId: '', variance: 0, flags: [] };
        }

        if (!receipt) {
            return { status: 'PENDING_OCR', transactionId: settlement.transactionId, variance: 0, flags: [] };
        }

        // Both available, perform mathematical reconciliation
        const flags: string[] = [];
        let variance = 0;

        // 1. Check Total vs Settled Amount
        const totalDiff = Math.abs(settlement.settledAmount - receipt.extractedTotal);
        if (totalDiff > 0.05) { // Allow 5 cent rounding variance
            variance = totalDiff;
            flags.push(`TOTAL_MISMATCH: Settled ${settlement.settledAmount} vs Receipt ${receipt.extractedTotal}`);
        }

        // 2. Check Tax amounts
        if (settlement.taxAmount && receipt.extractedTax) {
            const taxDiff = Math.abs(settlement.taxAmount - receipt.extractedTax);
            if (taxDiff > 0.05) {
                flags.push(`TAX_MISMATCH: Gateway ${settlement.taxAmount} vs Receipt ${receipt.extractedTax}`);
            }
        }

        // 3. Check Tip (Settled amount often includes tip, authorized amount does not)
        const expectedTip = settlement.settledAmount - settlement.authorizedAmount;
        if (expectedTip > 0 && !settlement.tipAmount) {
            flags.push(`UNDECLARED_TIP: ${expectedTip} added post-authorization`);
        }

        // 4. Check OCR Confidence
        if (receipt.confidence < 0.85) {
            flags.push(`LOW_OCR_CONFIDENCE: ${receipt.confidence}`);
        }

        // 5. Line item sum check
        const lineItemSum = receipt.lineItems.reduce((sum, item) => sum + item.amount, 0);
        if (Math.abs(lineItemSum - receipt.extractedSubtotal) > 0.10) {
            flags.push(`LINE_ITEM_SUM_MISMATCH: Items sum to ${lineItemSum}, Subtotal is ${receipt.extractedSubtotal}`);
        }

        const result: ReconciliationResult = {
            status: flags.length > 0 ? 'DISCREPANCY' : 'MATCHED',
            transactionId: settlement.transactionId,
            variance,
            flags
        };

        this.reconciled.set(settlement.transactionId, result);
        this.pendingSettlements.delete(cardId);
        this.pendingReceipts.delete(cardId);

        return result;
    }

    public getDiscrepancies(): ReconciliationResult[] {
        return Array.from(this.reconciled.values()).filter(r => r.status === 'DISCREPANCY');
    }
}
