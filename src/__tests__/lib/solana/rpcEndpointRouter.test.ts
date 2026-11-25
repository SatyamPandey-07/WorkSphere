import {
  AllRpcEndpointsUnavailableError,
  SolanaRpcEndpointRouter,
  updateEwmaLatency,
} from '@/lib/solana/rpcEndpointRouter';

describe('SolanaRpcEndpointRouter', () => {
  it('updates EWMA latency deterministically', () => {
    expect(updateEwmaLatency(undefined, 120, 0.5)).toBe(120);
    expect(updateEwmaLatency(120, 200, 0.5)).toBe(160);
  });

  it('fails over across endpoints on transient errors and marks failing endpoints unhealthy', async () => {
    let now = 1_000;
    const router = new SolanaRpcEndpointRouter({
      endpoints: ['https://rpc-primary.test', 'https://rpc-backup.test'],
      maxConsecutiveErrors: 1,
      cooldownMs: 10_000,
      nowFn: () => now,
    });

    const outcome = await router.executeWithFailover(async (url) => {
      now += 40;
      if (url === 'https://rpc-primary.test') {
        throw new Error('429 Too Many Requests');
      }
      return 'tx-sig-999';
    });

    expect(outcome.result).toBe('tx-sig-999');
    expect(outcome.endpointUrl).toBe('https://rpc-backup.test');

    const primary = router.getMetrics(now).find((m) => m.url.includes('primary'));
    expect(primary?.status).toBe('unhealthy');
  });

  it('recovers unhealthy endpoints after cooldown and throws when all endpoints are down', async () => {
    let now = 5_000;
    const router = new SolanaRpcEndpointRouter({
      endpoints: ['https://rpc-1.test', 'https://rpc-2.test'],
      maxConsecutiveErrors: 1,
      cooldownMs: 5_000,
      nowFn: () => now,
    });

    await expect(
      router.executeWithFailover(async () => {
        throw new Error('503 Service Unavailable');
      })
    ).rejects.toBeInstanceOf(AllRpcEndpointsUnavailableError);

    now += 5_000;
    const recovered = await router.executeWithFailover(async (url) => {
      now += 25;
      return `ok:${url}`;
    });
    expect(recovered.result).toBe('ok:https://rpc-1.test');
  });

  it('handles empty endpoint lists gracefully', async () => {
    const emptyRouter = new SolanaRpcEndpointRouter({ endpoints: [] });
    expect(emptyRouter.selectBestEndpoint()).toBeNull();
    await expect(
      emptyRouter.executeWithFailover(async () => 'never')
    ).rejects.toBeInstanceOf(AllRpcEndpointsUnavailableError);
  });
});
