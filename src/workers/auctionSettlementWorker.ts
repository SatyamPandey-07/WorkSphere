/**
 * Auction Settlement Worker
 * Processes the final bid reveals, resolves ties mathematically, and executes the token transfers.
 */

interface SettlementRequest {
    type: 'SETTLE_AUCTION';
    auctionId: string;
    reveals: Array<{
        userId: string;
        amount: number;
        salt: string;
        commitmentHash: string;
    }>;
}

interface SettlementResult {
    type: 'SETTLEMENT_COMPLETE';
    auctionId: string;
    winnerId: string;
    pricePaid: number;
    transfers: Array<{ from: string, to: string, amount: number }>;
}

self.onmessage = async (event: MessageEvent<SettlementRequest>) => {
    if (event.data.type === 'SETTLE_AUCTION') {
        const { auctionId, reveals } = event.data;

        // 1. Verify hashes locally in the worker to prevent main thread blocking
        const validBids = await verifyAllBids(reveals);

        if (validBids.length === 0) {
            self.postMessage({ type: 'SETTLEMENT_FAILED', auctionId, reason: 'No valid bids' });
            return;
        }

        // 2. Sort and resolve ties
        validBids.sort((a, b) => b.amount - a.amount);

        let winner = validBids[0];

        // Tie-breaker: If amounts are equal, the earlier timestamp (simulated by array index here) wins
        if (validBids.length > 1 && validBids[0].amount === validBids[1].amount) {
            // In a real system, we'd compare the sealed.timestamp
            winner = validBids[0];
        }

        // 3. Calculate Vickrey Price (Second highest)
        const secondHighest = validBids.length > 1 ? validBids[1].amount : winner.amount;

        // 4. Generate Token Transfer Instructions
        const transfers = [
            { from: winner.userId, to: 'VENUE_ESCROW', amount: secondHighest }
        ];

        const result: SettlementResult = {
            type: 'SETTLEMENT_COMPLETE',
            auctionId,
            winnerId: winner.userId,
            pricePaid: secondHighest,
            transfers
        };

        self.postMessage(result);
    }
};

async function verifyAllBids(reveals: SettlementRequest['reveals']) {
    const valid = [];
    const encoder = new TextEncoder();

    for (const reveal of reveals) {
        const data = `${reveal.userId}:${reveal.amount}:${reveal.salt}`;
        const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        if (hashHex === reveal.commitmentHash) {
            valid.push({ userId: reveal.userId, amount: reveal.amount });
        }
    }

    return valid;
}

export { };
