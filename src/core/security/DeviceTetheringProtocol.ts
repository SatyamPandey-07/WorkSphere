/**
 * DeviceTetheringProtocol
 * Manages the cryptographic handshake and session key exchange between the primary and secondary devices.
 * Implements ECDH for key agreement and HMAC for message authentication.
 */

export interface TetherSession {
    sessionId: string;
    primaryKey: CryptoKey | null;
    secondaryKey: CryptoKey | null;
    sharedSecret: CryptoKey | null;
    status: 'INITIATING' | 'HANDSHAKE' | 'ACTIVE' | 'BREACHED';
    createdAt: number;
    lastPing: number;
}

export class DeviceTetheringProtocol {
    private sessions: Map<string, TetherSession> = new Map();
    private readonly KEY_ALGORITHM = { name: 'ECDH', namedCurve: 'P-256' };
    private readonly HMAC_ALGORITHM = { name: 'HMAC', hash: 'SHA-256' };

    public async initiateSession(sessionId: string): Promise<{ publicKey: JsonWebKey }> {
        const keyPair = await crypto.subtle.generateKey(this.KEY_ALGORITHM, true, ['deriveKey', 'deriveBits']);

        const session: TetherSession = {
            sessionId,
            primaryKey: keyPair.privateKey,
            secondaryKey: null,
            sharedSecret: null,
            status: 'INITIATING',
            createdAt: Date.now(),
            lastPing: Date.now()
        };

        this.sessions.set(sessionId, session);

        const publicKey = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
        return { publicKey };
    }

    public async completeHandshake(sessionId: string, secondaryPublicKeyJwk: JsonWebKey): Promise<boolean> {
        const session = this.sessions.get(sessionId);
        if (!session || !session.primaryKey) return false;

        try {
            const secondaryKey = await crypto.subtle.importKey(
                'jwk',
                secondaryPublicKeyJwk,
                this.KEY_ALGORITHM,
                true,
                []
            );

            session.secondaryKey = secondaryKey;

            // Derive shared secret
            const derivedBits = await crypto.subtle.deriveBits(
                { name: 'ECDH', public: secondaryKey },
                session.primaryKey,
                256
            );

            // Import derived bits as an HMAC key for message authentication
            const sharedSecret = await crypto.subtle.importKey(
                'raw',
                derivedBits,
                this.HMAC_ALGORITHM,
                false,
                ['sign', 'verify']
            );

            session.sharedSecret = sharedSecret;
            session.status = 'ACTIVE';
            return true;
        } catch (error) {
            console.error('Handshake failed:', error);
            return false;
        }
    }

    public async signPing(sessionId: string, payload: string): Promise<string | null> {
        const session = this.sessions.get(sessionId);
        if (!session || !session.sharedSecret || session.status !== 'ACTIVE') return null;

        const encoder = new TextEncoder();
        const signature = await crypto.subtle.sign('HMAC', session.sharedSecret, encoder.encode(payload));

        // Convert ArrayBuffer to Hex string
        return Array.from(new Uint8Array(signature))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }

    public async verifyPing(sessionId: string, payload: string, signatureHex: string): Promise<boolean> {
        const session = this.sessions.get(sessionId);
        if (!session || !session.sharedSecret || session.status !== 'ACTIVE') return false;

        const encoder = new TextEncoder();
        const signature = new Uint8Array(signatureHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));

        const isValid = await crypto.subtle.verify('HMAC', session.sharedSecret, signature, encoder.encode(payload));

        if (isValid) {
            session.lastPing = Date.now();
        }

        return isValid;
    }

    public breachSession(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.status = 'BREACHED';
        }
    }

    public getSession(sessionId: string): TetherSession | undefined {
        return this.sessions.get(sessionId);
    }
}
