export type EndpointHealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface RpcEndpointMetrics {
  url: string;
  status: EndpointHealthStatus;
  ewmaLatencyMs: number;
  consecutiveErrors: number;
  totalRequests: number;
  totalErrors: number;
  unhealthyUntilMs: number;
  lastError?: string;
}

export interface RpcWarmUpProbeResult {
  url: string;
  ok: boolean;
  latencyMs: number;
  slot?: number;
  status: EndpointHealthStatus;
  error?: string;
}

export interface RpcWarmUpOptions {
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  force?: boolean;
}

export interface RpcRouterOptions {
  endpoints: readonly string[];
  ewmaAlpha?: number;
  degradedLatencyMs?: number;
  maxConsecutiveErrors?: number;
  cooldownMs?: number;
  nowFn?: () => number;
  fetchFn?: typeof fetch;
  warmUpTimeoutMs?: number;
  /** When true, asynchronously benchmarks configured endpoints on instantiation without blocking. */
  warmUpOnStartup?: boolean;
}

export const DEFAULT_WARMUP_TIMEOUT_MS = 1500;

export class AllRpcEndpointsUnavailableError extends Error {
  public readonly code = 'ALL_RPC_ENDPOINTS_UNAVAILABLE' as const;
  public readonly attemptedEndpoints: string[];

  constructor(attemptedEndpoints: string[], message?: string) {
    super(
      message ??
        `All Solana RPC endpoints are currently unavailable (${attemptedEndpoints.join(', ') || 'none configured'}).`
    );
    this.name = 'AllRpcEndpointsUnavailableError';
    this.attemptedEndpoints = attemptedEndpoints;
  }
}

export function updateEwmaLatency(
  previousEwmaMs: number | undefined,
  sampleMs: number,
  alpha = 0.3
): number {
  const safeSample =
    typeof sampleMs === 'number' && Number.isFinite(sampleMs) && sampleMs >= 0
      ? sampleMs
      : 0;
  const safeAlpha =
    typeof alpha === 'number' && Number.isFinite(alpha) && alpha > 0 && alpha <= 1
      ? alpha
      : 0.3;
  if (
    previousEwmaMs === undefined ||
    !Number.isFinite(previousEwmaMs) ||
    previousEwmaMs <= 0
  ) {
    return Math.round(safeSample * 10) / 10;
  }
  return (
    Math.round((safeAlpha * safeSample + (1 - safeAlpha) * previousEwmaMs) * 10) / 10
  );
}

export class SolanaRpcEndpointRouter {
  private readonly ewmaAlpha: number;
  private readonly degradedLatencyMs: number;
  private readonly maxConsecutiveErrors: number;
  private readonly cooldownMs: number;
  private readonly nowFn: () => number;
  private readonly fetchFn?: typeof fetch;
  private readonly warmUpTimeoutMs: number;
  private readonly metrics = new Map<string, RpcEndpointMetrics>();
  private readonly endpointOrder = new Map<string, number>();
  private inFlightWarmUp: Promise<RpcWarmUpProbeResult[]> | null = null;

  constructor(options: RpcRouterOptions) {
    this.ewmaAlpha = options.ewmaAlpha ?? 0.3;
    this.degradedLatencyMs = Math.max(1, options.degradedLatencyMs ?? 450);
    this.maxConsecutiveErrors = Math.max(1, options.maxConsecutiveErrors ?? 3);
    this.cooldownMs = Math.max(100, options.cooldownMs ?? 15_000);
    this.nowFn = options.nowFn ?? Date.now;
    this.fetchFn = options.fetchFn;
    this.warmUpTimeoutMs =
      typeof options.warmUpTimeoutMs === 'number' &&
      Number.isFinite(options.warmUpTimeoutMs) &&
      options.warmUpTimeoutMs > 0
        ? Math.floor(options.warmUpTimeoutMs)
        : DEFAULT_WARMUP_TIMEOUT_MS;

    let orderIdx = 0;
    for (const rawUrl of options.endpoints ?? []) {
      const url = rawUrl.trim();
      if (url && !this.metrics.has(url)) {
        this.endpointOrder.set(url, orderIdx++);
        this.metrics.set(url, {
          url,
          status: 'healthy',
          ewmaLatencyMs: 0,
          consecutiveErrors: 0,
          totalRequests: 0,
          totalErrors: 0,
          unhealthyUntilMs: 0,
        });
      }
    }

    if (options.warmUpOnStartup && this.metrics.size > 0) {
      void this.warmUp().catch(() => undefined);
    }
  }

