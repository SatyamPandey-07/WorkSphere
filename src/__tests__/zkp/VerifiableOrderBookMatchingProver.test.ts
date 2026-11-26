import { describe, it, expect } from 'vitest';
import { VerifiableOrderBookMatchingProver } from '../../core/zkp/VerifiableOrderBookMatchingProver';

describe('VerifiableOrderBookMatchingProver', () => {
  const dex = new VerifiableOrderBookMatchingProver();

  it('executes price-time priority matching, isolates forged orders, and verifies spread & fill conservation', () => {
    const alice = dex.createTrader('alice');
    const bob = dex.createTrader('bob');
    const carol = dex.createTrader('carol');

    const b1 = dex.signOrder(alice, { orderId: 'b1', marketId: 'ETH-USDC', side: 'BID', limitPrice: 3100n, quantity: 5n, timestampSeq: 1 });
    const b2 = dex.signOrder(carol, { orderId: 'b2', marketId: 'ETH-USDC', side: 'BID', limitPrice: 3000n, quantity: 10n, timestampSeq: 3 });
    const a1 = dex.signOrder(bob, { orderId: 'a1', marketId: 'ETH-USDC', side: 'ASK', limitPrice: 3050n, quantity: 3n, timestampSeq: 2 });
    const a2 = dex.signOrder(bob, { orderId: 'a2', marketId: 'ETH-USDC', side: 'ASK', limitPrice: 3080n, quantity: 4n, timestampSeq: 4 });
    const forged = { ...dex.signOrder(carol, { orderId: 'bad', marketId: 'ETH-USDC', side: 'ASK', limitPrice: 2900n, quantity: 1n, timestampSeq: 5 }), sigS: 123n };

    const { proof, rejectedOrderIds } = dex.matchBatchAndProve('ETH-USDC', 'batch-1', [b1, b2, a1, a2, forged]);
    expect(rejectedOrderIds).toEqual(['bad']);
    expect(proof.fills.length).toBe(2);
    expect(proof.totalMatchedVolume).toBe(5n); // b1 (5) completely filled against a1 (3) + a2 (2)
    expect(dex.verifyClearingBatch(proof)).toBe(true);

    // Remaining resting book: b2 (BID @ 3000, qty 10) and a2 (ASK @ 3080, qty 2) -> uncrossed spread!
    expect(proof.restingBook.length).toBe(2);

    // Tampered execution price above bid limit fails verification
    const badPrice = { ...proof, fills: [{ ...proof.fills[0], executionPrice: 3200n }, proof.fills[1]] };
    expect(dex.verifyClearingBatch(badPrice)).toBe(false);
    expect(dex.verifyClearingBatch({ ...proof, totalMatchedVolume: 6n })).toBe(false);

    const json = JSON.parse(dex.serializeClearing(proof)) as { fillCount: number; totalMatchedVolume: string };
    expect(json.fillCount).toBe(2);
    expect(json.totalMatchedVolume).toBe('5');
  });
});
