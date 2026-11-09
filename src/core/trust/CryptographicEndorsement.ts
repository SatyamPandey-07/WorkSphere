/**
 * Handles the ECDSA signature generation and verification to ensure 
 * skill endorsements cannot be forged.
 * 
 * Note: In a browser environment, this uses the Web Crypto API.
 */

export class CryptographicEndorsement {

    /**
     * Generates an ECDSA signature for an endorsement payload.
     */
    public static async signEndorsement(
        privateKey: CryptoKey,
        payload: { endorseeId: string; skill: string; timestamp: number }
    ): Promise<string> {
        const encoder = new TextEncoder();
        const data = encoder.encode(JSON.stringify(payload));

        const signature = await window.crypto.subtle.sign(
            { name: 'ECDSA', hash: { name: 'SHA-256' } },
            privateKey,
            data
        );

        return btoa(String.fromCharCode(...new Uint8Array(signature)));
    }

    /**
     * Verifies the ECDSA signature against the endorser's public key.
     */
    public static async verifyEndorsement(
        publicKey: CryptoKey,
        payload: { endorseeId: string; skill: string; timestamp: number },
        signatureB64: string
    ): Promise<boolean> {
        const encoder = new TextEncoder();
        const data = encoder.encode(JSON.stringify(payload));

        const signature = Uint8Array.from(atob(signatureB64), c => c.charCodeAt(0));

        return await window.crypto.subtle.verify(
            { name: 'ECDSA', hash: { name: 'SHA-256' } },
            publicKey,
            signature,
            data
        );
    }

    /**
     * Generates a new ECDSA key pair for the user.
     */
    public static async generateKeyPair(): Promise<CryptoKeyPair> {
        return await window.crypto.subtle.generateKey(
            { name: 'ECDSA', namedCurve: 'P-256' },
            true,
            ['sign', 'verify']
        );
    }
}
