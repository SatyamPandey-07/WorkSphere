export interface ReverseGeocodeAddress {
    road?: string;
    suburb?: string;
    neighbourhood?: string;
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    postcode?: string;
    country?: string;
    country_code?: string;
}

export interface ReverseGeocodeResult {
    formattedAddress: string;
    isFallback: boolean;
    attempts: number;
    rawAddress?: ReverseGeocodeAddress;
}

export interface RetryBackoffOptions {
    /** Number of retry attempts after the initial request (default: 3 => 1s, 2s, 4s) */
    maxRetries?: number;
    /** Base delay in milliseconds for attempt 1 (default: 1000ms => 1s, 2s, 4s) */
    baseDelayMs?: number;
    /** Fractional jitter +/- range applied to backoff delay (default: 0.2 => ±20%) */
    jitterFactor?: number;
    /** Per-request fetch timeout in milliseconds (default: 5000ms) */
    requestTimeoutMs?: number;
    /** Optional AbortSignal to cancel in-flight retries */
    signal?: AbortSignal;
    /** Custom sleep implementation (useful for deterministic unit testing) */
    sleepFn?: (ms: number, signal?: AbortSignal) => Promise<void>;
    /** Custom fetch implementation (useful for testing or proxy injection) */
    fetchFn?: typeof fetch;
}

const TRANSIENT_HTTP_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

const DEFAULT_USER_AGENT =
    process.env.NOMINATIM_USER_AGENT ??
    'WorkSphere/1.0 (https://work-sphere-one.vercel.app; contact@worksphere.app)';

/**
 * Formats coordinates as a clean, human-readable fallback address string.
 */
export function formatCoordinateFallback(
    latitude: number,
    longitude: number,
    precision = 5
): string {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return 'Unknown location';
    }
    return `${latitude.toFixed(precision)}, ${longitude.toFixed(precision)}`;
}

/**
 * Abort-safe sleep helper.
 */
export function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
        return Promise.reject(new DOMException('Aborted', 'AbortError'));
    }

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);

        const onAbort = () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
        };

        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

/**
 * Computes exponential backoff delay (1s, 2s, 4s for retries 0, 1, 2) with randomized jitter.
 * Honors server `Retry-After` seconds when provided on HTTP 429/503 responses.
 */
export function computeBackoffDelayMs(
    retryIndex: number,
    baseDelayMs = 1000,
    jitterFactor = 0.2,
    retryAfterHeader?: string | null
): number {
    const exponentialMs = baseDelayMs * Math.pow(2, retryIndex); // 1000, 2000, 4000
    const jitterOffset =
        jitterFactor > 0
            ? exponentialMs * jitterFactor * (Math.random() * 2 - 1)
            : 0;

    let delayMs = Math.max(0, Math.round(exponentialMs + jitterOffset));

    if (retryAfterHeader) {
        const parsedSeconds = Number(retryAfterHeader);
        if (!Number.isNaN(parsedSeconds) && parsedSeconds > 0) {
            // Respect Retry-After while bounding wait time to avoid serverless function timeouts
            delayMs = Math.max(delayMs, Math.min(parsedSeconds * 1000, 10_000));
        }
    }

    return delayMs;
}

/**
 * Formats structured Nominatim address fields into a concise venue street address,
 * falling back to `display_name` when granular fields are absent.
 */
function buildReadableAddress(
    address: ReverseGeocodeAddress | undefined,
    displayName?: string
): string | null {
    if (address) {
        const locality = address.city ?? address.town ?? address.village ?? address.suburb;
        const parts = [address.road, locality, address.state, address.postcode]
            .map((part) => part?.trim())
            .filter((part): part is string => Boolean(part));

        if (parts.length > 0) {
            return parts.join(', ');
        }
    }

    if (typeof displayName === 'string' && displayName.trim().length > 0) {
        // Keep top 3 comma-separated components from Nominatim's verbose display_name
        return displayName
            .split(',')
            .slice(0, 3)
            .map((s) => s.trim())
            .filter(Boolean)
            .join(', ');
    }

    return null;
}

/**
 * Executes a single Nominatim reverse-geocode request with per-attempt timeout control.
 */
