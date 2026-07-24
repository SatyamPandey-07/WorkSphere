import { apiFetch } from "../../lib/apiClient";

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
});
