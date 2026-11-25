export type RpcTransport<TResult = unknown> = (
  endpoint: string,
  method: string,
  params: unknown[],
  signal: AbortSignal,
) => Promise<TResult>;

export interface ClusterRpcPoolConfig {
  endpoints: string[];
  transport: RpcTransport;
  /** Per-endpoint attempt timeout in milliseconds (default: 4000). */
  requestTimeoutMs?: number;
  /** Consecutive failures before opening the circuit for an endpoint (default: 2). */
  failureThreshold?: number;
  /** Cooldown duration in milliseconds before probing an open endpoint (default: 15000). */
  cooldownMs?: number;
  /** Optional clock for deterministic testing (default: () => Date.now()). */
  now?: () => number;
}

export interface EndpointHealthSnapshot {
  endpoint: string;
  consecutiveFailures: number;
  circuitOpenUntil: number | null;
  lastError: string | null;
  lastSuccessAt: number | null;
  totalRequests: number;
  totalFailures: number;
}

export class AllEndpointsFailedError extends Error {
  public readonly errors: Array<{ endpoint: string; reason: unknown }>;

  constructor(
    method: string,
    errors: Array<{ endpoint: string; reason: unknown }>,
  ) {
    const summary = errors
      .map(
        (e) =>
          `${e.endpoint}: ${e.reason instanceof Error ? e.reason.message : String(e.reason)}`,
      )
      .join(" | ");
    super(`All RPC endpoints failed for "${method}" (${summary})`);
    this.name = "AllEndpointsFailedError";
    this.errors = errors;
  }
}

interface EndpointState {
  endpoint: string;
  consecutiveFailures: number;
  circuitOpenUntil: number | null;
  lastError: string | null;
  lastSuccessAt: number | null;
  totalRequests: number;
  totalFailures: number;
}

const DEFAULT_TIMEOUT_MS = 4_000;
const DEFAULT_FAILURE_THRESHOLD = 2;
const DEFAULT_COOLDOWN_MS = 15_000;

function isRetryableFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return true;
  const err = error as {
    status?: number;
    statusCode?: number;
    code?: string;
    name?: string;
  };
  if (err.name === "AbortError") return true;
  const status = err.status ?? err.statusCode;
  if (typeof status === "number") {
    return status === 429 || status >= 500;
  }
  if (typeof err.code === "string") {
    return [
      "ETIMEDOUT",
      "ECONNRESET",
      "ECONNREFUSED",
      "EAI_AGAIN",
      "UND_ERR_CONNECT_TIMEOUT",
    ].includes(err.code);
  }
  return true;
}

function formatErrorMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string") return reason;
  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}

export class SolanaClusterPool {
  private readonly states: EndpointState[];
  private readonly transport: RpcTransport;
  private readonly requestTimeoutMs: number;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private cursor = 0;

  constructor(config: ClusterRpcPoolConfig) {
    const uniqueEndpoints = Array.from(
      new Set(config.endpoints.map((u) => u.trim()).filter(Boolean)),
    );
    if (uniqueEndpoints.length === 0) {
      throw new Error(
        "SolanaClusterPool requires at least one valid RPC endpoint.",
      );
    }

    this.transport = config.transport;
    this.requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.failureThreshold =
      config.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    this.cooldownMs = config.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.now = config.now ?? (() => Date.now());

    this.states = uniqueEndpoints.map((endpoint) => ({
      endpoint,
      consecutiveFailures: 0,
      circuitOpenUntil: null,
      lastError: null,
      lastSuccessAt: null,
      totalRequests: 0,
      totalFailures: 0,
    }));
  }

  public getHealthSnapshot(): EndpointHealthSnapshot[] {
    return this.states.map((s) => ({ ...s }));
  }

  /**
   * Executes an RPC call with deterministic failover routing and Promise.allSettled
   * isolation so concurrent rejections or hangs never leak unhandled rejections.
   */
  public async call<TResult = unknown>(
    method: string,
    params: unknown[] = [],
  ): Promise<TResult> {
    const currentTime = this.now();
    const orderedStates = this.getOrderedEndpoints(currentTime);
    const collectedErrors: Array<{ endpoint: string; reason: unknown }> = [];

    // Execute in deterministic priority waves (healthy/half-open first, then open-circuit fallbacks)
    // so primary endpoints are tried in order while concurrent attempts per wave are settled safely.
    const healthyOrProbing = orderedStates.filter(
      (s) => !this.isCircuitOpen(s, currentTime),
    );
    const openCircuitFallback = orderedStates.filter((s) =>
      this.isCircuitOpen(s, currentTime),
    );
    const waves = [healthyOrProbing, openCircuitFallback].filter(
      (wave) => wave.length > 0,
    );

    for (const wave of waves) {
      const winner = await this.executeWave(
        wave,
        method,
        params,
        collectedErrors,
      );
      if (winner !== undefined) {
        return winner as TResult;
      }
    }

    throw new AllEndpointsFailedError(method, collectedErrors);
  }

