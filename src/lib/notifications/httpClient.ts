import { jitteredReconnectDelay } from "@/lib/utils/backoff";

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  resetTimeoutMs?: number;
  maxRetries?: number;
  timeoutMs?: number;
}

interface CircuitState {
  consecutiveFailures: number;
  state: "CLOSED" | "OPEN" | "HALF_OPEN";
  lastFailureTime: number;
}

const circuitStates = new Map<string, CircuitState>();

export class NotificationHttpClient {
  private failureThreshold: number;
  private resetTimeoutMs: number;
  private maxRetries: number;
  private defaultTimeoutMs: number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.defaultTimeoutMs = options.timeoutMs ?? 5_000;
  }

  private getHost(urlStr: string): string {
    try {
      return new URL(urlStr).host;
    } catch {
      return "unknown";
    }
  }

  private getCircuit(host: string): CircuitState {
    let state = circuitStates.get(host);
    if (!state) {
      state = {
        consecutiveFailures: 0,
        state: "CLOSED",
        lastFailureTime: 0,
      };
      circuitStates.set(host, state);
    }

    const now = Date.now();
    if (state.state === "OPEN" && now - state.lastFailureTime > this.resetTimeoutMs) {
      state.state = "HALF_OPEN";
    }

    return state;
  }

  private recordSuccess(host: string): void {
    const state = this.getCircuit(host);
    state.consecutiveFailures = 0;
    state.state = "CLOSED";
  }

  private recordFailure(host: string): void {
    const state = this.getCircuit(host);
    state.consecutiveFailures += 1;
    state.lastFailureTime = Date.now();
    if (state.consecutiveFailures >= this.failureThreshold) {
      state.state = "OPEN";
    }
  }

  public isCircuitOpen(url: string): boolean {
    const host = this.getHost(url);
    const state = this.getCircuit(host);
    return state.state === "OPEN";
  }

  public async fetch(
    url: string,
    init: RequestInit = {},
    options: { timeoutMs?: number; maxRetries?: number } = {},
  ): Promise<Response> {
    const host = this.getHost(url);
    const circuit = this.getCircuit(host);

    if (circuit.state === "OPEN") {
      throw new Error(`Circuit breaker is OPEN for host ${host}`);
    }

    const retries = options.maxRetries ?? this.maxRetries;
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= retries + 1; attempt++) {
      try {
        const timeoutSignal = AbortSignal.timeout(timeoutMs);
        const signal = init.signal
          ? AbortSignal.any([init.signal, timeoutSignal])
          : timeoutSignal;
        const response = await fetch(url, {
          ...init,
          signal,
        });

        if (response.ok || (response.status >= 200 && response.status < 500)) {
          this.recordSuccess(host);
          return response;
        }

        // 5xx status codes trigger retry & circuit failure count
        this.recordFailure(host);
        lastError = new Error(`HTTP Error ${response.status}: ${response.statusText}`);
      } catch (err: any) {
        this.recordFailure(host);
        lastError = err;
      }

      if (attempt <= retries) {
        const delay = jitteredReconnectDelay(attempt, {
          minReconnectionDelay: 500,
          maxReconnectionDelay: 5000,
        });
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    throw lastError || new Error(`Failed to deliver request to ${url}`);
  }
}

export const defaultNotificationHttpClient = new NotificationHttpClient();
