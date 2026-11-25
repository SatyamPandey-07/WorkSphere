import type { Metric } from "web-vitals";
import { NextRequest } from "next/server";

type MetricCallback = (metric: Metric) => void;

const mockOnCLS = jest.fn<void, [MetricCallback]>();
const mockOnINP = jest.fn<void, [MetricCallback]>();
const mockOnLCP = jest.fn<void, [MetricCallback]>();
const mockOnFCP = jest.fn<void, [MetricCallback]>();
const mockOnTTFB = jest.fn<void, [MetricCallback]>();
const mockTrackEvent = jest.fn();
const mockCheckRateLimit = jest.fn();

jest.mock("web-vitals", () => ({
  onCLS: (callback: (metric: Metric) => void) => mockOnCLS(callback),
  onINP: (callback: (metric: Metric) => void) => mockOnINP(callback),
  onLCP: (callback: (metric: Metric) => void) => mockOnLCP(callback),
  onFCP: (callback: (metric: Metric) => void) => mockOnFCP(callback),
  onTTFB: (callback: (metric: Metric) => void) => mockOnTTFB(callback),
}));

jest.mock("@/lib/analytics", () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}));

jest.mock("@/lib/rateLimit", () => ({
  checkTokenBucketRateLimit: (...args: unknown[]) =>
    mockCheckRateLimit(...args),
  getClientIp: () => "203.0.113.10",
  RATE_TIERS: {
    telemetry: {
      name: "telemetry",
      limit: 120,
      windowMs: 60_000,
      interval: "1 m",
    },
  },
}));

import {
  createWebVitalsPayload,
  DEFAULT_WEB_VITALS_SAMPLE_RATE,
  getSessionSamplingDecision,
  resetWebVitalsReporterForTests,
  sendWebVitalsPayload,
  setWebVitalsConsent,
  startWebVitalsReporter,
  stopWebVitalsReporter,
  type WebVitalsPayload,
} from "@/lib/telemetry/webVitalsReporter";
import { POST } from "@/app/api/telemetry/vitals/route";

const validPayload: WebVitalsPayload = {
  name: "LCP",
  value: 1830,
  rating: "good",
  navigationType: "navigate",
  deviceType: "desktop",
  metricId: "v5-1234",
  timestamp: 1_800_000_000_000,
};

function makeMetric(overrides: Partial<Metric> = {}): Metric {
  return {
    name: "LCP",
    value: 1830,
    rating: "good",
    delta: 1830,
    id: "v5-1234",
    entries: [],
    navigationType: "navigate",
    navigationId: 1,
    ...overrides,
  };
}

function callMetric(observer: typeof mockOnCLS, metric: Metric): void {
  const callback = observer.mock.calls[0]?.[0];
  if (!callback)
    throw new Error("Expected the Web Vitals observer to register");
  callback(metric);
}

function makeRequest(
  body: string,
  headers: Record<string, string> = {
    "content-type": "application/json",
  },
): NextRequest {
  return new NextRequest("http://localhost/api/telemetry/vitals", {
    method: "POST",
    headers,
    body,
  });
}

