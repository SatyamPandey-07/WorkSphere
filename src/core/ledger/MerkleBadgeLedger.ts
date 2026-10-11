/**
 * MerkleBadgeLedger.ts
 * Implements a Merkle tree to efficiently store, verify, and issue cryptographic proofs of earned badges.
 * Ensures that achievements are tamper-proof and can be verified without querying a centralized database.
 */

import crypto from 'crypto';

export interface Badge {
    badgeId: string;
    userId: string;
    issuedAt: number;
    questId: string;
}

export interface MerkleProof {
    leaf: string;
    root: string;
    proof: string[];
}

export class MerkleBadgeLedger {
    private badges: Badge[] = [];
    private leafHashes: string[] = [];
    private rootHash: string | null = null;

    constructor() { }

    /**
     * Issues a new badge and updates the Merkle tree.
     */
    public issueBadge(badge: Badge): void {
        this.badges.push(badge);
        this.rebuildTree();
    }

    /**
     * Rebuilds the Merkle tree from the current list of badges.
     */
    private rebuildTree(): void {
        this.leafHashes = this.badges.map(badge => this.hashBadge(badge));
        this.rootHash = this.computeRoot(this.leafHashes);
    }

    /**
     * Generates a SHA-256 hash of a badge object.
     */
    private hashBadge(badge: Badge): string {
        const data = `${badge.badgeId}:${badge.userId}:${badge.issuedAt}:${badge.questId}`;
        return crypto.createHash('sha256').update(data).digest('hex');
    }

    /**
     * Recursively computes the Merkle root from an array of hashes.
     */
    private computeRoot(hashes: string[]): string | null {
        if (hashes.length === 0) return null;
        if (hashes.length === 1) return hashes[0];

        const nextLevel: string[] = [];
        for (let i = 0; i < hashes.length; i += 2) {
            const left = hashes[i];
            const right = hashes[i + 1] || left; // Duplicate last if odd number
            const combined = left + right;
            nextLevel.push(crypto.createHash('sha256').update(combined).digest('hex'));
        }

        return this.computeRoot(nextLevel);
    }

    /**
     * Generates a Merkle proof for a specific badge.
     */
    public generateProof(badgeId: string, userId: string): MerkleProof | null {
        const badgeIndex = this.badges.findIndex(b => b.badgeId === badgeId && b.userId === userId);
        if (badgeIndex === -1) return null;

        const leaf = this.leafHashes[badgeIndex];
        const proof: string[] = [];

        // Simplified proof generation for scaffold
        // In production, traverse the tree to collect sibling hashes
        proof.push(this.leafHashes[badgeIndex === 0 ? 1 : 0]);

        return {
            leaf,
            root: this.rootHash || '',
            proof
        };
    }

    /**
     * Verifies a Merkle proof.
     */
    public static verifyProof(proof: MerkleProof): boolean {
        let currentHash = proof.leaf;

        for (const sibling of proof.proof) {
            const combined = currentHash + sibling;
            currentHash = crypto.createHash('sha256').update(combined).digest('hex');
        }

        return currentHash === proof.root;
    }

    public getRootHash(): string | null {
        return this.rootHash;
    }
}
