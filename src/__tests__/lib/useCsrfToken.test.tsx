import {
  useCsrfToken,
  refreshCsrfToken,
  ensureCsrfToken,
  getCurrentCsrfToken,
} from "@/hooks/useCsrfToken";
import { renderHook } from "@testing-library/react";

// Mock Clerk
jest.mock("@clerk/nextjs", () => ({
  useUser: () => ({
    isSignedIn: true,
    isLoaded: true,
    user: { id: "user_123" },
  }),
}));

// Mock i18next
jest.mock("i18next", () => ({
  on: jest.fn(),
  off: jest.fn(),
}));

function jsonResponse(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name: string) {
        const lower = name.toLowerCase();
        if (lower === "content-type")
          return headers["content-type"] ?? "application/json";
        for (const [k, v] of Object.entries(headers)) {
          if (k.toLowerCase() === lower) return v;
        }
        return null;
      },
    },
    clone() {
      return this;
    },
    json: async () => data,
  };
}

describe("useCsrfToken fetch interceptor auto-retry", () => {
  let originalFetch: typeof window.fetch;
  let originalGlobalFetch: typeof global.fetch;

  beforeAll(() => {
    originalFetch = window.fetch;
    originalGlobalFetch = global.fetch;
  });

  afterAll(() => {
    window.fetch = originalFetch;
    global.fetch = originalGlobalFetch;
  });

  it("automatically refreshes CSRF token and retries a failed mutating request", async () => {
    let csrfTokenCallCount = 0;
    let mainCallCount = 0;

    const mockFetch = jest
      .fn()
      .mockImplementation(async (input: any, init: any) => {
        const url = typeof input === "string" ? input : input.url;

        if (url.includes("/api/auth/csrf-token")) {
          csrfTokenCallCount++;
          return {
            ok: true,
            status: 200,
            headers: {
              get(name: string) {
                if (name.toLowerCase() === "content-type")
                  return "application/json";
                return null;
              },
            },
            json: async () => ({
              csrfToken: `new-csrf-token-${csrfTokenCallCount}`,
            }),
          };
        }

        if (url.includes("/api/test-mutation")) {
          mainCallCount++;
          if (mainCallCount === 1) {
            // First attempt fails with 403 CSRF validation error
            return {
              ok: false,
              status: 403,
              headers: {
                get(name: string) {
                  if (name.toLowerCase() === "content-type")
                    return "application/json";
                  return null;
                },
              },
              clone: function () {
                return this;
              },
              json: async () => ({ error: "CSRF validation failed." }),
            };
          } else {
            // Second attempt (retry) succeeds
            return {
              ok: true,
              status: 200,
              json: async () => ({
                success: true,
                receivedToken: init.headers.get("x-csrf-token"),
              }),
            };
          }
        }

        return { ok: true, status: 200 };
      }) as any;

    window.fetch = mockFetch;
    global.fetch = mockFetch;

    // Render hook to register fetch interceptor and wait for initial load to settle
    renderHook(() => useCsrfToken());
    await new Promise((r) => setTimeout(r, 50));

    // Trigger initial mutation request
    const response = await fetch("/api/test-mutation", {
      method: "POST",
      body: JSON.stringify({ data: "test" }),
    });

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.receivedToken).toBe("new-csrf-token-2");
    expect(csrfTokenCallCount).toBe(2); // Initial load + 403 refresh load
    expect(mainCallCount).toBe(2); // Initial attempt + retry attempt
  });
});

