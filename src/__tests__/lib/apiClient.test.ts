import {
  apiFetch,
  ensureCsrfToken,
  getCsrfTokenAge,
  isCsrfTokenNearExpiration,
  CSRF_REFRESH_THRESHOLD_MS,
  _resetCsrfStateForTesting,
  _setCsrfTokenForTesting,
} from "../../lib/apiClient";
import { CSRF_HEADER_NAME } from "../../lib/csrf";

describe("apiFetch client wrapper", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("should return the response if status is not 429", async () => {
    const mockResponse = new Response("ok", { status: 200 });
    global.fetch = jest.fn().mockResolvedValue(mockResponse);

    const res = await apiFetch("/api/chat");
    expect(res.status).toBe(200);
  });

  it("should dispatch event with correct retryAfter and endpoint for chat 429", async () => {
    const mockResponse = new Response(JSON.stringify({ retryAfter: 15 }), {
      status: 429,
      headers: new Headers({
        "Content-Type": "application/json",
        "Retry-After": "15",
        "X-RateLimit-Reset": String(Math.ceil((Date.now() + 15000) / 1000)),
      }),
    });
    global.fetch = jest.fn().mockResolvedValue(mockResponse);

    const eventListener = jest.fn();
    window.addEventListener("rate-limit-triggered", eventListener);

    const res = await apiFetch("/api/chat");
    expect(res.status).toBe(429);

    expect(eventListener).toHaveBeenCalled();
    const event = eventListener.mock.calls[0][0] as CustomEvent;
    expect(event.detail.retryAfter).toBe(15);
    expect(event.detail.endpoint).toBe("chat");

    window.removeEventListener("rate-limit-triggered", eventListener);
  });

  it("should identify booking endpoint correctly and dispatch event", async () => {
    const mockResponse = new Response("rate limited", {
      status: 429,
      headers: new Headers({
        "Retry-After": "30",
      }),
    });
    global.fetch = jest.fn().mockResolvedValue(mockResponse);

    const eventListener = jest.fn();
    window.addEventListener("rate-limit-triggered", eventListener);

    await apiFetch("/api/reservations/book");

    expect(eventListener).toHaveBeenCalled();
    const event = eventListener.mock.calls[0][0] as CustomEvent;
    expect(event.detail.retryAfter).toBe(30);
    expect(event.detail.endpoint).toBe("book");

    window.removeEventListener("rate-limit-triggered", eventListener);
  });

  it("should parse HTTP Date format in Retry-After header", async () => {
    const futureDate = new Date(Date.now() + 45000).toUTCString();
    const mockResponse = new Response("rate limited", {
      status: 429,
      headers: new Headers({
        "Retry-After": futureDate,
      }),
    });
    global.fetch = jest.fn().mockResolvedValue(mockResponse);

    const eventListener = jest.fn();
    window.addEventListener("rate-limit-triggered", eventListener);

    await apiFetch("/api/chat");

    expect(eventListener).toHaveBeenCalled();
    const event = eventListener.mock.calls[0][0] as CustomEvent;
    expect(event.detail.retryAfter).toBeGreaterThanOrEqual(44);
    expect(event.detail.retryAfter).toBeLessThanOrEqual(46);

    window.removeEventListener("rate-limit-triggered", eventListener);
  });

  it("should fallback to json body retry_after when headers are missing", async () => {
    const mockResponse = new Response(JSON.stringify({ retry_after: 25 }), {
      status: 429,
      headers: new Headers({
        "Content-Type": "application/json",
      }),
    });
    global.fetch = jest.fn().mockResolvedValue(mockResponse);

    const eventListener = jest.fn();
    window.addEventListener("rate-limit-triggered", eventListener);

    await apiFetch("/api/chat");

    expect(eventListener).toHaveBeenCalled();
    const event = eventListener.mock.calls[0][0] as CustomEvent;
    expect(event.detail.retryAfter).toBe(25);

    window.removeEventListener("rate-limit-triggered", eventListener);
  });
});

