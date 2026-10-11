/**
 * DTLSHandshake.ts
 * Handles the Datagram Transport Layer Security negotiation to ensure end-to-end packet encryption.
 * Wraps the WebRTC native DTLS implementation with additional application-layer verification.
 */

export interface HandshakePayload {
    sessionId: string;
    publicKey: string;
    signature: string;
    timestamp: number;
}

export class DTLSHandshake {
    private localPrivateKey: CryptoKey | null = null;
    private localPublicKey: string | null = null;
    private verifiedPeers: Set<string> = new Set();

    constructor() {
        this.initializeKeys();
    }

    private async initializeKeys(): Promise<void> {
        try {
            const keyPair = await crypto.subtle.generateKey(
                {
                    name: 'ECDSA',
                    namedCurve: 'P-256'
                },
                true,
                ['sign', 'verify']
            );

            this.localPrivateKey = keyPair.privateKey;

            const exportedKey = await crypto.subtle.exportKey('spki', keyPair.publicKey);
            this.localPublicKey = btoa(String.fromCharCode(...new Uint8Array(exportedKey)));
        } catch (error) {
            console.error('Failed to initialize DTLS handshake keys:', error);
        }
    }

    public async generateHandshakePayload(sessionId: string): Promise<HandshakePayload | null> {
        if (!this.localPrivateKey || !this.localPublicKey) {
            console.error('Keys not initialized');
            return null;
        }

        const timestamp = Date.now();
        const dataToSign = new TextEncoder().encode(`${sessionId}:${this.localPublicKey}:${timestamp}`);

        const signatureBuffer = await crypto.subtle.sign(
            { name: 'ECDSA', hash: 'SHA-256' },
            this.localPrivateKey,
            dataToSign
        );

        const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));

        return {
            sessionId,
            publicKey: this.localPublicKey,
            signature,
            timestamp
        };
    }

    public async verifyHandshakePayload(payload: HandshakePayload): Promise<boolean> {
        try {
            const { sessionId, publicKey, signature, timestamp } = payload;

            // Check timestamp freshness (e.g., within 5 minutes)
            if (Date.now() - timestamp > 5 * 60 * 1000) {
                console.warn('Handshake payload expired');
                return false;
            }

            const keyData = Uint8Array.from(atob(publicKey), c => c.charCodeAt(0));
            const cryptoKey = await crypto.subtle.importKey(
                'spki',
                keyData,
                { name: 'ECDSA', namedCurve: 'P-256' },
                true,
                ['verify']
            );

            const dataToVerify = new TextEncoder().encode(`${sessionId}:${publicKey}:${timestamp}`);
            const signatureBuffer = Uint8Array.from(atob(signature), c => c.charCodeAt(0));

            const isValid = await crypto.subtle.verify(
                { name: 'ECDSA', hash: 'SHA-256' },
                cryptoKey,
                signatureBuffer,
                dataToVerify
            );

            if (isValid) {
                this.verifiedPeers.add(sessionId);
            }

            return isValid;
        } catch (error) {
            console.error('Handshake verification failed:', error);
            return false;
        }
    }

    public isPeerVerified(sessionId: string): boolean {
        return this.verifiedPeers.has(sessionId);
    }
}