describe("client Web Vitals reporter", () => {
  let mockSendBeacon: jest.Mock;
  let mockFetch: jest.Mock;
  const originalFetch = global.fetch;
  const originalLocalStorage = window.localStorage;
  const originalSessionStorage = window.sessionStorage;
  const originalPerformanceObserver = window.PerformanceObserver;
  const originalNavigationTiming = Object.getOwnPropertyDescriptor(
    window.performance,
    "getEntriesByType",
  );

  beforeEach(() => {
    resetWebVitalsReporterForTests();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: originalLocalStorage,
    });
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: originalSessionStorage,
    });
    Object.defineProperty(window, "PerformanceObserver", {
      configurable: true,
      value: class MockPerformanceObserver {},
    });
    localStorage.clear();
    sessionStorage.clear();
    mockOnCLS.mockReset();
    mockOnINP.mockReset();
    mockOnLCP.mockReset();
    mockOnFCP.mockReset();
    mockOnTTFB.mockReset();
    mockTrackEvent.mockReset();
    mockCheckRateLimit.mockReset();
    mockCheckRateLimit.mockResolvedValue({
      success: true,
      limit: 120,
      remaining: 119,
      reset: Date.now() + 60_000,
      retryAfter: 0,
      identity: "203.0.113.10",
    });

    mockSendBeacon = jest.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: mockSendBeacon,
    });
    mockFetch = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = mockFetch as typeof fetch;
    setWebVitalsConsent(true);
    jest.spyOn(Math, "random").mockReturnValue(0.1);
  });

  afterEach(() => {
    resetWebVitalsReporterForTests();
    global.fetch = originalFetch;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: originalLocalStorage,
    });
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: originalSessionStorage,
    });
    Object.defineProperty(window, "PerformanceObserver", {
      configurable: true,
      value: originalPerformanceObserver,
    });
    if (originalNavigationTiming) {
      Object.defineProperty(
        window.performance,
        "getEntriesByType",
        originalNavigationTiming,
      );
    } else {
      Reflect.deleteProperty(window.performance, "getEntriesByType");
    }
    jest.restoreAllMocks();
  });

  it("registers CLS, INP, LCP, FCP, and TTFB once", () => {
    expect(DEFAULT_WEB_VITALS_SAMPLE_RATE).toBe(0.2);
    expect(startWebVitalsReporter()).toBe(true);
    expect(startWebVitalsReporter()).toBe(false);

    expect(mockOnCLS).toHaveBeenCalledTimes(1);
    expect(mockOnINP).toHaveBeenCalledTimes(1);
    expect(mockOnLCP).toHaveBeenCalledTimes(1);
    expect(mockOnFCP).toHaveBeenCalledTimes(1);
    expect(mockOnTTFB).toHaveBeenCalledTimes(1);
  });

  it("formats only safe metric fields and preserves the library rating/navigation type", () => {
    window.innerWidth = 500;
    const payload = createWebVitalsPayload(
      makeMetric({
        name: "CLS",
        value: 0.31,
        rating: "poor",
        navigationType: "back-forward-cache",
      }),
    );

    expect(payload).toEqual(
      expect.objectContaining({
        name: "CLS",
        value: 0.31,
        rating: "poor",
        navigationType: "back-forward-cache",
        deviceType: "mobile",
        metricId: "v5-1234",
      }),
    );
    expect(Object.keys(payload ?? {}).sort()).toEqual(
      [
        "deviceType",
        "metricId",
        "name",
        "navigationType",
        "rating",
        "timestamp",
        "value",
      ].sort(),
    );
  });

  it("classifies tablet and desktop by viewport without collecting a user agent", () => {
    window.innerWidth = 800;
    expect(createWebVitalsPayload(makeMetric())?.deviceType).toBe("tablet");
    window.innerWidth = 1280;
    expect(createWebVitalsPayload(makeMetric())?.deviceType).toBe("desktop");
  });

  it("uses navigation timing when a metric does not include navigation type", () => {
    Object.defineProperty(window.performance, "getEntriesByType", {
      configurable: true,
      value: jest.fn(() => [
        { type: "back_forward" } as PerformanceNavigationTiming,
      ]),
    });

    expect(
      createWebVitalsPayload(
        makeMetric({
          navigationType: undefined as unknown as Metric["navigationType"],
        }),
      )?.navigationType,
    ).toBe("back-forward");
  });

  it("sends a JSON beacon payload and does not duplicate it with fetch", async () => {
    sendWebVitalsPayload(validPayload);

    expect(mockSendBeacon).toHaveBeenCalledWith(
      "/api/telemetry/vitals",
      expect.any(Blob),
    );
    const blob = mockSendBeacon.mock.calls[0][1] as Blob;
    expect(blob.type).toBe("application/json");
    const body = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    expect(JSON.parse(body)).toEqual(validPayload);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("falls back to keepalive fetch when sendBeacon is unavailable", () => {
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: undefined,
    });

    sendWebVitalsPayload(validPayload);

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/telemetry/vitals",
      expect.objectContaining({
        method: "POST",
        keepalive: true,
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("falls back exactly once when sendBeacon returns false", () => {
    mockSendBeacon.mockReturnValue(false);

    sendWebVitalsPayload(validPayload);

    expect(mockSendBeacon).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("samples once at the configured 20 percent rate for every metric in a session", () => {
    sessionStorage.clear();
    const random = jest.spyOn(Math, "random").mockReturnValue(0.19);
    startWebVitalsReporter({ samplingRate: 0.2 });
    callMetric(mockOnCLS, makeMetric({ name: "CLS", value: 0.03 }));
    callMetric(mockOnINP, makeMetric({ name: "INP", value: 120 }));

    expect(random).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("worksphere:web-vitals:sample")).toBe(
      "sampled",
    );
    expect(mockSendBeacon).toHaveBeenCalledTimes(2);
  });

  it("does not register observers for a session outside the sample", () => {
    jest.spyOn(Math, "random").mockReturnValue(0.8);

    expect(startWebVitalsReporter({ samplingRate: 0.2 })).toBe(false);
    expect(mockOnCLS).not.toHaveBeenCalled();
    expect(mockSendBeacon).not.toHaveBeenCalled();
  });

  it("reuses a persisted sampling decision without rerolling", () => {
    sessionStorage.setItem("worksphere:web-vitals:sample", "not-sampled");

    expect(getSessionSamplingDecision(1)).toBe(false);
    expect(Math.random).not.toHaveBeenCalled();
  });

  it("uses a stable in-memory sampling decision when session storage is unavailable", () => {
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get: () => {
        throw new Error("Storage is blocked");
      },
    });
    const random = jest.spyOn(Math, "random").mockReturnValue(0.1);

    expect(getSessionSamplingDecision()).toBe(true);
    expect(getSessionSamplingDecision()).toBe(true);
    expect(random).toHaveBeenCalledTimes(1);
  });

  it("does not register when telemetry is disabled or consent is declined", () => {
    expect(startWebVitalsReporter({ enabled: false })).toBe(false);
    setWebVitalsConsent(false);
    expect(startWebVitalsReporter()).toBe(false);
    expect(mockOnCLS).not.toHaveBeenCalled();
  });

  it("fails closed when consent storage is unavailable", () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("Storage is blocked");
      },
    });
    setWebVitalsConsent(null);

    expect(startWebVitalsReporter()).toBe(false);
    expect(mockOnCLS).not.toHaveBeenCalled();
  });

  it("handles missing PerformanceObserver without throwing", () => {
    Object.defineProperty(window, "PerformanceObserver", {
      configurable: true,
      value: undefined,
    });

    expect(startWebVitalsReporter()).toBe(false);
    expect(mockOnCLS).not.toHaveBeenCalled();
  });

  it("ignores invalid metrics and suppresses reports after consent is withdrawn", () => {
    startWebVitalsReporter({ samplingRate: 1 });
    const callback = mockOnCLS.mock.calls[0][0];
    callback({ ...makeMetric(), name: "UNKNOWN" } as unknown as Metric);
    setWebVitalsConsent(false);
    callback(makeMetric({ name: "CLS" }));

    expect(mockSendBeacon).not.toHaveBeenCalled();
  });

  it("stops forwarding metrics when the reporter lifecycle ends", () => {
    startWebVitalsReporter({ samplingRate: 1 });
    const callback = mockOnCLS.mock.calls[0][0];

    stopWebVitalsReporter();
    callback(makeMetric({ name: "CLS" }));

    expect(mockSendBeacon).not.toHaveBeenCalled();
  });
});

