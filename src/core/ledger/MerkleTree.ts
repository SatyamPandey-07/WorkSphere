/**
 * MerkleTree.ts
 * Implements a Merkle tree to efficiently verify the integrity of large batches of crowdsourced telemetry data.
 * Used to prove that a user submitted a valid dataset before minting loyalty tokens.
 */

import { createHash } from 'crypto';

export class MerkleTree {
    private leaves: string[];
    private layers: string[][];

    constructor(data: string[]) {
        if (data.length === 0) {
            throw new Error('Cannot create Merkle tree from empty dataset');
        }
        this.leaves = data.map(item => this.hash(item));
        this.layers = this.buildTree();
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

    public getProof(leafIndex: number): { position: 'left' | 'right'; hash: string }[] {
        if (leafIndex < 0 || leafIndex >= this.leaves.length) {
            throw new Error('Leaf index out of bounds');
        }

        const proof: { position: 'left' | 'right'; hash: string }[] = [];
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

    public static verify(leafHash: string, proof: { position: 'left' | 'right'; hash: string }[], root: string): boolean {
        let currentHash = leafHash;
        const hashFn = (data: string) => createHash('sha256').update(data).digest('hex');

        for (const node of proof) {
            if (node.position === 'left') {
                currentHash = hashFn(node.hash + currentHash);
            } else {
                currentHash = hashFn(currentHash + node.hash);
            }
        }

        return currentHash === root;
    }
}
