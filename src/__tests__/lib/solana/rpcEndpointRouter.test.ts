import {
  AllRpcEndpointsUnavailableError,
  DEFAULT_WARMUP_TIMEOUT_MS,
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

  it('benchmarks endpoints with getSlot on warmUp and ranks the fastest healthy endpoint first', async () => {
    const delaysMs: Record<string, number> = {
      'https://rpc-slow.test': 90,
      'https://rpc-fast.test': 5,
      'https://rpc-medium.test': 45,
    };

    const mockFetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? '{}'));
      expect(init?.method).toBe('POST');
      expect(body.method).toBe('getSlot');

      await new Promise((resolve) => setTimeout(resolve, delaysMs[url] ?? 20));
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: 300_000_001 }),
      } as Response;
    });

    const router = new SolanaRpcEndpointRouter({
      endpoints: [
        'https://rpc-slow.test',
        'https://rpc-fast.test',
        'https://rpc-medium.test',
      ],
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const results = await router.warmUp();
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.ok && r.slot === 300_000_001)).toBe(true);
    expect(router.selectBestEndpoint()?.url).toBe('https://rpc-fast.test');
  });

  it('deprioritizes unhealthy endpoints that fail HTTP, RPC, or 1500ms timeout during warmUp', async () => {
    expect(DEFAULT_WARMUP_TIMEOUT_MS).toBe(1500);

    let now = 20_000;
    const mockFetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === 'https://rpc-timeout.test') {
        return await new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        });
      }

      if (url === 'https://rpc-http-503.test') {
        now += 20;
        return {
          ok: false,
          status: 503,
          json: async () => ({}),
        } as Response;
      }

      if (url === 'https://rpc-json-err.test') {
        now += 15;
        return {
          ok: true,
          status: 200,
          json: async () => ({ jsonrpc: '2.0', id: 1, error: { code: -32005, message: 'Node unhealthy' } }),
        } as Response;
      }

      now += 40;
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: 300_000_099 }),
      } as Response;
    });

    const router = new SolanaRpcEndpointRouter({
      endpoints: [
        'https://rpc-timeout.test',
        'https://rpc-http-503.test',
        'https://rpc-json-err.test',
        'https://rpc-healthy.test',
      ],
      maxConsecutiveErrors: 1,
      nowFn: () => now,
      fetchFn: mockFetch as unknown as typeof fetch,
      warmUpTimeoutMs: 25,
    });

    const results = await router.warmUp();
    const byUrl = new Map(results.map((r) => [r.url, r]));

    expect(byUrl.get('https://rpc-timeout.test')?.ok).toBe(false);
    expect(byUrl.get('https://rpc-timeout.test')?.error).toContain('timed out');
    expect(byUrl.get('https://rpc-http-503.test')?.ok).toBe(false);
    expect(byUrl.get('https://rpc-json-err.test')?.ok).toBe(false);
    expect(byUrl.get('https://rpc-healthy.test')?.ok).toBe(true);

    expect(router.selectBestEndpoint()?.url).toBe('https://rpc-healthy.test');
    const metrics = router.getMetrics(now);
    expect(metrics.find((m) => m.url === 'https://rpc-timeout.test')?.status).toBe('unhealthy');
  });

  it('supports non-blocking warmUpOnStartup and deduplicates concurrent warmUp calls', async () => {
    let resolveFetch!: (val: Response) => void;
    const mockFetch = jest.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );

    const router = new SolanaRpcEndpointRouter({
      endpoints: ['https://rpc-startup.test'],
      fetchFn: mockFetch as unknown as typeof fetch,
      warmUpOnStartup: true,
    });

    const inFlight = router.getInFlightWarmUp();
    expect(inFlight).not.toBeNull();
    // Subsequent call returns the same in-flight promise without issuing a duplicate fetch
    expect(router.warmUp()).toBe(inFlight);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    resolveFetch({
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: '2.0', id: 1, result: 42 }),
    } as Response);

    const results = await inFlight!;
    expect(results[0].ok).toBe(true);
    expect(results[0].slot).toBe(42);
    expect(router.getInFlightWarmUp()).toBeNull();
  });
});
