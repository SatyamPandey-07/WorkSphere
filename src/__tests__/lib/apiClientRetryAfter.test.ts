import { parseRetryAfterHeader, apiClient } from '@/lib/apiClient';

describe('apiClient Retry-After & Exponential Backoff', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('correctly parses Retry-After header in integer seconds', () => {
    const delayMs = parseRetryAfterHeader('5');
    expect(delayMs).toBe(5000);
  });

  it('correctly parses Retry-After header as HTTP-date', () => {
    const futureDate = new Date(Date.now() + 10000).toUTCString();
    const delayMs = parseRetryAfterHeader(futureDate);
    // Should be approximately 10000ms (+/- network execution lag)
    expect(delayMs).toBeGreaterThan(8000);
    expect(delayMs).toBeLessThanOrEqual(10500);
  });

  it('retries on HTTP 429 Too Many Requests respecting Retry-After and succeeds eventually', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockImplementationOnce(async () => {
        return new Response('Rate limited', {
          status: 429,
          headers: { 'Retry-After': '1' },
        });
      })
      .mockImplementationOnce(async () => {
        return new Response(JSON.stringify({ success: true, data: 'ok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });

    const result = await apiClient('/api/test-endpoint', { maxRetries: 3 });

    expect(result).toEqual({ success: true, data: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops retrying and throws error after reaching maxRetries (3)', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('Too Many Requests', {
        status: 429,
        headers: { 'Retry-After': '1' },
      });
    });

    await expect(apiClient('/api/test-endpoint', { maxRetries: 3, baseDelayMs: 10 })).rejects.toThrow(
      /API Request failed with status 429/
    );

    // Initial attempt + 3 retries = 4 total calls
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});