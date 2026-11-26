import { jitteredReconnectDelay } from "@/lib/utils/backoff";
import { isSafeWebhookUrl } from "@/lib/ssrfValidation";

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

export class RedirectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RedirectError";
  }
}

export type UrlValidator = (
  url: string,
) =>
  | Promise<{ isSafe: boolean; reason?: string }>
  | { isSafe: boolean; reason?: string };

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  resetTimeoutMs?: number;
  maxRetries?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  validateUrl?: UrlValidator;
}

export interface FetchOptions {
  timeoutMs?: number;
  maxRetries?: number;
  maxRedirects?: number;
  validateUrl?: UrlValidator | null;
}

interface CircuitState {
  consecutiveFailures: number;
  state: "CLOSED" | "OPEN" | "HALF_OPEN";
  lastFailureTime: number;
}

const circuitStates = new Map<string, CircuitState>();

const SENSITIVE_HEADERS = [
  "authorization",
  "cookie",
  "proxy-authorization",
  "webhook-signature",
  "svix-signature",
  "webhook-timestamp",
  "svix-timestamp",
  "x-api-key",
];

export class NotificationHttpClient {
  private failureThreshold: number;
  private resetTimeoutMs: number;
  private maxRetries: number;
  private defaultTimeoutMs: number;
  private defaultMaxRedirects: number;
  private defaultValidator?: UrlValidator;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.defaultTimeoutMs = options.timeoutMs ?? 5_000;
    this.defaultMaxRedirects = options.maxRedirects ?? 3;
    this.defaultValidator = options.validateUrl;
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
    if (
      state.state === "OPEN" &&
      now - state.lastFailureTime > this.resetTimeoutMs
    ) {
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
    options: FetchOptions = {},
  ): Promise<Response> {
    const retries = options.maxRetries ?? this.maxRetries;
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const maxRedirects = options.maxRedirects ?? this.defaultMaxRedirects;
    const validator =
      options.validateUrl !== undefined
        ? options.validateUrl
        : this.defaultValidator;
    const redirectMode = init.redirect ?? "follow";

    let lastError: unknown = null;

    for (let attempt = 1; attempt <= retries + 1; attempt++) {
      try {
        let currentUrl = url;
        let redirectCount = 0;
        const visitedUrls = new Set<string>([currentUrl]);
        const currentHeaders = new Headers(init.headers || {});
        let currentMethod = init.method ?? "GET";
        let currentBody = init.body;

        // Redirect resolution loop
        while (true) {
          const host = this.getHost(currentUrl);
          const circuit = this.getCircuit(host);

          if (circuit.state === "OPEN") {
            throw new Error(`Circuit breaker is OPEN for host ${host}`);
          }

          if (validator) {
            const safety = await validator(currentUrl);
            if (!safety.isSafe) {
              throw new SsrfBlockedError(
                `SSRF validation blocked request to ${currentUrl}: ${safety.reason || "Forbidden destination"}`,
              );
            }
          }

          const timeoutSignal = AbortSignal.timeout(timeoutMs);
          const signal = init.signal
            ? AbortSignal.any([init.signal, timeoutSignal])
            : timeoutSignal;

          const response = await fetch(currentUrl, {
            ...init,
            method: currentMethod,
            headers: currentHeaders,
            body: currentBody,
            redirect: "manual",
            signal,
          });

          const isRedirect = [301, 302, 303, 307, 308].includes(
            response.status,
          );

          if (isRedirect) {
            if (redirectMode === "manual") {
              this.recordSuccess(host);
              return response;
            }

            if (redirectMode === "error") {
              throw new RedirectError(
                `Redirect not allowed for ${currentUrl} (HTTP ${response.status})`,
              );
            }

            const location = response.headers.get("location");
            if (!location) {
              if (response.status >= 200 && response.status < 500) {
                this.recordSuccess(host);
                return response;
              }
              this.recordFailure(host);
              lastError = new Error(
                `HTTP Error ${response.status}: ${response.statusText}`,
              );
              break;
            }

            if (redirectCount >= maxRedirects) {
              throw new RedirectError(
                `Maximum redirect limit (${maxRedirects}) exceeded`,
              );
            }

            let nextUrl: URL;
            try {
              nextUrl = new URL(location, currentUrl);
            } catch {
              throw new RedirectError(`Invalid redirect URL: ${location}`);
            }

            if (nextUrl.protocol !== "http:" && nextUrl.protocol !== "https:") {
              throw new SsrfBlockedError(
                `SSRF validation blocked redirect to ${nextUrl.href}: Invalid protocol ${nextUrl.protocol}. Only HTTP and HTTPS are allowed.`,
              );
            }

            const nextUrlStr = nextUrl.toString();
            if (visitedUrls.has(nextUrlStr)) {
              throw new RedirectError(`Redirect loop detected: ${nextUrlStr}`);
            }
            visitedUrls.add(nextUrlStr);
            redirectCount++;

            if (validator) {
              const safety = await validator(nextUrlStr);
              if (!safety.isSafe) {
                throw new SsrfBlockedError(
                  `SSRF validation blocked redirect to ${nextUrlStr}: ${safety.reason || "Forbidden destination"}`,
                );
              }
            }

            // Strip sensitive credentials/headers if redirecting cross-origin
            const currentOrigin = new URL(currentUrl).origin;
            if (nextUrl.origin !== currentOrigin) {
              for (const header of SENSITIVE_HEADERS) {
                currentHeaders.delete(header);
              }
            }

            // In accordance with RFC 7231 / Fetch standard:
            // 303 drops body and becomes GET
            // 301 and 302 with POST drops body and becomes GET
            // 307 and 308 preserve method and body
            if (
              response.status === 303 ||
              ((response.status === 301 || response.status === 302) &&
                currentMethod.toUpperCase() === "POST")
            ) {
              currentMethod = "GET";
              currentBody = undefined;
              currentHeaders.delete("content-type");
              currentHeaders.delete("content-length");
            }

            this.recordSuccess(host);
            currentUrl = nextUrlStr;
            continue;
          }

          if (
            response.ok ||
            (response.status >= 200 && response.status < 500)
          ) {
            this.recordSuccess(host);
            return response;
          }

          // 5xx status codes trigger retry & circuit failure count
          this.recordFailure(host);
          lastError = new Error(
            `HTTP Error ${response.status}: ${response.statusText}`,
          );
          break;
        }
      } catch (err: any) {
        if (
          err instanceof SsrfBlockedError ||
          err?.name === "SsrfBlockedError" ||
          err instanceof RedirectError ||
          err?.name === "RedirectError"
        ) {
          throw err;
        }
        const host = this.getHost(url);
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

export const defaultNotificationHttpClient = new NotificationHttpClient({
  validateUrl: isSafeWebhookUrl,
});
