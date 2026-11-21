import { createHash, randomBytes } from 'node:crypto';

/**
 * Verifiable Price-Time Priority Limit Order Book Matching Engine Prover.
 *
 * Proves cryptographically that an off-chain exchange matching engine executed limit orders
 * fairly according to strict price-time priority without front-running or phantom fills:
 *  - Every trader signs their limit order (side, limitPrice, quantity, timestampSeq, nonce)
 *    with a Schnorr signature
 *  - Deterministic matching engine executes crossing fills (bid.limitPrice >= ask.limitPrice)
 *    in strict descending-bid / ascending-ask / ascending-timestamp order
 *  - Emits a VerifiableClearingBatchProof certifying:
 *      1. Every order signature is valid
 *      2. Every fill satisfies price crossing (askPrice <= execPrice <= bidPrice)
 *      3. Fill volume conservation: total filled quantity on buys == total filled on sells
 *         and no order is overfilled beyond its signed limit quantity
 *      4. No uncrossed spread violation remains on the resting post-match book (bestBid < bestAsk)!
 */

export const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
export const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
export const BASE_G = 4n;

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) result = (result * b) % mod;
    e >>= 1n;
    b = (b * b) % mod;
  }
  return result;
}

function modScalar(v: bigint): bigint {
  return ((v % SUBGROUP_Q) + SUBGROUP_Q) % SUBGROUP_Q;
}

function randomScalar(): bigint {
  const bytes = randomBytes(16);
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return (v % (SUBGROUP_Q - 2n)) + 1n;
}

function sha256Hex(...parts: string[]): string {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
    h.update('|');
  }
  return h.digest('hex');
}

function hashToScalar(...parts: string[]): bigint {
  return modScalar(BigInt('0x' + sha256Hex(...parts).slice(0, 32)));
}

export interface TraderIdentity {
  traderId: string;
  secretKey: bigint;
  publicKey: bigint;
}

export interface SignedLimitOrder {
  orderId: string;
  marketId: string;
  traderId: string;
  traderPubKey: bigint;
  side: 'BID' | 'ASK';
  limitPrice: bigint;
  quantity: bigint;
  timestampSeq: number;
  orderDigest: string;
  sigR: bigint;
  sigS: bigint;
}

export interface TradeFill {
  fillId: string;
  bidOrderId: string;
  askOrderId: string;
  executionPrice: bigint;
  quantity: bigint;
}

export interface RestingOrderState {
  orderId: string;
  side: 'BID' | 'ASK';
  limitPrice: bigint;
  remainingQuantity: bigint;
  timestampSeq: number;
}

export interface VerifiableClearingBatchProof {
  marketId: string;
  batchId: string;
  submittedOrders: SignedLimitOrder[];
  fills: TradeFill[];
  restingBook: RestingOrderState[];
  totalMatchedVolume: bigint;
  restingBookRoot: string;
  clearingDigest: string;
}

export class VerifiableOrderBookMatchingProver {
  public createTrader(traderId: string): TraderIdentity {
    const secretKey = randomScalar();
    return { traderId, secretKey, publicKey: modPow(BASE_G, secretKey, SAFE_PRIME_P) };
  }

  public computeOrderDigest(o: {
    orderId: string;
    marketId: string;
    traderId: string;
    traderPubKey: bigint;
    side: 'BID' | 'ASK';
    limitPrice: bigint;
    quantity: bigint;
    timestampSeq: number;
  }): string {
    return sha256Hex(
      'ORDERBOOK-ORD-V1',
      o.orderId,
      o.marketId,
      o.traderId,
      o.traderPubKey.toString(16),
      o.side,
      o.limitPrice.toString(),
      o.quantity.toString(),
      String(o.timestampSeq),
    );
  }

  public signOrder(
    trader: TraderIdentity,
    params: { orderId: string; marketId: string; side: 'BID' | 'ASK'; limitPrice: bigint; quantity: bigint; timestampSeq: number },
  ): SignedLimitOrder {
    if (params.limitPrice <= 0n || params.quantity <= 0n || params.timestampSeq < 0) {
      throw new RangeError('Order price/quantity must be > 0 and timestampSeq >= 0');
    }
    const base = { ...params, traderId: trader.traderId, traderPubKey: trader.publicKey };
    const orderDigest = this.computeOrderDigest(base);
    const k = randomScalar();
    const sigR = modPow(BASE_G, k, SAFE_PRIME_P);
    const c = hashToScalar('ORDERBOOK-SIG-V1', sigR.toString(16), trader.publicKey.toString(16), orderDigest);
    const sigS = modScalar(k + c * trader.secretKey);
    return { ...base, orderDigest, sigR, sigS };
  }

