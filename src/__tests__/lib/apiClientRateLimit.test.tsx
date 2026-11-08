/**
 * Rate-limit quota tracking, countdown toasts and automatic retry (#1732).
 */
import React from "react";
import { render, screen, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  apiFetch,
  classifyEndpoint,
  getRateLimitQuota,
  _resetRateLimitQuotasForTesting,
  _setCsrfTokenForTesting,
  type RateLimitEventDetail,
} from "@/lib/apiClient";
import { useRateLimit, useRateLimitQuota } from "@/hooks/useRateLimit";
import { ToastProvider } from "@/components/ui/Toast";

const ok = (headers: Record<string, string> = {}) =>
  new Response("{}", { status: 200, headers: new Headers(headers) });
const limited = (headers: Record<string, string> = { "Retry-After": "2" }) =>
  new Response("{}", { status: 429, headers: new Headers(headers) });

let events: RateLimitEventDetail[] = [];
const onRateLimit = (e: Event) => events.push((e as CustomEvent<RateLimitEventDetail>).detail);
const originalFetch = global.fetch;

beforeEach(() => {
  jest.useFakeTimers();
  events = [];
  _resetRateLimitQuotasForTesting();
  _setCsrfTokenForTesting("csrf-token");
  window.addEventListener("rate-limit-triggered", onRateLimit);
});

afterEach(() => {
  window.removeEventListener("rate-limit-triggered", onRateLimit);
  global.fetch = originalFetch;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("endpoint classification", () => {
  it("buckets by path, not query string", () => {
    expect(classifyEndpoint("/api/chat")).toBe("chat");
    expect(classifyEndpoint("/api/chat?next=/book")).toBe("chat");
    expect(classifyEndpoint("/api/reservations/book")).toBe("book");
    expect(classifyEndpoint("/api/bookings/confirm")).toBe("book");
    expect(classifyEndpoint("https://app.test/api/venues?lat=1")).toBe("other");
  });

  it("no longer reports non-chat 429s as chat", async () => {
    global.fetch = jest.fn().mockResolvedValue(limited({ "Retry-After": "5" }));
    await apiFetch("/api/venues?lat=1");
    expect(events[0]).toMatchObject({ endpoint: "other", bucket: "/api/venues", willRetry: false });
  });
});

describe("quota tracking", () => {
  it("records limit / remaining / reset from successful responses", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      ok({ "X-RateLimit-Limit": "10", "X-RateLimit-Remaining": "7", "X-RateLimit-Reset": "30" }),
    );
    await apiFetch("/api/chat");
    const quota = getRateLimitQuota("chat")!;
    expect(quota).toMatchObject({ limit: 10, remaining: 7, retryAt: null });
    expect(quota.resetAt! - Date.now()).toBe(30_000);
  });

  it("understands IETF RateLimit-* headers", async () => {
    global.fetch = jest.fn().mockResolvedValue(ok({ "RateLimit-Limit": "100", "RateLimit-Remaining": "1" }));
    await apiFetch("/api/venues");
    expect(getRateLimitQuota("/api/venues")).toMatchObject({ limit: 100, remaining: 1 });
  });

  it.each([
    ["epoch seconds", () => String(Math.floor(Date.now() / 1000) + 30)],
    ["epoch milliseconds", () => String(Date.now() + 30_000)],
    ["delta seconds", () => "30"],
  ])("parses X-RateLimit-Reset given as %s", async (_label, reset) => {
    global.fetch = jest.fn().mockResolvedValue(limited({ "X-RateLimit-Reset": reset() }));
    await apiFetch("/api/chat");
    expect(events[0].retryAfter).toBeGreaterThanOrEqual(29);
    expect(events[0].retryAfter).toBeLessThanOrEqual(31);
  });

  it("marks the bucket exhausted on 429", async () => {
    global.fetch = jest.fn().mockResolvedValue(limited({ "Retry-After": "9", "X-RateLimit-Limit": "5" }));
    await apiFetch("/api/reservations/book", { method: "POST" });
    expect(getRateLimitQuota("book")).toMatchObject({ limit: 5, remaining: 0 });
    expect(getRateLimitQuota("book")!.retryAt! - Date.now()).toBe(9000);
  });
});

