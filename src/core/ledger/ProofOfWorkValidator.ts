/**
 * ProofOfWorkValidator.ts
 * Validates the cryptographic effort required to submit venue data, preventing spam and bot submissions.
 * Ensures the client has expended CPU cycles to find a valid nonce for the Merkle root.
 */

import { createHash } from 'crypto';

export interface PoWSubmission {
    merkleRoot: string;
    nonce: string;
    difficulty: number; // Number of leading zeros required
    timestamp: number;
}

export class ProofOfWorkValidator {
    private maxAgeMs: number;

    constructor(maxAgeMs: number = 3600000) { // 1 hour default
        this.maxAgeMs = maxAgeMs;
    }

    private hash(data: string): string {
        return createHash('sha256').update(data).digest('hex');
    }

    /**
     * Validates if the submitted nonce produces a hash with the required number of leading zeros.
     */
    public validate(submission: PoWSubmission): boolean {
        // Check timestamp validity
        const now = Date.now();
        if (now - submission.timestamp > this.maxAgeMs) {
            console.warn('PoW submission expired');
            return false;
        }

        const payload = submission.merkleRoot + submission.nonce + submission.timestamp.toString();
        const hashResult = this.hash(payload);

        // Check leading zeros
        const leadingZerosRegex = new RegExp(`^0{${submission.difficulty}}`);
        if (!leadingZerosRegex.test(hashResult)) {
            console.warn('PoW hash does not meet difficulty requirement');
            return false;
        }

        return true;
    }

    /**
     * Calculates the dynamic difficulty based on network load or spam rate.
     */
    public static calculateDifficulty(baseDifficulty: number, spamMultiplier: number): number {
        return Math.min(Math.max(baseDifficulty + Math.floor(spamMultiplier), 1), 8);
    }
}