  /**
   * Probes endpoints whose cooldown has elapsed (or all endpoints when `force` is true)
   * using a lightweight `getHealth` RPC call to restore healthy status.
   */
  public async probeHealth(force = false): Promise<Record<string, boolean>> {
    const currentTime = this.now();
    const candidates = this.states.filter(
      (state) =>
        force ||
        (state.circuitOpenUntil !== null &&
          currentTime >= state.circuitOpenUntil),
    );

    if (candidates.length === 0) {
      return Object.fromEntries(
        this.states.map((s) => [
          s.endpoint,
          !this.isCircuitOpen(s, currentTime),
        ]),
      );
    }

    const probeTasks = candidates.map(async (state) => {
      try {
        await this.invokeWithTimeout(state, "getHealth", []);
        this.recordSuccess(state, this.now());
        return { endpoint: state.endpoint, healthy: true };
      } catch (reason) {
        this.recordFailure(state, reason, this.now());
        return { endpoint: state.endpoint, healthy: false };
      }
    });

    const settled = await Promise.allSettled(probeTasks);
    const results: Record<string, boolean> = {};

    for (const item of settled) {
      if (item.status === "fulfilled") {
        results[item.value.endpoint] = item.value.healthy;
      }
    }

    const nowAfter = this.now();
    for (const state of this.states) {
      if (!(state.endpoint in results)) {
        results[state.endpoint] = !this.isCircuitOpen(state, nowAfter);
      }
    }

    return results;
  }

  private async executeWave<TResult>(
    wave: EndpointState[],
    method: string,
    params: unknown[],
    collectedErrors: Array<{ endpoint: string; reason: unknown }>,
  ): Promise<TResult | undefined> {
    // Launch concurrent attempts across the wave and settle every promise so no rejection escapes.
    const attemptPromises = wave.map(async (state) => {
      try {
        const result = await this.invokeWithTimeout<TResult>(
          state,
          method,
          params,
        );
        this.recordSuccess(state, this.now());
        return { ok: true as const, value: result, endpoint: state.endpoint };
      } catch (reason) {
        this.recordFailure(state, reason, this.now());
        return { ok: false as const, reason, endpoint: state.endpoint };
      }
    });

    // Attach a no-op catch to every attempt promise immediately so even if one resolves first
    // and we move on, late rejections on sibling promises are never unhandled.
    for (const p of attemptPromises) {
      p.catch(() => undefined);
    }

    const outcomes = await Promise.allSettled(attemptPromises);

    for (const outcome of outcomes) {
      if (outcome.status === "fulfilled") {
        if (outcome.value.ok) {
          return outcome.value.value;
        }
        collectedErrors.push({
          endpoint: outcome.value.endpoint,
          reason: outcome.value.reason,
        });
      } else {
        collectedErrors.push({ endpoint: "unknown", reason: outcome.reason });
      }
    }

    return undefined;
  }

  private async invokeWithTimeout<TResult>(
    state: EndpointState,
    method: string,
    params: unknown[],
  ): Promise<TResult> {
    state.totalRequests += 1;

    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        const timeoutErr = new Error(
          `RPC timeout after ${this.requestTimeoutMs}ms on ${state.endpoint}`,
        );
        timeoutErr.name = "AbortError";
        controller.abort(timeoutErr);
        reject(timeoutErr);
      }, this.requestTimeoutMs);
    });

    // Prevent unhandled rejection if transport rejects right as timeout fires.
    timeoutPromise.catch(() => undefined);

    try {
      const transportPromise = Promise.resolve().then(
        () =>
          this.transport(
            state.endpoint,
            method,
            params,
            controller.signal,
          ) as Promise<TResult>,
      );
      transportPromise.catch(() => undefined);

      return await Promise.race([transportPromise, timeoutPromise]);
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }

  private isCircuitOpen(state: EndpointState, currentTime: number): boolean {
    if (state.circuitOpenUntil === null) return false;
    if (currentTime >= state.circuitOpenUntil) {
      // Cooldown expired: allow a half-open probe attempt.
      return false;
    }
    return true;
  }

  private recordSuccess(state: EndpointState, currentTime: number): void {
    state.consecutiveFailures = 0;
    state.circuitOpenUntil = null;
    state.lastError = null;
    state.lastSuccessAt = currentTime;
  }

  private recordFailure(
    state: EndpointState,
    reason: unknown,
    currentTime: number,
  ): void {
    state.totalFailures += 1;
    state.lastError = formatErrorMessage(reason);

    if (!isRetryableFailure(reason)) {
      return;
    }

    state.consecutiveFailures += 1;
    if (state.consecutiveFailures >= this.failureThreshold) {
      state.circuitOpenUntil = currentTime + this.cooldownMs;
    }
  }

  private getOrderedEndpoints(currentTime: number): EndpointState[] {
    const len = this.states.length;
    const start = this.cursor % len;
    this.cursor = (this.cursor + 1) % len;

    const rotated: EndpointState[] = [];
    for (let i = 0; i < len; i++) {
      rotated.push(this.states[(start + i) % len]);
    }

    // Within each health tier, preserve deterministic priority order.
    const healthy = rotated.filter(
      (s) => !this.isCircuitOpen(s, currentTime) && s.consecutiveFailures === 0,
    );
    const halfOpenOrDegraded = rotated.filter(
      (s) => !this.isCircuitOpen(s, currentTime) && s.consecutiveFailures > 0,
    );
    const open = rotated.filter((s) => this.isCircuitOpen(s, currentTime));

    return [...healthy, ...halfOpenOrDegraded, ...open];
  }
}
