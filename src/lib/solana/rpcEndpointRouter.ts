export type EndpointHealthStatus = 'healthy' | 'degraded' | 'unhealthy';
export interface RpcEndpointMetrics { url: string; status: EndpointHealthStatus; ewmaLatencyMs: number; consecutiveErrors: number; totalRequests: number; totalErrors: number; unhealthyUntilMs: number; lastError?: string; }
export interface RpcRouterOptions { endpoints: readonly string[]; ewmaAlpha?: number; degradedLatencyMs?: number; maxConsecutiveErrors?: number; cooldownMs?: number; nowFn?: () => number; }
export class AllRpcEndpointsUnavailableError extends Error {
  public readonly code = 'ALL_RPC_ENDPOINTS_UNAVAILABLE' as const;
  public readonly attemptedEndpoints: string[];
  constructor(attemptedEndpoints: string[], message?: string) { super(message ?? `All Solana RPC endpoints are currently unavailable (${attemptedEndpoints.join(', ') || 'none configured'}).`); this.name = 'AllRpcEndpointsUnavailableError'; this.attemptedEndpoints = attemptedEndpoints; }
}
export function updateEwmaLatency(previousEwmaMs: number | undefined, sampleMs: number, alpha = 0.3): number {
  const safeSample = typeof sampleMs === 'number' && Number.isFinite(sampleMs) && sampleMs >= 0 ? sampleMs : 0;
  const safeAlpha = typeof alpha === 'number' && Number.isFinite(alpha) && alpha > 0 && alpha <= 1 ? alpha : 0.3;
  if (previousEwmaMs === undefined || !Number.isFinite(previousEwmaMs) || previousEwmaMs <= 0) return Math.round(safeSample * 10) / 10;
  return Math.round((safeAlpha * safeSample + (1 - safeAlpha) * previousEwmaMs) * 10) / 10;
}
export class SolanaRpcEndpointRouter {
  private readonly ewmaAlpha: number; private readonly degradedLatencyMs: number; private readonly maxConsecutiveErrors: number; private readonly cooldownMs: number; private readonly nowFn: () => number; private readonly metrics = new Map<string, RpcEndpointMetrics>();
  constructor(options: RpcRouterOptions) {
    this.ewmaAlpha = options.ewmaAlpha ?? 0.3; this.degradedLatencyMs = Math.max(1, options.degradedLatencyMs ?? 450); this.maxConsecutiveErrors = Math.max(1, options.maxConsecutiveErrors ?? 3); this.cooldownMs = Math.max(100, options.cooldownMs ?? 15_000); this.nowFn = options.nowFn ?? Date.now;
    for (const rawUrl of options.endpoints ?? []) { const url = rawUrl.trim(); if (url && !this.metrics.has(url)) this.metrics.set(url, { url, status: 'healthy', ewmaLatencyMs: 0, consecutiveErrors: 0, totalRequests: 0, totalErrors: 0, unhealthyUntilMs: 0 }); }
  }
  private refreshCooldowns(nowMs: number): void { for (const entry of this.metrics.values()) if (entry.status === 'unhealthy' && nowMs >= entry.unhealthyUntilMs) { entry.status = 'degraded'; entry.consecutiveErrors = 0; entry.unhealthyUntilMs = 0; } }
  public getMetrics(nowMs = this.nowFn()): RpcEndpointMetrics[] { this.refreshCooldowns(nowMs); return Array.from(this.metrics.values()).map((m) => ({ ...m })); }
  public recordSuccess(url: string, latencyMs: number, nowMs = this.nowFn()): RpcEndpointMetrics {
    this.refreshCooldowns(nowMs); const entry = this.metrics.get(url); if (!entry) throw new Error(`Unknown RPC endpoint "${url}"`);
    entry.totalRequests += 1; entry.consecutiveErrors = 0; entry.unhealthyUntilMs = 0; entry.lastError = undefined; entry.ewmaLatencyMs = updateEwmaLatency(entry.ewmaLatencyMs, latencyMs, this.ewmaAlpha); entry.status = entry.ewmaLatencyMs > this.degradedLatencyMs ? 'degraded' : 'healthy'; return { ...entry };
  }
  public recordFailure(url: string, error?: unknown, nowMs = this.nowFn()): RpcEndpointMetrics {
    this.refreshCooldowns(nowMs); const entry = this.metrics.get(url); if (!entry) throw new Error(`Unknown RPC endpoint "${url}"`);
    entry.totalRequests += 1; entry.totalErrors += 1; entry.consecutiveErrors += 1; entry.lastError = error instanceof Error ? error.message : typeof error === 'string' ? error : 'RPC request failed';
    if (entry.consecutiveErrors >= this.maxConsecutiveErrors) { entry.status = 'unhealthy'; entry.unhealthyUntilMs = nowMs + this.cooldownMs; } else { entry.status = 'degraded'; } return { ...entry };
  }
  public selectBestEndpoint(excludeUrls: ReadonlySet<string> = new Set(), nowMs = this.nowFn()): RpcEndpointMetrics | null {
    this.refreshCooldowns(nowMs); const candidates = Array.from(this.metrics.values()).filter((m) => m.status !== 'unhealthy' && !excludeUrls.has(m.url));
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => (a.status === 'healthy' ? 0 : 1) - (b.status === 'healthy' ? 0 : 1) || a.ewmaLatencyMs - b.ewmaLatencyMs || a.consecutiveErrors - b.consecutiveErrors || a.url.localeCompare(b.url));
    return { ...candidates[0] };
  }
  public async executeWithFailover<T>(operation: (endpointUrl: string) => Promise<T>): Promise<{ result: T; endpointUrl: string }> {
    this.refreshCooldowns(this.nowFn()); if (this.metrics.size === 0) throw new AllRpcEndpointsUnavailableError([]);
    const tried = new Set<string>(); let lastError: unknown;
    while (true) {
      const chosen = this.selectBestEndpoint(tried, this.nowFn());
      if (!chosen) throw new AllRpcEndpointsUnavailableError(Array.from(tried), lastError instanceof Error ? `All Solana RPC endpoints failed: ${lastError.message}` : undefined);
      tried.add(chosen.url); const startMs = this.nowFn();
      try { const result = await operation(chosen.url); this.recordSuccess(chosen.url, Math.max(0, this.nowFn() - startMs), this.nowFn()); return { result, endpointUrl: chosen.url }; } catch (err) { lastError = err; this.recordFailure(chosen.url, err, this.nowFn()); }
    }
  }
}
