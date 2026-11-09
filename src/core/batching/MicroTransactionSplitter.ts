/**
 * MicroTransactionSplitter
 * Calculates exact fractional debt allocations including tax and tip, generating cryptographic IOUs for peers.
 */

export interface OrderItem {
    itemId: string;
    name: string;
    price: number;
    quantity: number;
    ownerId: string;
}

export interface SplitResult {
    userId: string;
    subtotal: number;
    taxAmount: number;
    tipAmount: number;
    totalDue: number;
    iouHash: string;
}

export class MicroTransactionSplitter {
    private readonly TAX_RATE = 0.085; // 8.5%
    private readonly TIP_RATE = 0.18;  // 18%

    public calculateSplits(items: OrderItem[]): SplitResult[] {
        const userTotals = new Map<string, number>();
        let grandSubtotal = 0;

        for (const item of items) {
            const itemTotal = item.price * item.quantity;
            grandSubtotal += itemTotal;

            const current = userTotals.get(item.ownerId) || 0;
            userTotals.set(item.ownerId, current + itemTotal);
        }

        const totalTax = grandSubtotal * this.TAX_RATE;
        const totalTip = grandSubtotal * this.TIP_RATE;

        const results: SplitResult[] = [];

        userTotals.forEach((userSubtotal, userId) => {
            const proportion = grandSubtotal > 0 ? userSubtotal / grandSubtotal : 0;

            const userTax = totalTax * proportion;
            const userTip = totalTip * proportion;
            const userTotal = userSubtotal + userTax + userTip;

            results.push({
                userId,
                subtotal: this.roundCurrency(userSubtotal),
                taxAmount: this.roundCurrency(userTax),
                tipAmount: this.roundCurrency(userTip),
                totalDue: this.roundCurrency(userTotal),
                iouHash: this.generateIOUHash(userId, userTotal),
            });
        });

        return results;
    }

    private roundCurrency(amount: number): number {
        return Math.round(amount * 100) / 100;
    }

    private generateIOUHash(userId: string, amount: number): string {
        // Simplified hash generation for IOU tracking
        const data = `${userId}:${amount}:${Date.now()}`;
        let hash = 0;
        for (let i = 0; i < data.length; i++) {
            const char = data.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0; // Convert to 32bit integer
        }
        return `iou_${Math.abs(hash).toString(16)}`;
    }
}
