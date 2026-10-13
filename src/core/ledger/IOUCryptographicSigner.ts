/**
 * IOUCryptographicSigner.ts
 * Generates and verifies ECDSA signatures for time-credits, ensuring IOUs 
 * cannot be forged or double-spent. Uses Web Crypto API.
 */

export interface IOUPayload {
    agreementId: string;
    providerId: string;
    receiverId: string;
    amountMinutes: number;
    timestamp: number;
    nonce: string;
}

export class IOUCryptographicSigner {
    private algorithm = { name: 'ECDSA', namedCurve: 'P-256' };
    private keyPair: CryptoKeyPair | null = null;

    constructor(private userId: string) { }

    public async generateKeyPair(): Promise<void> {
        if (this.keyPair) return;

        this.keyPair = await crypto.subtle.generateKey(
            this.algorithm,
            true, // extractable (for saving to local storage)
            ['sign', 'verify']
        );
    }

    public async exportPublicKey(): Promise<string> {
        if (!this.keyPair) {
            await this.generateKeyPair();
        }

        const exported = await crypto.subtle.exportKey('spki', this.keyPair!.publicKey);
        const b64 = btoa(String.fromCharCode(...new Uint8Array(exported)));
        return b64;
    }

    public async importPublicKey(b64Key: string): Promise<CryptoKey> {
        const binaryDer = Uint8Array.from(atob(b64Key), c => c.charCodeAt(0));
        return crypto.subtle.importKey(
            'spki',
            binaryDer,
            this.algorithm,
            false,
            ['verify']
        );
    }

    private async getPrivateKey(): Promise<CryptoKey> {
        if (!this.keyPair) {
            await this.generateKeyPair();
        }
        return this.keyPair!.privateKey;
    }

    private encodePayload(payload: IOUPayload): Uint8Array {
        const str = JSON.stringify({
            agreementId: payload.agreementId,
            providerId: payload.providerId,
            receiverId: payload.receiverId,
            amountMinutes: payload.amountMinutes,
            timestamp: payload.timestamp,
            nonce: payload.nonce,
        });
        return new TextEncoder().encode(str);
    }

    public async signIOU(payload: IOUPayload): Promise<string> {
        const privateKey = await this.getPrivateKey();
        const data = this.encodePayload(payload);

        const signature = await crypto.subtle.sign(
            { name: 'ECDSA', hash: 'SHA-256' },
            privateKey,
            data
        );

        // Convert ArrayBuffer to hex string
        const hashArray = Array.from(new Uint8Array(signature));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return hashHex;
    }

    public async verifyIOU(
        payload: IOUPayload,
        signatureHex: string,
        publicKeyB64: string
    ): Promise<boolean> {
        try {
            const publicKey = await this.importPublicKey(publicKeyB64);
            const data = this.encodePayload(payload);

            // Convert hex string back to ArrayBuffer
            const signatureBytes = new Uint8Array(signatureHex.length / 2);
            for (let i = 0; i < signatureHex.length; i += 2) {
                signatureBytes[i / 2] = parseInt(signatureHex.substr(i, 2), 16);
            }

            const isValid = await crypto.subtle.verify(
                { name: 'ECDSA', hash: 'SHA-256' },
                publicKey,
                signatureBytes,
                data
            );

            return isValid;
        } catch (err) {
            console.error('[IOU Signer] Verification failed:', err);
            return false;
        }
    }

    public generateNonce(): string {
        const array = new Uint8Array(16);
        crypto.getRandomValues(array);
        return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
    }
}