describe("POST /api/telemetry/vitals", () => {
  beforeEach(() => {
    mockTrackEvent.mockReset();
    mockCheckRateLimit.mockReset().mockResolvedValue({
      success: true,
      limit: 120,
      remaining: 119,
      reset: Date.now() + 60_000,
      retryAfter: 0,
      identity: "203.0.113.10",
    });
  });

  it("validates and sends accepted metrics to the existing analytics service", async () => {
    const response = await POST(makeRequest(JSON.stringify(validPayload)));

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true });
    expect(mockTrackEvent).toHaveBeenCalledWith("web_vital_reported", {
      name: validPayload.name,
      value: validPayload.value,
      rating: validPayload.rating,
      navigationType: validPayload.navigationType,
      deviceType: validPayload.deviceType,
      timestamp: validPayload.timestamp,
      metricId: validPayload.metricId,
    });
    expect(mockCheckRateLimit).toHaveBeenCalledTimes(1);
  });

  it("rejects unsupported names, invalid ratings, and arbitrary fields", async () => {
    const invalid = {
      ...validPayload,
      name: "FID",
      rating: "excellent",
      userEmail: "private@example.test",
    };

    const response = await POST(makeRequest(JSON.stringify(invalid)));

    expect(response.status).toBe(400);
    expect(mockTrackEvent).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const response = await POST(makeRequest("{"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Malformed JSON payload",
    });
  });

  it("rejects oversized payloads using both content length and streamed size", async () => {
    const declaredTooLarge = await POST(
      makeRequest("{}", {
        "content-type": "application/json",
        "content-length": "2049",
      }),
    );
    const streamedTooLarge = await POST(makeRequest("x".repeat(3000)));

    expect(declaredTooLarge.status).toBe(413);
    expect(streamedTooLarge.status).toBe(413);
    expect(mockTrackEvent).not.toHaveBeenCalled();
  });

  it("returns 415 for non-JSON requests and 429 when rate limited", async () => {
    const wrongType = await POST(
      makeRequest(JSON.stringify(validPayload), {
        "content-type": "text/plain",
      }),
    );
    mockCheckRateLimit.mockResolvedValueOnce({
      success: false,
      limit: 120,
      remaining: 0,
      reset: Date.now() + 60_000,
      retryAfter: 20,
      identity: "203.0.113.10",
    });
    const limited = await POST(makeRequest(JSON.stringify(validPayload)));

    expect(wrongType.status).toBe(415);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("20");
  });
});
