/**
 * BidCryptography
 * Implements the hashing and commitment schemes required to seal bids so they cannot be viewed until the auction closes.
 */

export interface SealedBid {
    userId: string;
    commitmentHash: string;
    timestamp: number;
}

export class BidCryptography {

    public async sealBid(userId: string, amount: number, salt: string): Promise<SealedBid> {
        const commitmentHash = await this.generateCommitment(userId, amount, salt);
        return {
            userId,
            commitmentHash,
            timestamp: Date.now()
        };
    }

    public async verifyBid(sealed: SealedBid, userId: string, amount: number, salt: string): Promise<boolean> {
        if (sealed.userId !== userId) return false;

        const expectedHash = await this.generateCommitment(userId, amount, salt);
        return sealed.commitmentHash === expectedHash;
    }

    private async generateCommitment(userId: string, amount: number, salt: string): Promise<string> {
        const data = `${userId}:${amount}:${salt}`;
        const encoder = new TextEncoder();
        const dataBuffer = encoder.encode(data);

        // Using Web Crypto API for SHA-256
        const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        return hashHex;
    }

    public generateSalt(): string {
        const array = new Uint8Array(16);
        crypto.getRandomValues(array);
        return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    }
}
