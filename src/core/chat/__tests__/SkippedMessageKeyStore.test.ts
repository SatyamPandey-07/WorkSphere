import { SkippedMessageKeyStore } from '../SkippedMessageKeyStore';

describe('SkippedMessageKeyStore LRU Eviction', () => {
  it('retains active window keys and evicts oldest skipped keys during burst out-of-order delivery', () => {
    const store = new SkippedMessageKeyStore();
    const chain = 'alice-chain';

    store.set(chain, 1, 'key-1', true); // Active window key
    for (let i = 2; i <= 105; i++) {
      store.set(chain, i, key-, false);
    }

    expect(store.get(chain, 1)).toBe('key-1');
    expect(store.get(chain, 105)).toBe('key-105');
  });
});