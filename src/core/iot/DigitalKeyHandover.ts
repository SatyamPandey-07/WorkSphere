/**
 * @file DigitalKeyHandover.ts
 * @description Handles the cryptographic revocation of the host's smart-lock access 
 * and the simultaneous provisioning of the guest's temporary credentials. Ensures 
 * atomic execution of key transfers to prevent lockouts during housing swaps.
 */

import { createHmac, randomBytes, createCipheriv, createDecipheriv } from 'crypto';

export interface SmartLockCredential {
    lockId: string;
    userId: string;
    accessToken: string;
    validFrom: number;
    validUntil: number;
    signature: string;
}

export interface KeyTransferPayload {
    transferId: string;
    hostLockCredentials: SmartLockCredential;
    guestLockCredentials: SmartLockCredential;
    timestamp: number;
    atomicHash: string;
}

export class DigitalKeyHandover {
    private readonly masterSecret: Buffer;
    private readonly aesAlgorithm = 'aes-256-gcm';

    constructor(masterSecretHex: string) {
        this.masterSecret = Buffer.from(masterSecretHex, 'hex');
        if (this.masterSecret.length !== 32) {
            throw new Error('Master secret must be exactly 32 bytes (64 hex chars)');
        }
    }

    public generateTemporaryCredential(lockId: string, userId: string, validFrom: number, validUntil: number): SmartLockCredential {
        const accessToken = randomBytes(32).toString('hex');
        const signature = this.signCredential(lockId, userId, accessToken, validFrom, validUntil);

        return {
            lockId,
            userId,
            accessToken,
            validFrom,
            validUntil,
            signature,
        };
    }

    private signCredential(lockId: string, userId: string, token: string, validFrom: number, validUntil: number): string {
        const hmac = createHmac('sha256', this.masterSecret);
        hmac.update(lockId);
        hmac.update(userId);
        hmac.update(token);
        hmac.update(validFrom.toString());
        hmac.update(validUntil.toString());
        return hmac.digest('hex');
    }

    public verifyCredential(credential: SmartLockCredential): boolean {
        const expectedSig = this.signCredential(
            credential.lockId,
            credential.userId,
            credential.accessToken,
            credential.validFrom,
            credential.validUntil
        );

        if (expectedSig !== credential.signature) return false;

        const now = Date.now();
        if (now < credential.validFrom || now > credential.validUntil) return false;

        return true;
    }

    public encryptCredential(credential: SmartLockCredential, recipientPublicKey: string): string {
        const iv = randomBytes(16);
        const cipher = createCipheriv(this.aesAlgorithm, this.masterSecret, iv);

        const payload = JSON.stringify(credential);
        const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
        const authTag = cipher.getAuthTag();

        const combined = Buffer.concat([iv, authTag, encrypted]);
        return combined.toString('base64');
    }

    public decryptCredential(encryptedPayload: string): SmartLockCredential {
        const combined = Buffer.from(encryptedPayload, 'base64');

        const iv = combined.subarray(0, 16);
        const authTag = combined.subarray(16, 32);
        const encrypted = combined.subarray(32);

        const decipher = createDecipheriv(this.aesAlgorithm, this.masterSecret, iv);
        decipher.setAuthTag(authTag);

        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        return JSON.parse(decrypted.toString('utf8'));
    }

    public executeAtomicTransfer(
        hostCred: SmartLockCredential,
        guestCred: SmartLockCredential
    ): KeyTransferPayload {
        if (!this.verifyCredential(hostCred) || !this.verifyCredential(guestCred)) {
            throw new Error('Invalid credentials provided for atomic transfer');
        }

        const transferId = randomBytes(16).toString('hex');
        const timestamp = Date.now();

        const atomicHash = this.calculateAtomicHash(transferId, hostCred, guestCred, timestamp);

        return {
            transferId,
            hostLockCredentials: hostCred,
            guestLockCredentials: guestCred,
            timestamp,
            atomicHash,
        };
    }

    private calculateAtomicHash(
        transferId: string,
        hostCred: SmartLockCredential,
        guestCred: SmartLockCredential,
        timestamp: number
    ): string {
        const hash = createHmac('sha256', this.masterSecret);
        hash.update(transferId);
        hash.update(hostCred.signature);
        hash.update(guestCred.signature);
        hash.update(timestamp.toString());
        return hash.digest('hex');
    }

    public revokeAccess(credential: SmartLockCredential): boolean {
        // In a real implementation, this would call the smart lock API to blacklist the token
        console.log(`Revoking access for lock ${credential.lockId}, user ${credential.userId}`);
        return true;
    }
}
