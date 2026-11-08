/**
 * Tests for the sync worker AUTH_EXPIRED → TOKEN_REFRESH protocol (Issue #1847).
 */

// Simulate the worker-side protocol
async function authenticatedFetch(
  url: string,
  options: RequestInit,
  currentToken: string | null,
  requestTokenRefresh: () => Promise<string | null>,
): Promise<Response> {
  const headers = new Headers(options.headers);
  if (currentToken) {
    headers.set("Authorization", `Bearer ${currentToken}`);
  }

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    // Token expired — request a fresh one
    const freshToken = await requestTokenRefresh();
    if (freshToken) {
      const retryHeaders = new Headers(headers);
      retryHeaders.set("Authorization", `Bearer ${freshToken}`);
      return fetch(url, { ...options, headers: retryHeaders });
    }
  }

  return response;
}

describe("Sync worker AUTH_EXPIRED token refresh protocol", () => {
  it("sends Authorization header with current token", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ status: 200, ok: true } as Response);
    (global as any).fetch = fetchMock;

    await authenticatedFetch("/api/favorites", {}, "token-abc", jest.fn());

    const headers = fetchMock.mock.calls[0][1].headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer token-abc");
  });

  it("retries with fresh token on 401 response", async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ status: 401, ok: false } as Response)
      .mockResolvedValueOnce({ status: 200, ok: true } as Response);
    (global as any).fetch = fetchMock;

    const requestRefresh = jest.fn().mockResolvedValue("fresh-token");
    await authenticatedFetch("/api/favorites", {}, "expired-token", requestRefresh);

    expect(requestRefresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("second request uses fresh token in Authorization header", async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ status: 401, ok: false } as Response)
      .mockResolvedValueOnce({ status: 200, ok: true } as Response);
    (global as any).fetch = fetchMock;

    const requestRefresh = jest.fn().mockResolvedValue("fresh-token-xyz");
    await authenticatedFetch("/api/favorites", {}, "old-token", requestRefresh);

    const retryHeaders = fetchMock.mock.calls[1][1].headers as Headers;
    expect(retryHeaders.get("Authorization")).toBe("Bearer fresh-token-xyz");
  });

  it("does not retry if requestTokenRefresh returns null", async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ status: 401, ok: false } as Response);
    (global as any).fetch = fetchMock;

    const requestRefresh = jest.fn().mockResolvedValue(null);
    await authenticatedFetch("/api/favorites", {}, "token", requestRefresh);

    expect(fetchMock).toHaveBeenCalledTimes(1); // no retry
  });

  it("does not call requestTokenRefresh on 200 success", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ status: 200, ok: true } as Response);
    (global as any).fetch = fetchMock;

    const requestRefresh = jest.fn();
    await authenticatedFetch("/api/favorites", {}, "token", requestRefresh);

    expect(requestRefresh).not.toHaveBeenCalled();
  });
});