describe("apiFetch automated CSRF token auto-refresh before API mutation calls", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    _resetCsrfStateForTesting();
    originalFetch = global.fetch;
  });

  afterEach(() => {
    _resetCsrfStateForTesting();
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("fetches /api/auth/csrf-token first when token is missing and attaches the refreshed token to the mutation", async () => {
    const callOrder: string[] = [];
    global.fetch = jest
      .fn()
      .mockImplementation((input: RequestInfo | URL, _init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : (input as Request).url;

        if (url.includes("/api/auth/csrf-token")) {
          callOrder.push("csrf-refresh");
          return Promise.resolve(
            new Response(
              JSON.stringify({ csrfToken: "fresh-csrf-token-123" }),
              {
                status: 200,
                headers: { "Content-Type": "application/json" },
              },
            ),
          );
        }

        callOrder.push("mutation");
        return Promise.resolve(
          new Response(JSON.stringify({ success: true }), { status: 200 }),
        );
      });

    const res = await apiFetch("/api/venues", {
      method: "POST",
      body: JSON.stringify({ name: "Main Hall" }),
    });

    expect(res.status).toBe(200);
    // Verify order of operations: CSRF refresh must happen BEFORE the mutation request
    expect(callOrder).toEqual(["csrf-refresh", "mutation"]);
    expect(global.fetch).toHaveBeenCalledTimes(2);

    // Verify the mutation request has the x-csrf-token header attached
    const mutationCall = (global.fetch as jest.Mock).mock.calls[1];
    expect(mutationCall[0]).toBe("/api/venues");
    const headers = new Headers(mutationCall[1]?.headers);
    expect(headers.get(CSRF_HEADER_NAME)).toBe("fresh-csrf-token-123");
  });

  it("automatically refreshes CSRF token before mutation when token is near expiration", async () => {
    // Seed a token whose age exceeds the refresh threshold
    _setCsrfTokenForTesting(
      "near-expired-token",
      Date.now() - (CSRF_REFRESH_THRESHOLD_MS + 5000),
    );
    expect(isCsrfTokenNearExpiration()).toBe(true);

    const callOrder: string[] = [];
    global.fetch = jest
      .fn()
      .mockImplementation((input: RequestInfo | URL, _init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : (input as Request).url;

        if (url.includes("/api/auth/csrf-token")) {
          callOrder.push("csrf-refresh");
          return Promise.resolve(
            new Response(JSON.stringify({ csrfToken: "refreshed-token-999" }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }

        callOrder.push("mutation");
        return Promise.resolve(
          new Response(JSON.stringify({ updated: true }), { status: 200 }),
        );
      });

    const res = await apiFetch("/api/bookings/101", {
      method: "PUT",
      body: JSON.stringify({ status: "confirmed" }),
    });

    expect(res.status).toBe(200);
    expect(callOrder).toEqual(["csrf-refresh", "mutation"]);
    expect(global.fetch).toHaveBeenCalledTimes(2);

    const mutationCall = (global.fetch as jest.Mock).mock.calls[1];
    const headers = new Headers(mutationCall[1]?.headers);
    expect(headers.get(CSRF_HEADER_NAME)).toBe("refreshed-token-999");
    expect(isCsrfTokenNearExpiration()).toBe(false);
  });

  it("reuses a valid young token without making an unnecessary CSRF refresh request", async () => {
    // Seed a young token fetched 5 seconds ago
    _setCsrfTokenForTesting("young-valid-token", Date.now() - 5000);
    expect(isCsrfTokenNearExpiration()).toBe(false);

    global.fetch = jest
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ deleted: true }), { status: 200 }),
      );

    const res = await apiFetch("/api/bookings/101", { method: "DELETE" });

    expect(res.status).toBe(200);
    // Only 1 fetch call: the DELETE mutation itself; no refresh was needed
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const call = (global.fetch as jest.Mock).mock.calls[0];
    expect(call[0]).toBe("/api/bookings/101");
    const headers = new Headers(call[1]?.headers);
    expect(headers.get(CSRF_HEADER_NAME)).toBe("young-valid-token");
  });

  it("does not trigger CSRF refresh or attach CSRF header on GET requests", async () => {
    // Token is completely missing
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: [] }), { status: 200 }),
      );

    const res = await apiFetch("/api/venues");

    expect(res.status).toBe(200);
    // Exactly 1 fetch call: the GET request itself
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const call = (global.fetch as jest.Mock).mock.calls[0];
    expect(call[0]).toBe("/api/venues");
    const headers = call[1]?.headers ? new Headers(call[1].headers) : null;
    expect(headers ? headers.get(CSRF_HEADER_NAME) : null).toBeNull();
  });

  it("does not trigger CSRF refresh on HEAD and OPTIONS requests", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));

    await apiFetch("/api/venues", { method: "HEAD" });
    await apiFetch("/api/venues", { method: "OPTIONS" });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    for (const call of (global.fetch as jest.Mock).mock.calls) {
      expect(call[0]).toBe("/api/venues");
      const headers = call[1]?.headers ? new Headers(call[1].headers) : null;
      expect(headers ? headers.get(CSRF_HEADER_NAME) : null).toBeNull();
    }
  });

  it("attaches x-csrf-token for all mutation HTTP methods (POST, PUT, DELETE, PATCH, case-insensitive)", async () => {
    _setCsrfTokenForTesting("static-valid-token", Date.now());

    const methods = [
      "POST",
      "PUT",
      "DELETE",
      "PATCH",
      "post",
      "put",
      "delete",
      "patch",
    ];

    for (const method of methods) {
      global.fetch = jest
        .fn()
        .mockResolvedValue(new Response("ok", { status: 200 }));

      await apiFetch("/api/test-mutation", { method });

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const call = (global.fetch as jest.Mock).mock.calls[0];
      const headers = new Headers(call[1]?.headers);
      expect(headers.get(CSRF_HEADER_NAME)).toBe("static-valid-token");
    }
  });

  it("deduplicates concurrent mutation refresh calls with single-flight guard", async () => {
    let resolveCsrf!: (res: Response) => void;
    const csrfPending = new Promise<Response>((resolve) => {
      resolveCsrf = resolve;
    });

    let csrfFetchCount = 0;
    global.fetch = jest
      .fn()
      .mockImplementation((input: RequestInfo | URL, _init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : (input as Request).url;

        if (url.includes("/api/auth/csrf-token")) {
          csrfFetchCount++;
          return csrfPending;
        }

        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), { status: 200 }),
        );
      });

    // Fire 3 simultaneous mutations when token is uninitialized
    const p1 = apiFetch("/api/entity/1", { method: "POST" });
    const p2 = apiFetch("/api/entity/2", { method: "PUT" });
    const p3 = apiFetch("/api/entity/3", { method: "DELETE" });

    // Only a single refresh request should be in-flight
    expect(csrfFetchCount).toBe(1);

    // Resolve the single-flight refresh request
    resolveCsrf(
      new Response(
        JSON.stringify({ csrfToken: "single-flight-shared-token" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(200);

    // 1 refresh call + 3 mutation calls = 4 total calls
    expect(global.fetch).toHaveBeenCalledTimes(4);
    expect(csrfFetchCount).toBe(1);

    // All 3 mutations must carry the resolved token
    for (let i = 1; i <= 3; i++) {
      const call = (global.fetch as jest.Mock).mock.calls[i];
      const headers = new Headers(call[1]?.headers);
      expect(headers.get(CSRF_HEADER_NAME)).toBe("single-flight-shared-token");
    }
  });

  it("preserves caller custom headers and works when Request object is passed", async () => {
    _setCsrfTokenForTesting("header-preservation-token", Date.now());

    // 1. With plain object headers
    global.fetch = jest
      .fn()
      .mockResolvedValue(new Response("ok", { status: 200 }));

    await apiFetch("/api/custom-headers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Custom-Client": "worksphere-mobile",
      },
    });

    let call = (global.fetch as jest.Mock).mock.calls[0];
    let headers = new Headers(call[1]?.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-Custom-Client")).toBe("worksphere-mobile");
    expect(headers.get(CSRF_HEADER_NAME)).toBe("header-preservation-token");

    // 2. With Request instance
    global.fetch = jest
      .fn()
      .mockResolvedValue(new Response("ok", { status: 200 }));

    const requestObj = new Request("http://localhost/api/request-instance", {
      method: "POST",
      headers: { "X-Request-Source": "test-runner" },
    });

    await apiFetch(requestObj);

    call = (global.fetch as jest.Mock).mock.calls[0];
    headers = new Headers(call[1]?.headers);
    expect(headers.get("X-Request-Source")).toBe("test-runner");
    expect(headers.get(CSRF_HEADER_NAME)).toBe("header-preservation-token");
  });

  it("handles CSRF fetch network errors gracefully without crashing apiFetch", async () => {
    global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;

      if (url.includes("/api/auth/csrf-token")) {
        return Promise.reject(new Error("Network connection lost"));
      }

      return Promise.resolve(new Response("Rejected", { status: 403 }));
    });

    const res = await apiFetch("/api/venues", { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("refreshes token and retries on 403 CSRF validation rejection", async () => {
    let callIndex = 0;
    global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;

      if (url.includes("/api/auth/csrf-token")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ csrfToken: "reactive-recovered-token" }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }

      callIndex++;
      if (callIndex === 1) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              code: "CSRF_INVALID",
              error: "CSRF validation failed.",
            }),
            {
              status: 403,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }

      return Promise.resolve(
        new Response(JSON.stringify({ recovered: true }), { status: 200 }),
      );
    });

    _setCsrfTokenForTesting("invalid-server-token", Date.now());
    const res = await apiFetch("/api/update", { method: "POST" });

    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(3); // First attempt -> 403, CSRF fetch, retry attempt -> 200
  });

  it("correctly exposes token age and near-expiration status via helpers", async () => {
    expect(getCsrfTokenAge()).toBe(Infinity);
    expect(isCsrfTokenNearExpiration()).toBe(true);

    const now = Date.now();
    _setCsrfTokenForTesting("fresh-token", now - 1000);
    expect(getCsrfTokenAge()).toBeGreaterThanOrEqual(900);
    expect(isCsrfTokenNearExpiration()).toBe(false);

    _setCsrfTokenForTesting("old-token", now - CSRF_REFRESH_THRESHOLD_MS);
    expect(isCsrfTokenNearExpiration()).toBe(true);
  });

  it("ensureCsrfToken returns cached token when valid and fetches when missing", async () => {
    // When missing
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ csrfToken: "ensured-fresh-token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const token = await ensureCsrfToken();
    expect(token).toBe("ensured-fresh-token");
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // When valid, subsequent call should return cached token without fetch
    const cachedToken = await ensureCsrfToken();
    expect(cachedToken).toBe("ensured-fresh-token");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
