/**
 * VirtualCardIssuer.ts
 * Interfaces with banking-as-a-service APIs to generate single-use 
 * virtual card numbers with strict merchant-category locks.
 */

export interface CardRequest {
    userId: string;
    amountLimit: number;
    currency: string;
    merchantCategoryCode?: string; // MCC restriction
    merchantName?: string; // Specific merchant restriction
    expiresInSeconds: number;
}

export interface VirtualCard {
    cardId: string;
    pan: string; // Primary Account Number (masked in logs, full in secure memory)
    cvv: string;
    expiryMonth: string;
    expiryYear: string;
    status: 'ACTIVE' | 'USED' | 'EXPIRED' | 'REVOKED';
    limit: number;
    createdAt: number;
    expiresAt: number;
    restrictions: {
        mcc?: string;
        merchantName?: string;
    };
}

export class VirtualCardIssuer {
    private activeCards: Map<string, VirtualCard> = new Map();
    private binPrefix: string = '424242'; // Mock Visa BIN

    public async issueCard(request: CardRequest): Promise<VirtualCard> {
        const cardId = crypto.randomUUID();
        const pan = this.generatePAN();
        const cvv = this.generateCVV();
        const { month, year } = this.generateExpiry(request.expiresInSeconds);

        const card: VirtualCard = {
            cardId,
            pan,
            cvv,
            expiryMonth: month,
            expiryYear: year,
            status: 'ACTIVE',
            limit: request.amountLimit,
            createdAt: Date.now(),
            expiresAt: Date.now() + (request.expiresInSeconds * 1000),
            restrictions: {
                mcc: request.merchantCategoryCode,
                merchantName: request.merchantName
            }
        };

        this.activeCards.set(cardId, card);

        // In production, this calls the BaaS API (e.g., Stripe Issuing, Marqeta)
        console.log(`[CardIssuer] Provisioned card ${cardId} for user ${request.userId} with limit ${request.amountLimit}`);

        return card;
    }

    private generatePAN(): string {
        // Generate 15 random digits + 1 check digit (Luhn)
        let pan = this.binPrefix;
        for (let i = 0; i < 9; i++) {
            pan += Math.floor(Math.random() * 10);
        }
        pan += this.calculateLuhnCheckDigit(pan);
        return pan;
    }

    private calculateLuhnCheckDigit(num: string): number {
        let sum = 0;
        let isEven = true;

        for (let i = num.length - 1; i >= 0; i--) {
            let digit = parseInt(num[i], 10);
            if (isEven) {
                digit *= 2;
                if (digit > 9) digit -= 9;
            }
            sum += digit;
            isEven = !isEven;
        }

        return (10 - (sum % 10)) % 10;
    }

    private generateCVV(): string {
        return Math.floor(100 + Math.random() * 900).toString();
    }

    private generateExpiry(seconds: number): { month: string; year: string } {
        const date = new Date(Date.now() + seconds * 1000);
        return {
            month: (date.getMonth() + 1).toString().padStart(2, '0'),
            year: date.getFullYear().toString().slice(-2)
        };
    }

    public validateAuthorization(cardId: string, amount: number, merchantMCC: string, merchantName: string): { approved: boolean; reason?: string } {
        const card = this.activeCards.get(cardId);
        if (!card) return { approved: false, reason: 'Card not found' };

        if (card.status !== 'ACTIVE') return { approved: false, reason: `Card is ${card.status}` };
        if (Date.now() > card.expiresAt) {
            card.status = 'EXPIRED';
            return { approved: false, reason: 'Card expired' };
        }
        if (amount > card.limit) return { approved: false, reason: 'Exceeds single-use limit' };

        if (card.restrictions.mcc && card.restrictions.mcc !== merchantMCC) {
            return { approved: false, reason: 'MCC restricted' };
        }

        if (card.restrictions.merchantName && !merchantName.toLowerCase().includes(card.restrictions.merchantName.toLowerCase())) {
            return { approved: false, reason: 'Merchant restricted' };
        }

        // Approve and mark as used (single-use)
        card.status = 'USED';
        return { approved: true };
    }

    public revokeCard(cardId: string): boolean {
        const card = this.activeCards.get(cardId);
        if (card && card.status === 'ACTIVE') {
            card.status = 'REVOKED';
            return true;
        }
        return false;
    }
}