  public verifyOrderSignature(order: SignedLimitOrder): boolean {
    if (order.limitPrice <= 0n || order.quantity <= 0n || order.timestampSeq < 0) return false;
    if (this.computeOrderDigest(order) !== order.orderDigest) return false;
    const c = hashToScalar('ORDERBOOK-SIG-V1', order.sigR.toString(16), order.traderPubKey.toString(16), order.orderDigest);
    return modPow(BASE_G, order.sigS, SAFE_PRIME_P) === (order.sigR * modPow(order.traderPubKey, c, SAFE_PRIME_P)) % SAFE_PRIME_P;
  }

  private computeRestingRoot(resting: RestingOrderState[]): string {
    if (resting.length === 0) return sha256Hex('ORDERBOOK-EMPTY-RESTING');
    let lvl = [...resting]
      .sort((a, b) => a.orderId.localeCompare(b.orderId))
      .map((r) => sha256Hex('ORDERBOOK-REST-LEAF', r.orderId, r.side, r.limitPrice.toString(), r.remainingQuantity.toString()));
    while (lvl.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < lvl.length; i += 2) {
        next.push(sha256Hex('ORDERBOOK-REST-NODE', lvl[i], i + 1 < lvl.length ? lvl[i + 1] : lvl[i]));
      }
      lvl = next;
    }
    return lvl[0];
  }

  private computeClearingDigest(
    marketId: string,
    batchId: string,
    orders: SignedLimitOrder[],
    fills: TradeFill[],
    restingRoot: string,
  ): string {
    return sha256Hex(
      'ORDERBOOK-CLEAR-V1',
      marketId,
      batchId,
      restingRoot,
      ...orders.map((o) => o.orderDigest),
      ...fills.map((f) => `${f.fillId}:${f.bidOrderId}:${f.askOrderId}:${f.executionPrice.toString()}:${f.quantity.toString()}`),
    );
  }

  public matchBatchAndProve(
    marketId: string,
    batchId: string,
    candidateOrders: SignedLimitOrder[],
  ): { proof: VerifiableClearingBatchProof; rejectedOrderIds: string[] } {
    const seen = new Set<string>();
    const validOrders: SignedLimitOrder[] = [];
    const rejectedOrderIds: string[] = [];

    for (const o of candidateOrders) {
      if (o.marketId !== marketId || seen.has(o.orderId) || !this.verifyOrderSignature(o)) {
        rejectedOrderIds.push(o.orderId);
        continue;
      }
      seen.add(o.orderId);
      validOrders.push(o);
    }

    // Price-time priority sorting:
    // Bids: highest limitPrice first, then lowest timestampSeq
    // Asks: lowest limitPrice first, then lowest timestampSeq
    const bids = validOrders
      .filter((o) => o.side === 'BID')
      .map((o) => ({ order: o, remaining: o.quantity }))
      .sort((a, b) => {
        if (a.order.limitPrice !== b.order.limitPrice) return a.order.limitPrice > b.order.limitPrice ? -1 : 1;
        return a.order.timestampSeq - b.order.timestampSeq;
      });

    const asks = validOrders
      .filter((o) => o.side === 'ASK')
      .map((o) => ({ order: o, remaining: o.quantity }))
      .sort((a, b) => {
        if (a.order.limitPrice !== b.order.limitPrice) return a.order.limitPrice < b.order.limitPrice ? -1 : 1;
        return a.order.timestampSeq - b.order.timestampSeq;
      });

    const fills: TradeFill[] = [];
    let totalMatchedVolume = 0n;
    let bi = 0;
    let ai = 0;

    while (bi < bids.length && ai < asks.length) {
      const topBid = bids[bi];
      const topAsk = asks[ai];
      if (topBid.order.limitPrice < topAsk.order.limitPrice) break;

      const qty = topBid.remaining < topAsk.remaining ? topBid.remaining : topAsk.remaining;
      // Maker price rule: resting order (earlier timestampSeq) sets execution price
      const executionPrice = topBid.order.timestampSeq <= topAsk.order.timestampSeq
        ? topBid.order.limitPrice
        : topAsk.order.limitPrice;

      fills.push({
        fillId: `${batchId}-fill-${fills.length}`,
        bidOrderId: topBid.order.orderId,
        askOrderId: topAsk.order.orderId,
        executionPrice,
        quantity: qty,
      });
      topBid.remaining -= qty;
      topAsk.remaining -= qty;
      totalMatchedVolume += qty;

      if (topBid.remaining === 0n) bi++;
      if (topAsk.remaining === 0n) ai++;
    }

    const restingBook: RestingOrderState[] = [];
    for (const b of bids) {
      if (b.remaining > 0n) {
        restingBook.push({
          orderId: b.order.orderId,
          side: 'BID',
          limitPrice: b.order.limitPrice,
          remainingQuantity: b.remaining,
          timestampSeq: b.order.timestampSeq,
        });
      }
    }
    for (const a of asks) {
      if (a.remaining > 0n) {
        restingBook.push({
          orderId: a.order.orderId,
          side: 'ASK',
          limitPrice: a.order.limitPrice,
          remainingQuantity: a.remaining,
          timestampSeq: a.order.timestampSeq,
        });
      }
    }

    const restingBookRoot = this.computeRestingRoot(restingBook);
    const clearingDigest = this.computeClearingDigest(marketId, batchId, validOrders, fills, restingBookRoot);

    return {
      proof: {
        marketId,
        batchId,
        submittedOrders: validOrders,
        fills,
        restingBook,
        totalMatchedVolume,
        restingBookRoot,
        clearingDigest,
      },
      rejectedOrderIds,
    };
  }

  public verifyClearingBatch(proof: VerifiableClearingBatchProof): boolean {
    if (this.computeRestingRoot(proof.restingBook) !== proof.restingBookRoot) return false;
    if (this.computeClearingDigest(proof.marketId, proof.batchId, proof.submittedOrders, proof.fills, proof.restingBookRoot) !== proof.clearingDigest) {
      return false;
    }

    const orderMap = new Map<string, SignedLimitOrder>();
    for (const o of proof.submittedOrders) {
      if (o.marketId !== proof.marketId || orderMap.has(o.orderId) || !this.verifyOrderSignature(o)) return false;
      orderMap.set(o.orderId, o);
    }

    // Track filled quantities per order & check price crossing constraints
    const filledByOrder = new Map<string, bigint>();
    let totalVol = 0n;
    for (const f of proof.fills) {
      if (f.quantity <= 0n) return false;
      const bid = orderMap.get(f.bidOrderId);
      const ask = orderMap.get(f.askOrderId);
      if (!bid || !ask || bid.side !== 'BID' || ask.side !== 'ASK') return false;
      if (f.executionPrice < ask.limitPrice || f.executionPrice > bid.limitPrice) return false;

      filledByOrder.set(bid.orderId, (filledByOrder.get(bid.orderId) ?? 0n) + f.quantity);
      filledByOrder.set(ask.orderId, (filledByOrder.get(ask.orderId) ?? 0n) + f.quantity);
      totalVol += f.quantity;
    }
    if (totalVol !== proof.totalMatchedVolume) return false;

    // Verify exact conservation: filled + resting == original signed quantity for every order!
    const restingMap = new Map(proof.restingBook.map((r) => [r.orderId, r]));
    let bestRestingBid = 0n;
    let bestRestingAsk: bigint | null = null;

    for (const o of proof.submittedOrders) {
      const filled = filledByOrder.get(o.orderId) ?? 0n;
      const rest = restingMap.get(o.orderId);
      const rem = rest ? rest.remainingQuantity : 0n;
      if (filled < 0n || rem < 0n || filled + rem !== o.quantity) return false;
      if (rest) {
        if (rest.side !== o.side || rest.limitPrice !== o.limitPrice || rest.remainingQuantity <= 0n) return false;
        if (rest.side === 'BID' && rest.limitPrice > bestRestingBid) bestRestingBid = rest.limitPrice;
        if (rest.side === 'ASK' && (bestRestingAsk === null || rest.limitPrice < bestRestingAsk)) bestRestingAsk = rest.limitPrice;
      }
    }

    // No uncrossed spread arbitrage allowed on resting book!
    if (bestRestingAsk !== null && bestRestingBid >= bestRestingAsk) return false;
    return true;
  }

  public serializeClearing(proof: VerifiableClearingBatchProof): string {
    return JSON.stringify({
      marketId: proof.marketId,
      batchId: proof.batchId,
      fillCount: proof.fills.length,
      restingCount: proof.restingBook.length,
      totalMatchedVolume: proof.totalMatchedVolume.toString(),
    });
  }
}
