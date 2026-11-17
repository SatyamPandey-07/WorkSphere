import {
  AsynchronousSharedMempool,
  MempoolBloomFilter,
} from '../../core/consensus/AsynchronousSharedMempool';

describe('AsynchronousSharedMempool', () => {
  describe('Bloom Filter Deduplication', () => {
    it('accurately indexes and checks membership of keys', () => {
      const filter = new MempoolBloomFilter();
      filter.add('tx_0xabc123');
      filter.add('tx_0xdef456');

      expect(filter.has('tx_0xabc123')).toBe(true);
      expect(filter.has('tx_0xdef456')).toBe(true);
      expect(filter.has('tx_0x999999')).toBe(false);

      filter.remove('tx_0xabc123');
      expect(filter.has('tx_0xabc123')).toBe(false);
    });
  });

  describe('Mempool Admission, Throttling & Priority Batching', () => {
    let mempool: AsynchronousSharedMempool;

    beforeEach(() => {
      mempool = new AsynchronousSharedMempool(1000, 4);
    });

    it('accepts valid transactions and prevents duplicates', () => {
      const res1 = mempool.addTransaction('0xAlice', 0, 'call_swap', 100n);
      expect(res1.accepted).toBe(true);
      expect(mempool.size()).toBe(1);

      // Duplicate transaction rejected
      const res2 = mempool.addTransaction('0xAlice', 0, 'call_swap', 100n);
      expect(res2.accepted).toBe(false);
      expect(res2.reason).toContain('already in mempool');
    });

    it('enforces per-sender spam rate limiting', () => {
      for (let i = 0; i < 4; i++) {
        const res = mempool.addTransaction('0xBob', i, `tx_${i}`, 50n);
        expect(res.accepted).toBe(true);
      }

      // 5th transaction from Bob should be throttled
      const res5 = mempool.addTransaction('0xBob', 4, 'tx_spam', 50n);
      expect(res5.accepted).toBe(false);
      expect(res5.reason).toContain('limit reached');
    });

    it('proposes batches ordered descending by priority fee', () => {
      mempool.addTransaction('0xUser1', 0, 'low_fee', 10n);
      mempool.addTransaction('0xUser2', 0, 'high_fee', 1000n);
      mempool.addTransaction('0xUser3', 0, 'med_fee', 250n);

      const batch = mempool.proposeBatch(2);
      expect(batch.length).toBe(2);
      expect(batch[0].sender).toBe('0xUser2'); // Highest fee first
      expect(batch[1].sender).toBe('0xUser3');
    });

    it('evicts committed transactions upon consensus finalization', () => {
      const res1 = mempool.addTransaction('0xUser1', 0, 'tx1', 100n);
      const res2 = mempool.addTransaction('0xUser2', 0, 'tx2', 200n);
      expect(mempool.size()).toBe(2);

      const evicted = mempool.markCommitted([res1.txId]);
      expect(evicted).toBe(1);
      expect(mempool.size()).toBe(1);

      // Re-submitting committed transaction is rejected
      const resReAdd = mempool.addTransaction('0xUser1', 0, 'tx1', 100n);
      expect(resReAdd.accepted).toBe(false);
      expect(resReAdd.reason).toContain('already committed');
    });
  });
});
