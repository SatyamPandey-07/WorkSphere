/**
 * @file LuggageLockerProtocol.ts
 * @description Handles the generation, signing, and validation of time-bound 
 * cryptographic unlock tokens for physical IoT baggage lockers. Ensures that 
 * only the authorized user can open the locker within the escrow window.
 */

import { createHmac, randomBytes, createHash } from 'crypto';

export interface LockerTokenPayload {
    lockerId: string;
    userId: string;
    escrowId: string;
    issuedAt: number;
    expiresAt: number;
    nonce: string;
}

export interface SignedToken {
    payload: string;
    signature: string;
}

export class LuggageLockerProtocol {
    private readonly secretKey: Buffer;
    private readonly tokenTTL: number;

    constructor(secretKey: string, tokenTTLMinutes: number = 5) {
        this.secretKey = Buffer.from(secretKey, 'hex');
        if (this.secretKey.length < 32) {
            throw new Error('Secret key must be at least 32 bytes');
        }
        this.tokenTTL = tokenTTLMinutes * 60 * 1000;
    }

    public generateToken(lockerId: string, userId: string, escrowId: string): SignedToken {
        const now = Date.now();
        const nonce = randomBytes(16).toString('hex');

        const payload: LockerTokenPayload = {
            lockerId,
            userId,
            escrowId,
            issuedAt: now,
            expiresAt: now + this.tokenTTL,
            nonce,
        };

        const payloadStr = JSON.stringify(payload);
        const payloadBase64 = Buffer.from(payloadStr).toString('base64url');
        const signature = this.signPayload(payloadBase64);

        return {
            payload: payloadBase64,
            signature,
        };
    }

    private signPayload(payloadBase64: string): string {
        const hmac = createHmac('sha256', this.secretKey);
        hmac.update(payloadBase64);
        return hmac.digest('base64url');
    }

    public validateToken(token: SignedToken, expectedUserId: string, expectedLockerId: string): { valid: boolean; payload?: LockerTokenPayload; error?: string } {
        try {
            const expectedSignature = this.signPayload(token.payload);

            if (!this.constantTimeEqual(expectedSignature, token.signature)) {
                return { valid: false, error: 'Invalid signature' };
            }

            const payloadStr = Buffer.from(token.payload, 'base64url').toString('utf-8');
            const payload: LockerTokenPayload = JSON.parse(payloadStr);

            if (payload.userId !== expectedUserId) {
                return { valid: false, error: 'User ID mismatch' };
            }

            if (payload.lockerId !== expectedLockerId) {
                return { valid: false, error: 'Locker ID mismatch' };
            }

            const now = Date.now();
            if (now < payload.issuedAt) {
                return { valid: false, error: 'Token issued in the future' };
            }

            if (now > payload.expiresAt) {
                return { valid: false, error: 'Token expired' };
            }

            return { valid: true, payload };
        } catch (error) {
            return { valid: false, error: 'Malformed token' };
        }
    }

    private constantTimeEqual(a: string, b: string): boolean {
        if (a.length !== b.length) return false;
        const bufA = Buffer.from(a);
        const bufB = Buffer.from(b);
        let result = 0;
        for (let i = 0; i < bufA.length; i++) {
            result |= bufA[i] ^ bufB[i];
        }
        return result === 0;
    }

    public hashLockerState(lockerId: string, state: string): string {
        const hash = createHash('sha256');
        hash.update(lockerId);
        hash.update(state);
        hash.update(this.secretKey);
        return hash.digest('hex');
    }
}