async function fetchNominatimOnce(
    latitude: number,
    longitude: number,
    timeoutMs: number,
    fetchFn: typeof fetch,
    externalSignal?: AbortSignal
): Promise<Response> {
    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('lat', String(latitude));
    url.searchParams.set('lon', String(longitude));
    url.searchParams.set('zoom', '18');
    url.searchParams.set('addressdetails', '1');

    const attemptController = new AbortController();
    const timeoutId = setTimeout(() => {
        attemptController.abort(new DOMException('Nominatim request timed out', 'TimeoutError'));
    }, timeoutMs);

    const onExternalAbort = () => {
        attemptController.abort(externalSignal?.reason);
    };
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
        return await fetchFn(url.toString(), {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                'Accept-Language': 'en',
                'User-Agent': DEFAULT_USER_AGENT,
            },
            signal: attemptController.signal,
        });
    } finally {
        clearTimeout(timeoutId);
        externalSignal?.removeEventListener('abort', onExternalAbort);
    }
}

/**
 * Reverse-geocodes (latitude, longitude) via OpenStreetMap Nominatim with
 * 3 exponential-backoff retry attempts (1s, 2s, 4s + jitter) on transient
 * HTTP 429/503/network errors, gracefully falling back to a coordinate string
 * if all attempts are exhausted.
 */
export async function reverseGeocodeWithRetry(
    latitude: number,
    longitude: number,
    options: RetryBackoffOptions = {}
): Promise<ReverseGeocodeResult> {
    const fallbackCoordinateString = formatCoordinateFallback(latitude, longitude);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return {
            formattedAddress: fallbackCoordinateString,
            isFallback: true,
            attempts: 0,
        };
    }

    const {
        maxRetries = 3,
        baseDelayMs = 1000,
        jitterFactor = 0.2,
        requestTimeoutMs = 5000,
        signal,
        sleepFn = sleepWithAbort,
        fetchFn = fetch,
    } = options;

    let attempts = 0;

    for (let retryIndex = 0; retryIndex <= maxRetries; retryIndex++) {
        if (signal?.aborted) {
            return {
                formattedAddress: fallbackCoordinateString,
                isFallback: true,
                attempts,
            };
        }

        attempts += 1;

        try {
            const response = await fetchNominatimOnce(
                latitude,
                longitude,
                requestTimeoutMs,
                fetchFn,
                signal
            );

            if (response.ok) {
                const payload = (await response.json()) as {
                    display_name?: string;
                    address?: ReverseGeocodeAddress;
                };

                const formatted = buildReadableAddress(payload.address, payload.display_name);
                if (formatted) {
                    return {
                        formattedAddress: formatted,
                        isFallback: false,
                        attempts,
                        rawAddress: payload.address,
                    };
                }

                // Valid HTTP 200 but empty address object (e.g., ocean/unmapped coordinates)
                return {
                    formattedAddress: fallbackCoordinateString,
                    isFallback: true,
                    attempts,
                };
            }

            // Non-transient 4xx errors (e.g., 400 Bad Request) should fail fast without retrying
            if (!TRANSIENT_HTTP_STATUS_CODES.has(response.status)) {
                return {
                    formattedAddress: fallbackCoordinateString,
                    isFallback: true,
                    attempts,
                };
            }

            if (retryIndex < maxRetries) {
                const retryAfter = response.headers?.get?.('Retry-After') ?? null;
                const delayMs = computeBackoffDelayMs(
                    retryIndex,
                    baseDelayMs,
                    jitterFactor,
                    retryAfter
                );
                await sleepFn(delayMs, signal);
            }
        } catch (error: unknown) {
            // Propagate explicit caller aborts immediately as graceful fallback
            if (signal?.aborted) {
                return {
                    formattedAddress: fallbackCoordinateString,
                    isFallback: true,
                    attempts,
                };
            }

            if (retryIndex < maxRetries) {
                const delayMs = computeBackoffDelayMs(retryIndex, baseDelayMs, jitterFactor);
                await sleepFn(delayMs, signal);
            } else {
                console.warn(
                    `[ReverseGeocode] Exhausted ${attempts} attempts for (${fallbackCoordinateString}):`,
                    error instanceof Error ? error.message : error
                );
            }
        }
    }

    return {
        formattedAddress: fallbackCoordinateString,
        isFallback: true,
        attempts,
    };
}

/**
 * Enriches a venue record's missing address metadata using `reverseGeocodeWithRetry`.
 */
export async function resolveVenueAddress<
    T extends { address?: string | null; latitude: number; longitude: number },
>(venue: T, options?: RetryBackoffOptions): Promise<T & { address: string }> {
    const existing = venue.address?.trim();
    if (existing) {
        return { ...venue, address: existing };
    }

    const geocoded = await reverseGeocodeWithRetry(
        venue.latitude,
        venue.longitude,
        options
    );

    return {
        ...venue,
        address: geocoded.formattedAddress,
    };
}