export interface ApiClientOptions extends RequestInit {
  maxRetries?: number;
  baseDelayMs?: number;
}

/**
 * Parses the Retry-After header which can be either an integer number of seconds
 * or an HTTP-date string. Returns delay in milliseconds.
 */
export function parseRetryAfterHeader(retryAfterHeader: string | null): number {
  if (!retryAfterHeader) return 1000; // Default fallback delay

  // 1. Try parsing as integer seconds
  const seconds = parseInt(retryAfterHeader, 10);
  if (!isNaN(seconds)) {
    return seconds * 1000;
  }

  // 2. Try parsing as HTTP-date string
  const parsedDate = Date.parse(retryAfterHeader);
  if (!isNaN(parsedDate)) {
    const deltaMs = parsedDate - Date.now();
    return Math.max(0, deltaMs);
  }

  return 1000; // Fallback
}

/**
 * Enhanced unified client fetch wrapper with HTTP 429 Retry-After handling,
 * exponential backoff, jitter, and maximum 3 retries.
 */
export async function apiClient<T = any>(
  url: string,
  options: ApiClientOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;

  let attempt = 0;

  while (true) {
    try {
      const response = await fetch(url, options);

      // Inspect HTTP 429 Too Many Requests
      if (response.status === 429 && attempt < maxRetries) {
        attempt++;
        const retryAfterHeader = response.headers.get('Retry-After');
        const parsedRetryAfterMs = parseRetryAfterHeader(retryAfterHeader);

        // Calculate exponential backoff with jitter
        const exponentialDelay = baseDelayMs * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 300; // Add up to 300ms random jitter
        const delay = Math.max(parsedRetryAfterMs, exponentialDelay) + jitter;

        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      if (!response.ok) {
        throw new Error(`API Request failed with status ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json();
      }

      return (await response.text()) as unknown as T;
    } catch (error: any) {
      if (attempt >= maxRetries) {
        throw error;
      }
      attempt++;
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 200;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

export default apiClient;