  private refreshCooldowns(nowMs: number): void {
    for (const entry of this.metrics.values()) {
      if (entry.status === 'unhealthy' && nowMs >= entry.unhealthyUntilMs) {
        entry.status = 'degraded';
        entry.consecutiveErrors = 0;
        entry.unhealthyUntilMs = 0;
      }
    }
  }

  public getMetrics(nowMs = this.nowFn()): RpcEndpointMetrics[] {
    this.refreshCooldowns(nowMs);
    return Array.from(this.metrics.values()).map((m) => ({ ...m }));
  }

  public recordSuccess(
    url: string,
    latencyMs: number,
    nowMs = this.nowFn()
  ): RpcEndpointMetrics {
    this.refreshCooldowns(nowMs);
    const entry = this.metrics.get(url);
    if (!entry) throw new Error(`Unknown RPC endpoint "${url}"`);

    entry.totalRequests += 1;
    entry.consecutiveErrors = 0;
    entry.unhealthyUntilMs = 0;
    entry.lastError = undefined;
    entry.ewmaLatencyMs = updateEwmaLatency(
      entry.ewmaLatencyMs,
      latencyMs,
      this.ewmaAlpha
    );
    entry.status =
      entry.ewmaLatencyMs > this.degradedLatencyMs ? 'degraded' : 'healthy';
    return { ...entry };
  }

  public recordFailure(
    url: string,
    error?: unknown,
    nowMs = this.nowFn()
  ): RpcEndpointMetrics {
    this.refreshCooldowns(nowMs);
    const entry = this.metrics.get(url);
    if (!entry) throw new Error(`Unknown RPC endpoint "${url}"`);

    entry.totalRequests += 1;
    entry.totalErrors += 1;
    entry.consecutiveErrors += 1;
    entry.lastError =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'RPC request failed';

    if (entry.consecutiveErrors >= this.maxConsecutiveErrors) {
      entry.status = 'unhealthy';
      entry.unhealthyUntilMs = nowMs + this.cooldownMs;
    } else {
      entry.status = 'degraded';
    }
    return { ...entry };
  }

  public selectBestEndpoint(
    excludeUrls: ReadonlySet<string> = new Set(),
    nowMs = this.nowFn()
  ): RpcEndpointMetrics | null {
    this.refreshCooldowns(nowMs);
    const candidates = Array.from(this.metrics.values()).filter(
      (m) => m.status !== 'unhealthy' && !excludeUrls.has(m.url)
    );
    if (candidates.length === 0) return null;

    candidates.sort(
      (a, b) =>
        (a.status === 'healthy' ? 0 : 1) - (b.status === 'healthy' ? 0 : 1) ||
        a.ewmaLatencyMs - b.ewmaLatencyMs ||
        a.consecutiveErrors - b.consecutiveErrors ||
        (this.endpointOrder.get(a.url) ?? 0) - (this.endpointOrder.get(b.url) ?? 0)
    );
    return { ...candidates[0] };
  }

