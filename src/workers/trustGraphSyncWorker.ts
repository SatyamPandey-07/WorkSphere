import { WebOfTrustGraph, TrustEdge } from '../core/trust/WebOfTrustGraph';

let graph: WebOfTrustGraph;

self.onmessage = (event: MessageEvent) => {
    const { type, payload } = event.data;

    if (type === 'INIT') {
        graph = new WebOfTrustGraph();
        payload.nodes.forEach((n: any) => graph.addNode(n));
        payload.edges.forEach((e: any) => graph.addEndorsement(e));
        self.postMessage({ type: 'READY' });
    }

    if (type === 'ADD_ENDORSEMENT') {
        const edge = payload as TrustEdge;
        graph.addEndorsement(edge);

        // Calculate Merkle root of the local ledger for P2P sync
        const merkleRoot = calculateMerkleRoot(Array.from(graph['edges'].values()).flat());

        self.postMessage({
            type: 'GRAPH_UPDATED',
            payload: { edge, merkleRoot }
        });
    }

    if (type === 'CALCULATE_TRUST') {
        const { targetUserId, skill, anchorIds } = payload;
        const rank = graph.calculateTrustRank(targetUserId, skill, anchorIds);

        self.postMessage({
            type: 'TRUST_RANK_RESULT',
            payload: { targetUserId, skill, rank }
        });
    }
};

// Simple Merkle Root calculation for ledger integrity verification
function calculateMerkleRoot(edges: TrustEdge[]): string {
    if (edges.length === 0) return '';

    let hashes = edges.map(e => hashString(JSON.stringify(e)));

    while (hashes.length > 1) {
        const nextLevel = [];
        for (let i = 0; i < hashes.length; i += 2) {
            const left = hashes[i];
            const right = i + 1 < hashes.length ? hashes[i + 1] : left;
            nextLevel.push(hashString(left + right));
        }
        hashes = nextLevel;
    }

    return hashes[0];
}

function hashString(str: string): string {
    // Simple hash for worker context (Production should use Web Crypto SHA-256)
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash |= 0;
    }
    return hash.toString(16);
}
