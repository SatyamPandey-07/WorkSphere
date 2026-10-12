/**
 * MerkleTree.ts
 * Implements a Merkle tree to efficiently verify the integrity of large batches of crowdsourced telemetry data.
 * Used to prove that a user submitted a valid dataset before minting loyalty tokens.
 */

import { createHash } from 'crypto';

export interface MerkleProofNode {
    position: 'left' | 'right';
    hash: string;
}

export class MerkleTree {
    private leaves: string[];
    private layers: string[][];

    constructor(data: string[], padToPowerOfTwo: boolean = false) {
        if (data.length === 0) {
            throw new Error('Cannot create Merkle tree from empty dataset');
        }

        let inputData = data;
        if (padToPowerOfTwo && !MerkleTree.isPowerOfTwo(data.length)) {
            inputData = MerkleTree.padToPowerOfTwo(data);
        }

        this.leaves = inputData.map(item => this.hash(item));
        this.layers = this.buildTree();
    }

    /**
     * Checks whether a given integer is a positive power of two (1, 2, 4, 8, 16, ...).
     */
    public static isPowerOfTwo(n: number): boolean {
        return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
    }

    /**
     * Validates that the current tree leaf count is a power of two.
     */
    public validateLeafCountPowerOfTwo(): boolean {
        return MerkleTree.isPowerOfTwo(this.leaves.length);
    }

    /**
     * Pads an array of data elements with duplicates of the last element or an empty leaf
     * until the array length reaches the next power of two.
     */
    public static padToPowerOfTwo(data: string[], padValue?: string): string[] {
        if (data.length === 0) return [];
        if (MerkleTree.isPowerOfTwo(data.length)) return [...data];

        const nextPower = Math.pow(2, Math.ceil(Math.log2(data.length)));
        const padded = [...data];
        const filler = padValue !== undefined ? padValue : data[data.length - 1];

        while (padded.length < nextPower) {
            padded.push(filler);
        }

        return padded;
    }

    /**
     * Validates that a Merkle proof length corresponds exactly to log2(leafCount)
     * when the tree has a power-of-two leaf count.
     */
    public static validateProofLeafCount(
        proof: MerkleProofNode[],
        leafCount: number
    ): boolean {
        if (!MerkleTree.isPowerOfTwo(leafCount)) {
            return false;
        }
        const expectedDepth = Math.log2(leafCount);
        return proof.length === expectedDepth;
    }

    public getLeafCount(): number {
        return this.leaves.length;
    }

    public getLeaves(): string[] {
        return [...this.leaves];
    }

    public getLayers(): string[][] {
        return this.layers.map(layer => [...layer]);
    }

    private hash(data: string): string {
        return createHash('sha256').update(data).digest('hex');
    }

    private buildTree(): string[][] {
        const layers: string[][] = [this.leaves];
        let currentLayer = this.leaves;

        while (currentLayer.length > 1) {
            const nextLayer: string[] = [];
            for (let i = 0; i < currentLayer.length; i += 2) {
                const left = currentLayer[i];
                const right = i + 1 < currentLayer.length ? currentLayer[i + 1] : left;
                nextLayer.push(this.hash(left + right));
            }
            layers.push(nextLayer);
            currentLayer = nextLayer;
        }

        return layers;
    }

    public getRoot(): string {
        return this.layers[this.layers.length - 1][0];
    }

    public getProof(
        leafIndex: number,
        options?: { requirePowerOfTwo?: boolean }
    ): MerkleProofNode[] {
        if (leafIndex < 0 || leafIndex >= this.leaves.length) {
            throw new Error('Leaf index out of bounds');
        }

        if (options?.requirePowerOfTwo && !this.validateLeafCountPowerOfTwo()) {
            throw new Error(
                `Merkle proof generation requires power-of-two leaf count, but tree has ${this.leaves.length} leaves`
            );
        }

        const proof: MerkleProofNode[] = [];
        let currentIndex = leafIndex;

        for (let i = 0; i < this.layers.length - 1; i++) {
            const layer = this.layers[i];
            const isRightNode = currentIndex % 2 === 1;
            const siblingIndex = isRightNode ? currentIndex - 1 : currentIndex + 1;

            if (siblingIndex < layer.length) {
                proof.push({
                    position: isRightNode ? 'left' : 'right',
                    hash: layer[siblingIndex]
                });
            } else {
                // If no sibling, promote self (odd number of nodes in layer)
                proof.push({
                    position: 'right',
                    hash: layer[currentIndex]
                });
            }

            currentIndex = Math.floor(currentIndex / 2);
        }

        return proof;
    }

    public static verify(
        leafHash: string,
        proof: MerkleProofNode[],
        root: string,
        expectedLeafCount?: number
    ): boolean {
        if (!leafHash || !root || !Array.isArray(proof)) {
            return false;
        }

        if (expectedLeafCount !== undefined) {
            if (!MerkleTree.isPowerOfTwo(expectedLeafCount)) {
                return false;
            }
            const expectedProofLength = Math.log2(expectedLeafCount);
            if (proof.length !== expectedProofLength) {
                return false;
            }
        }

        let currentHash = leafHash;
        const hashFn = (data: string) => createHash('sha256').update(data).digest('hex');

        for (const node of proof) {
            if (!node || !node.hash) return false;
            if (node.position === 'left') {
                currentHash = hashFn(node.hash + currentHash);
            } else if (node.position === 'right') {
                currentHash = hashFn(currentHash + node.hash);
            } else {
                return false;
            }
        }

        return currentHash === root;
    }
}
