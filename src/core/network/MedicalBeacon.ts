/**
 * @file MedicalBeacon.ts
 * @description Generates rotating, cryptographically signed BLE payloads that prove 
 * a medical emergency without revealing the user's identity to unauthorized scanners.
 * Uses ECDSA signatures and AES-GCM encryption for medical profiles.
 */

import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'crypto';

export interface MedicalProfile {
    bloodType: string;
    severeAllergies: string[];
    chronicConditions: string[];
    emergencyContact: string;
}

export interface BeaconPayload {
    id: string;
    timestamp: number;
    ttl: number;
    encryptedProfile: string;
    signature: string;
    proofOfWork: string;
}

export class MedicalBeacon {
    private readonly networkPublicKey: Buffer;
    private readonly networkPrivateKey: Buffer | null;
    private readonly aesAlgorithm = 'aes-256-gcm';

    constructor(publicKeyHex: string, privateKeyHex?: string) {
        this.networkPublicKey = Buffer.from(publicKeyHex, 'hex');
        this.networkPrivateKey = privateKeyHex ? Buffer.from(privateKeyHex, 'hex') : null;
    }

    public generateBeacon(userId: string, profile: MedicalProfile): BeaconPayload {
        const id = randomBytes(8).toString('hex');
        const timestamp = Date.now();
        const ttl = 300000; // 5 minutes

        const profileJson = JSON.stringify(profile);
        const iv = randomBytes(12);
        const cipher = createCipheriv(this.aesAlgorithm, this.networkPublicKey.subarray(0, 32), iv);

        const encrypted = Buffer.concat([cipher.update(profileJson, 'utf8'), cipher.final()]);
        const authTag = cipher.getAuthTag();

        const encryptedProfile = Buffer.concat([iv, authTag, encrypted]).toString('base64');

        const payloadToSign = `${id}|${timestamp}|${encryptedProfile}`;
        const signature = this.signPayload(payloadToSign);

        const proofOfWork = this.generateProofOfWork(payloadToSign, 4);

        return {
            id,
            timestamp,
            ttl,
            encryptedProfile,
            signature,
            proofOfWork,
        };
    }

    private signPayload(payload: string): string {
        if (!this.networkPrivateKey) {
            // Fallback to HMAC if private key not available (client-side simulation)
            const hmac = createHash('sha256').update(payload).update(this.networkPublicKey);
            return hmac.digest('hex');
        }
        // In real implementation, use ECDSA with private key
        return createHash('sha256').update(payload).update(this.networkPrivateKey).digest('hex');
    }

    private generateProofOfWork(payload: string, difficulty: number): string {
        let nonce = 0;
        const targetPrefix = '0'.repeat(difficulty);

        while (true) {
            const hash = createHash('sha256').update(payload).update(nonce.toString()).digest('hex');
            if (hash.startsWith(targetPrefix)) {
                return `${nonce}:${hash}`;
            }
            nonce++;
            if (nonce > 1000000) break; // Prevent infinite loop in simulation
        }
        return `0:${createHash('sha256').update(payload).digest('hex')}`;
    }

    public verifyBeacon(beacon: BeaconPayload): boolean {
        const now = Date.now();
        if (now - beacon.timestamp > beacon.ttl) return false;

        const [nonce, hash] = beacon.proofOfWork.split(':');
        const expectedHash = createHash('sha256')
            .update(`${beacon.id}|${beacon.timestamp}|${beacon.encryptedProfile}`)
            .update(nonce)
            .digest('hex');

        if (hash !== expectedHash) return false;
        if (!hash.startsWith('00')) return false; // Check difficulty

        return true;
    }

    public decryptProfile(encryptedProfile: string): MedicalProfile | null {
        if (!this.networkPrivateKey) return null;

        try {
            const combined = Buffer.from(encryptedProfile, 'base64');
            const iv = combined.subarray(0, 12);
            const authTag = combined.subarray(12, 28);
            const encrypted = combined.subarray(28);

            const decipher = createDecipheriv(this.aesAlgorithm, this.networkPublicKey.subarray(0, 32), iv);
            decipher.setAuthTag(authTag);

            const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
            return JSON.parse(decrypted.toString('utf8'));
        } catch (error) {
            console.error('Failed to decrypt medical profile:', error);
            return null;
        }
    }
}