  /**
   * Benchmarks all configured endpoints concurrently using lightweight `getSlot`
   * JSON-RPC calls with a short timeout (default 1500ms) so the fastest healthy
   * endpoint is ranked first and failing endpoints are deprioritized.
   */
  public warmUp(options: RpcWarmUpOptions = {}): Promise<RpcWarmUpProbeResult[]> {
    if (this.inFlightWarmUp && !options.force) {
      return this.inFlightWarmUp;
    }

    const fetchImpl = options.fetchFn ?? this.fetchFn ?? globalThis.fetch;
    const timeoutMs =
      typeof options.timeoutMs === 'number' &&
      Number.isFinite(options.timeoutMs) &&
      options.timeoutMs > 0
        ? Math.floor(options.timeoutMs)
        : this.warmUpTimeoutMs;

    const endpoints = Array.from(this.metrics.keys());
    if (endpoints.length === 0 || typeof fetchImpl !== 'function') {
      return Promise.resolve([]);
    }

    const run = Promise.all(
      endpoints.map((url) => this.probeEndpoint(url, fetchImpl, timeoutMs))
    ).finally(() => {
      if (this.inFlightWarmUp === run) {
        this.inFlightWarmUp = null;
      }
    });

    this.inFlightWarmUp = run;
    return run;
  }

  public getInFlightWarmUp(): Promise<RpcWarmUpProbeResult[]> | null {
    return this.inFlightWarmUp;
  }

  private async probeEndpoint(
    url: string,
    fetchImpl: typeof fetch,
    timeoutMs: number
  ): Promise<RpcWarmUpProbeResult> {
    const startMs = this.nowFn();
    const controller =
      typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      controller?.abort();
    }, timeoutMs);
    if (typeof (timer as unknown as { unref?: () => void }).unref === 'function') {
      (timer as unknown as { unref: () => void }).unref();
    }

    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getSlot',
          params: [{ commitment: 'processed' }],
        }),
        ...(controller ? { signal: controller.signal } : {}),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from RPC warm-up probe`);
      }

      const payload = (await response.json()) as {
        result?: unknown;
        error?: { message?: string; code?: number };
      };

      if (payload?.error) {
        throw new Error(
          payload.error.message ||
            `RPC error ${payload.error.code ?? 'unknown'} during getSlot`
        );
      }

      if (typeof payload?.result !== 'number' || !Number.isFinite(payload.result)) {
        throw new Error('Invalid getSlot response payload');
      }

      const latencyMs = Math.max(0, this.nowFn() - startMs);
      const updated = this.recordSuccess(url, latencyMs, this.nowFn());
      return {
        url,
        ok: true,
        latencyMs,
        slot: payload.result,
        status: updated.status,
      };
    } catch (err) {
      const latencyMs = Math.max(0, this.nowFn() - startMs);
      const normalizedErr = timedOut
        ? new Error(`RPC warm-up probe timed out after ${timeoutMs}ms`)
        : err;
      const updated = this.recordFailure(url, normalizedErr, this.nowFn());
      return {
        url,
        ok: false,
        latencyMs,
        status: updated.status,
        error: updated.lastError,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  public async executeWithFailover<T>(
    operation: (endpointUrl: string) => Promise<T>
  ): Promise<{ result: T; endpointUrl: string }> {
    this.refreshCooldowns(this.nowFn());
    if (this.metrics.size === 0) throw new AllRpcEndpointsUnavailableError([]);

    const tried = new Set<string>();
    let lastError: unknown;

    while (true) {
      const chosen = this.selectBestEndpoint(tried, this.nowFn());
      if (!chosen) {
        throw new AllRpcEndpointsUnavailableError(
          Array.from(tried),
          lastError instanceof Error
            ? `All Solana RPC endpoints failed: ${lastError.message}`
            : undefined
        );
      }

      tried.add(chosen.url);
      const startMs = this.nowFn();
      try {
        const result = await operation(chosen.url);
        this.recordSuccess(
          chosen.url,
          Math.max(0, this.nowFn() - startMs),
          this.nowFn()
        );
        return { result, endpointUrl: chosen.url };
      } catch (err) {
        lastError = err;
        this.recordFailure(chosen.url, err, this.nowFn());
      }
    }
  }
}
