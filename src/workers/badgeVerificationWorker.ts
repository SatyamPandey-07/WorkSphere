/**
 * badgeVerificationWorker.ts
 * Web Worker that performs the SHA-256 hashing and Merkle proof validation for badge redemption.
 * Offloads cryptographic verification to keep the main thread responsive during UI interactions.
 */

import { MerkleProof, MerkleBadgeLedger } from '@/core/ledger/MerkleBadgeLedger';

self.onmessage = (event: MessageEvent) => {
    const { type, payload } = event.data;

    if (type === 'VERIFY_BADGE_PROOF') {
        try {
            const proof = payload as MerkleProof;

            // Perform verification
            const isValid = MerkleBadgeLedger.verifyProof(proof);

            self.postMessage({
                type: 'VERIFICATION_RESULT',
                payload: {
                    isValid,
                    badgeId: proof.leaf // Simplified for scaffold
                }
            });
        } catch (error) {
            self.postMessage({
                type: 'ERROR',
                error: error instanceof Error ? error.message : 'Verification failed'
            });
        }
    }
};
