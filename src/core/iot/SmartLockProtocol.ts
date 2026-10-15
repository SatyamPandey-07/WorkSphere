/**
 * SmartLockProtocol.ts
 * Handles the generation and validation of time-bound cryptographic unlock tokens for IoT hardware.
 * Uses HMAC-SHA256 based TOTP (Time-based One-Time Password) logic.
 */

export interface UnlockTokenPayload {
    lockerId: string;
    userId: string;
    rentalId: string;
    expiresAt: number;
}

export class SmartLockProtocol {
    private secretKey: CryptoKey | null = null;
    private algorithm = { name: 'HMAC', hash: 'SHA-256' };

    constructor(private base64Secret: string) { }

    private async importKey(): Promise<void> {
        if (this.secretKey) return;

        const keyData = Uint8Array.from(atob(this.base64Secret), c => c.charCodeAt(0));
        this.secretKey = await crypto.subtle.importKey(
            'raw',
            keyData,
            this.algorithm,
            false,
            ['sign', 'verify']
        );
    }

    private async sign(data: Uint8Array): Promise<ArrayBuffer> {
        await this.importKey();
        return crypto.subtle.sign(this.algorithm, this.secretKey!, data);
    }

    private arrayBufferToHex(buffer: ArrayBuffer): string {
        return Array.from(new Uint8Array(buffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }

    private hexToArrayBuffer(hex: string): ArrayBuffer {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
            bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
        }
        return bytes.buffer;
    }

    public async generateToken(payload: UnlockTokenPayload): Promise<string> {
        const dataStr = JSON.stringify({
            lockerId: payload.lockerId,
            userId: payload.userId,
            rentalId: payload.rentalId,
            expiresAt: payload.expiresAt,
        });

        const dataBuffer = new TextEncoder().encode(dataStr);
        const signatureBuffer = await this.sign(dataBuffer);
        const signatureHex = this.arrayBufferToHex(signatureBuffer);

        // Format: base64(payload).hex(signature)
        const payloadBase64 = btoa(dataStr);
        return `${payloadBase64}.${signatureHex}`;
    }

    public async verifyToken(token: string, expectedLockerId: string): Promise<UnlockTokenPayload | null> {
        try {
            const [payloadBase64, signatureHex] = token.split('.');
            if (!payloadBase64 || !signatureHex) return null;

            const dataStr = atob(payloadBase64);
            const payload: UnlockTokenPayload = JSON.parse(dataStr);

            // Check expiration
            if (Date.now() > payload.expiresAt) {
                console.warn('[SmartLock] Token expired');
                return null;
            }

            // Check locker ID match
            if (payload.lockerId !== expectedLockerId) {
                console.warn('[SmartLock] Locker ID mismatch');
                return null;
            }

            // Verify signature
            const dataBuffer = new TextEncoder().encode(dataStr);
            const signatureBuffer = this.hexToArrayBuffer(signatureHex);

            await this.importKey();
            const isValid = await crypto.subtle.verify(
                this.algorithm,
                this.secretKey!,
                signatureBuffer,
                dataBuffer
            );

            if (!isValid) {
                console.warn('[SmartLock] Invalid signature');
                return null;
            }

            return payload;
        } catch (err) {
            console.error('[SmartLock] Token verification failed:', err);
            return null;
        }
    }
}