describe("automatic retry", () => {
  it("does not retry unless asked", async () => {
    global.fetch = jest.fn().mockResolvedValue(limited());
    const res = await apiFetch("/api/venues");
    expect(res.status).toBe(429);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("waits for Retry-After, then re-sends and resolves with the success", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(limited()).mockResolvedValueOnce(ok());
    let settled = false;
    const promise = apiFetch("/api/venues", undefined, { retryOnRateLimit: true }).then((r) => {
      settled = true;
      return r;
    });

    await jest.advanceTimersByTimeAsync(1999);
    expect(settled).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(events[0].willRetry).toBe(true);

    await jest.advanceTimersByTimeAsync(1);
    const res = await promise;
    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(getRateLimitQuota("/api/venues")!.retryAt).toBeNull();
  });

  it("gives up after maxRetries and returns the last 429", async () => {
    global.fetch = jest.fn().mockImplementation(async () => limited({ "Retry-After": "1" }));
    const promise = apiFetch("/api/venues", undefined, { retryOnRateLimit: { maxRetries: 2 } });
    await jest.advanceTimersByTimeAsync(5000);
    const res = await promise;

    expect(res.status).toBe(429);
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(events.map((e) => e.willRetry)).toEqual([true, true, false]);
  });

  it("does not wait longer than maxWaitSeconds", async () => {
    global.fetch = jest.fn().mockResolvedValue(limited({ "Retry-After": "120" }));
    const res = await apiFetch("/api/venues", undefined, { retryOnRateLimit: true });
    expect(res.status).toBe(429);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(events[0].willRetry).toBe(false);
  });

  it("stops waiting when the caller aborts", async () => {
    global.fetch = jest.fn().mockResolvedValue(limited({ "Retry-After": "10" }));
    const controller = new AbortController();
    const promise = apiFetch("/api/venues", { signal: controller.signal }, { retryOnRateLimit: true });
    const assertion = expect(promise).rejects.toThrow();

    await jest.advanceTimersByTimeAsync(1000);
    controller.abort();
    await assertion;
    await jest.advanceTimersByTimeAsync(20_000);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("re-sends a Request body on every attempt", async () => {
    // Body streams schedule internal timers, so this one runs on real time (~1 s).
    jest.useRealTimers();
    const bodies: string[] = [];
    global.fetch = jest.fn().mockImplementation(async (input: Request) => {
      bodies.push(await input.text());
      return bodies.length === 1 ? limited({ "Retry-After": "1" }) : ok();
    });
    const request = new Request("http://localhost/api/chat", { method: "POST", body: "hello" });
    const res = await apiFetch(request, undefined, { retryOnRateLimit: true });
    expect(res.status).toBe(200);
    expect(bodies).toEqual(["hello", "hello"]);
  }, 10_000);

  it("waits for a known quota reset before sending a retrying request", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(limited({ "Retry-After": "3" }));
    await apiFetch("/api/venues"); // no retry: records retryAt = now + 3 s

    (global.fetch as jest.Mock).mockResolvedValue(ok());
    const promise = apiFetch("/api/venues", undefined, { retryOnRateLimit: true });
    await jest.advanceTimersByTimeAsync(2900);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(100);
    expect((await promise).status).toBe(200);
  });
});

describe("hooks", () => {
  function Quota({ bucket }: { bucket: string }) {
    const q = useRateLimitQuota(bucket);
    return (
      <div data-testid="quota">
        {`${q.limit}/${q.remaining}/${q.usage}/${q.retryAfter}/${q.isLimited}`}
      </div>
    );
  }

  it("useRateLimitQuota exposes live usage and the retry countdown", async () => {
    render(<Quota bucket="/api/venues" />);
    expect(screen.getByTestId("quota")).toHaveTextContent("null/null/null/0/false");

    global.fetch = jest.fn().mockResolvedValue(ok({ "X-RateLimit-Limit": "4", "X-RateLimit-Remaining": "1" }));
    await act(() => apiFetch("/api/venues"));
    expect(screen.getByTestId("quota")).toHaveTextContent("4/1/0.75/0/false");

    global.fetch = jest.fn().mockResolvedValue(limited({ "Retry-After": "3" }));
    await act(() => apiFetch("/api/venues"));
    expect(screen.getByTestId("quota")).toHaveTextContent("4/0/1/3/true");

    act(() => jest.advanceTimersByTime(3000));
    expect(screen.getByTestId("quota")).toHaveTextContent("4/0/1/0/false");
  });

  function Countdown({ endpoint }: { endpoint: "chat" | "book" }) {
    return <div data-testid="retry">{useRateLimit(endpoint)}</div>;
  }

  it("useRateLimit ignores 429s from unrelated endpoints", async () => {
    render(<Countdown endpoint="chat" />);
    global.fetch = jest.fn().mockResolvedValue(limited({ "Retry-After": "30" }));
    await act(() => apiFetch("/api/venues"));
    expect(screen.getByTestId("retry")).toHaveTextContent("0");
  });

  it("useRateLimit stays accurate when timers are throttled (background tab)", () => {
    render(<Countdown endpoint="chat" />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent("rate-limit-triggered", { detail: { retryAfter: 60, endpoint: "chat" } }),
      );
    });
    // 30 s pass but the browser only lets one interval tick fire.
    act(() => {
      jest.setSystemTime(Date.now() + 30_000);
      jest.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId("retry")).toHaveTextContent("29");
  });
});

describe("countdown toast", () => {
  const fire = (detail: Partial<RateLimitEventDetail>) =>
    act(() => {
      window.dispatchEvent(new CustomEvent("rate-limit-triggered", { detail }));
    });

  it("keeps plurals for 11, 21, … seconds", () => {
    render(<ToastProvider><div /></ToastProvider>);
    fire({ retryAfter: 11, endpoint: "chat" });
    expect(screen.getByText("Rate limit reached. Try again in 11 seconds")).toBeInTheDocument();
    act(() => jest.advanceTimersByTime(10_000));
    expect(screen.getByText("Rate limit reached. Try again in 1 second")).toBeInTheDocument();
  });

  it("says when the request will be retried automatically", () => {
    render(<ToastProvider><div /></ToastProvider>);
    fire({ retryAfter: 4, endpoint: "other", willRetry: true });
    expect(screen.getByText("Rate limit reached. Retrying automatically in 4 seconds")).toBeInTheDocument();
  });

  it("counts down against the clock when timers are throttled", () => {
    render(<ToastProvider><div /></ToastProvider>);
    fire({ retryAfter: 60, endpoint: "chat" });
    act(() => {
      jest.setSystemTime(Date.now() + 45_000);
      jest.advanceTimersByTime(1000);
    });
    expect(screen.getByText("Rate limit reached. Try again in 14 seconds")).toBeInTheDocument();
  });
});