describe("useCsrfToken deduplication, exponential backoff, and 429 handling", () => {
  let originalWindowFetch: typeof window.fetch;
  let originalGlobalFetch: typeof global.fetch;

  beforeEach(() => {
    originalWindowFetch = window.fetch;
    originalGlobalFetch = global.fetch;
  });

  afterEach(() => {
    window.fetch = originalWindowFetch;
    global.fetch = originalGlobalFetch;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  function setMockFetch(fn: (...args: any[]) => any) {
    const mock = jest.fn().mockImplementation(fn) as any;
    window.fetch = mock;
    global.fetch = mock;
    return mock;
  }

  // 1. Single request when fetchFreshToken is called concurrently
  it("sends a single network request when refreshCsrfToken is called concurrently", async () => {
    let fetchCount = 0;
    const mock = setMockFetch(async () => {
      fetchCount++;
      return jsonResponse({ csrfToken: "token-concurrent-single" });
    });

    const results = await Promise.all([
      refreshCsrfToken(),
      refreshCsrfToken(),
      refreshCsrfToken(),
      refreshCsrfToken(),
    ]);

    expect(fetchCount).toBe(1);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      "token-concurrent-single",
      "token-concurrent-single",
      "token-concurrent-single",
      "token-concurrent-single",
    ]);
  });

  // 2. All concurrent callers receive the same successful token
  it("ensures all concurrent callers receive the exact same successful token", async () => {
    setMockFetch(async () => {
      return jsonResponse({ csrfToken: "shared-identical-token" });
    });

    const [t1, t2, t3] = await Promise.all([
      refreshCsrfToken(),
      refreshCsrfToken(),
      refreshCsrfToken(),
    ]);

    expect(t1).toBe("shared-identical-token");
    expect(t2).toBe("shared-identical-token");
    expect(t3).toBe("shared-identical-token");
    expect(getCurrentCsrfToken()).toBe("shared-identical-token");
  });

  // 3. In-flight promise is cleared after success
  it("clears in-flight promise after success so subsequent calls perform new requests", async () => {
    let callCount = 0;
    setMockFetch(async () => {
      callCount++;
      return jsonResponse({ csrfToken: `token-call-${callCount}` });
    });

    const firstToken = await refreshCsrfToken();
    expect(firstToken).toBe("token-call-1");
    expect(callCount).toBe(1);

    const secondToken = await refreshCsrfToken();
    expect(secondToken).toBe("token-call-2");
    expect(callCount).toBe(2);
  });

  // 4. In-flight promise is cleared after failure
  it("clears in-flight promise after failure and does not silently return an invalid token", async () => {
    let callCount = 0;
    setMockFetch(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("Network connection lost");
      }
      return jsonResponse({ csrfToken: "recovered-after-fail" });
    });

    const failedResult = await refreshCsrfToken();
    expect(failedResult).toBeNull();
    expect(getCurrentCsrfToken()).toBeNull();

    const recoveredResult = await refreshCsrfToken();
    expect(recoveredResult).toBe("recovered-after-fail");
    expect(callCount).toBe(2);
  });

  // 5. HTTP 429 triggers Retry-After handling (seconds and HTTP-date)
  it("triggers Retry-After handling when response status is 429 (seconds format)", async () => {
    jest.useFakeTimers();
    let attempts = 0;

    setMockFetch(async () => {
      attempts++;
      if (attempts === 1) {
        return jsonResponse({ error: "Too Many Requests" }, 429, {
          "Retry-After": "2",
        });
      }
      return jsonResponse({ csrfToken: "token-after-retry-seconds" });
    });

    const promise = refreshCsrfToken();

    await jest.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(1);

    // At 1999ms, the retry has not fired yet
    await jest.advanceTimersByTimeAsync(1999);
    expect(attempts).toBe(1);

    // At 2000ms, the retry fires
    await jest.advanceTimersByTimeAsync(1);
    const result = await promise;

    expect(attempts).toBe(2);
    expect(result).toBe("token-after-retry-seconds");
  });

  it("triggers Retry-After handling when response status is 429 (HTTP-date format)", async () => {
    jest.useFakeTimers();
    const baseTime = 1700000000000;
    jest.setSystemTime(baseTime);
    const futureDate = new Date(baseTime + 3000).toUTCString();
    let attempts = 0;

    setMockFetch(async () => {
      attempts++;
      if (attempts === 1) {
        return jsonResponse({ error: "Too Many Requests" }, 429, {
          "Retry-After": futureDate,
        });
      }
      return jsonResponse({ csrfToken: "token-after-http-date" });
    });

    const promise = refreshCsrfToken();

    await jest.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(1);

    await jest.advanceTimersByTimeAsync(2999);
    expect(attempts).toBe(1);

    await jest.advanceTimersByTimeAsync(1);
    const result = await promise;

    expect(attempts).toBe(2);
    expect(result).toBe("token-after-http-date");
  });

  // 6. Exponential backoff is used when Retry-After is absent
  it("uses exponential backoff when Retry-After header is absent", async () => {
    jest.useFakeTimers();
    jest.spyOn(Math, "random").mockReturnValue(0);
    let attempts = 0;

    setMockFetch(async () => {
      attempts++;
      if (attempts === 1) {
        return jsonResponse({ error: "Rate limit reached" }, 429);
      }
      return jsonResponse({ csrfToken: "exponential-backoff-token" });
    });

    const promise = refreshCsrfToken();

    await jest.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(1);

    // Fallback delay for attempt 1 without jitter is 500ms
    await jest.advanceTimersByTimeAsync(499);
    expect(attempts).toBe(1);

    await jest.advanceTimersByTimeAsync(1);
    const token = await promise;

    expect(attempts).toBe(2);
    expect(token).toBe("exponential-backoff-token");
  });

  // 7. Jitter is bounded and does not break retry behavior
  it("verifies jitter is bounded and preserves retry progression", async () => {
    jest.useFakeTimers();
    // Maximum jitter (Math.random() === 1) -> 20% of base 500ms is 100ms
    jest.spyOn(Math, "random").mockReturnValue(1);
    let attempts = 0;

    setMockFetch(async () => {
      attempts++;
      if (attempts === 1) {
        return jsonResponse({ error: "Rate limit" }, 429);
      }
      return jsonResponse({ csrfToken: "jitter-token" });
    });

    const promise = refreshCsrfToken();

    await jest.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(1);

    // Total delay is 500 + 100 = 600ms. At 599ms, still waiting
    await jest.advanceTimersByTimeAsync(599);
    expect(attempts).toBe(1);

    // At 600ms, retry occurs
    await jest.advanceTimersByTimeAsync(1);
    const token = await promise;

    expect(attempts).toBe(2);
    expect(token).toBe("jitter-token");
  });

  // 8. Maximum of 3 automatic retries
  it("stops retrying after a maximum of 3 automatic retries (4 total requests) and returns null", async () => {
    jest.useFakeTimers();
    jest.spyOn(Math, "random").mockReturnValue(0);
    let attempts = 0;

    setMockFetch(async () => {
      attempts++;
      return jsonResponse({ error: "Rate limit exceeded" }, 429);
    });

    const promise = refreshCsrfToken();

    // Initial attempt: t = 0
    await jest.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(1);

    // Retry 1: after 500ms
    await jest.advanceTimersByTimeAsync(500);
    expect(attempts).toBe(2);

    // Retry 2: after 1000ms
    await jest.advanceTimersByTimeAsync(1000);
    expect(attempts).toBe(3);

    // Retry 3: after 2000ms
    await jest.advanceTimersByTimeAsync(2000);
    expect(attempts).toBe(4);

    // No 4th retry should occur
    const result = await promise;
    expect(result).toBeNull();
    expect(getCurrentCsrfToken()).toBeNull();
    expect(attempts).toBe(4);
  });

  // 9. No retry for ordinary HTTP 400/401/403 responses
  it("does not retry ordinary HTTP 400, 401, or 403 responses", async () => {
    const errorStatuses = [400, 401, 403, 500];

    for (const status of errorStatuses) {
      let callCount = 0;
      setMockFetch(async () => {
        callCount++;
        return jsonResponse({ error: `Error ${status}` }, status);
      });

      const token = await refreshCsrfToken();
      expect(token).toBeNull();
      expect(callCount).toBe(1);
      expect(getCurrentCsrfToken()).toBeNull();
    }
  });

  // 10. Successful token retrieval after a retry
  it("successfully retrieves token after recovering from an initial 429 retry", async () => {
    jest.useFakeTimers();
    jest.spyOn(Math, "random").mockReturnValue(0);
    let attempts = 0;

    setMockFetch(async () => {
      attempts++;
      if (attempts === 1) {
        return jsonResponse({ error: "Rate limited" }, 429);
      }
      return jsonResponse({ csrfToken: "recovered-after-retry" });
    });

    const promise = refreshCsrfToken();

    await jest.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(1);

    await jest.advanceTimersByTimeAsync(500);
    const token = await promise;

    expect(attempts).toBe(2);
    expect(token).toBe("recovered-after-retry");
    expect(getCurrentCsrfToken()).toBe("recovered-after-retry");
  });

  // 11. Multiple hook instances do not generate duplicate requests
  it("does not generate duplicate requests when multiple hook instances mount concurrently", async () => {
    let fetchCount = 0;
    setMockFetch(async (input: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/api/auth/csrf-token")) {
        fetchCount++;
        return jsonResponse({ csrfToken: "multi-instance-token" });
      }
      return jsonResponse({});
    });

    renderHook(() => useCsrfToken());
    renderHook(() => useCsrfToken());
    renderHook(() => useCsrfToken());

    await new Promise((r) => setTimeout(r, 50));

    expect(fetchCount).toBe(1);
    expect(getCurrentCsrfToken()).toBe("multi-instance-token");
  });

  // Additional test for ensureCsrfToken cache hit
  it("ensureCsrfToken returns cached token when available without sending a new fetch", async () => {
    let fetchCount = 0;
    setMockFetch(async () => {
      fetchCount++;
      return jsonResponse({ csrfToken: "cached-token-value" });
    });

    const token1 = await refreshCsrfToken();
    expect(token1).toBe("cached-token-value");
    expect(fetchCount).toBe(1);

    const token2 = await ensureCsrfToken();
    expect(token2).toBe("cached-token-value");
    expect(fetchCount).toBe(1); // Cached hit, no second fetch
  });
});
