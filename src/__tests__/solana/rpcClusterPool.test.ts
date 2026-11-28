import { SolanaRpcClusterPool } from '@/lib/solana/rpcClusterPool';
describe('SolanaRpcClusterPool bounded latency sliding window & routing', () => { it('bounds latency samples per endpoint and prioritizes lower-latency endpoints', async () => { const pool = new SolanaRpcClusterPool([{ url: 'https://rpc-slow.example.invalid' }, { url: 'https://rpc-fast.example.invalid' }], 5_000, 3); pool.recordLatency('https://rpc-slow.example.invalid', 400); pool.recordLatency('https://rpc-slow.example.invalid', 420); pool.recordLatency('https://rpc-slow.example.invalid', 450); pool.recordLatency('https://rpc-slow.example.invalid', 500); pool.recordLatency('https://rpc-slow.example.invalid', 520); pool.recordLatency('https://rpc-fast.example.invalid', 25); pool.recordLatency('https://rpc-fast.example.invalid', 30); const slowStats = pool.getLatencyStats('https://rpc-slow.example.invalid'); expect(slowStats.samples).toEqual([450, 500, 520]); expect(slowStats.averageLatencyMs).toBeCloseTo(490, 5); const result = await pool.executeWithFailover(async (endpoint) => endpoint.url); expect(result.endpointUrl).toBe('https://rpc-fast.example.invalid'); }); });

describe('SolanaRpcClusterPool timer cleanup', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('clears all pending endpoint timers on reset', () => {
    const pool = new SolanaRpcClusterPool([
      { url: 'https://rpc-a.example.invalid' },
      { url: 'https://rpc-b.example.invalid' },
    ], 10_000);
    const pending = new Promise<never>(() => undefined);

    void pool.executeWithFailover(async () => pending).catch(() => undefined);
    expect(jest.getTimerCount()).toBe(2);

    pool.reset();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('allows repeated reset and teardown calls without throwing', () => {
    const pool = new SolanaRpcClusterPool([{ url: 'https://rpc.example.invalid' }], 10_000);

    expect(() => {
      pool.reset();
      pool.reset();
      pool.teardown();
      pool.teardown();
    }).not.toThrow();
  });
});
