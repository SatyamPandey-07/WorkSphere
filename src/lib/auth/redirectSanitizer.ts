const DEFAULT_SAFE_REDIRECT = '/dashboard';
const AUTH_ROUTE_PREFIXES = ['/sign-in', '/sign-up', '/sso-callback'];
const MAX_UNWRAP_DEPTH = 10;

/**
 * Checks whether a pathname points to an authentication page that must never
 * be used as a post-login redirect target.
 */
export function isAuthRoute(pathname: string): boolean {
    const normalized = pathname.toLowerCase();
    return AUTH_ROUTE_PREFIXES.some(
        (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`)
    );
}

/**
 * Validates that a candidate redirect string is a safe, same-origin relative path
 * and not an open redirect (`//evil.com`, `https://...`, `javascript:...`, `\evil.com`).
 */
export function isSafeRelativeRedirect(candidate: string): boolean {
    if (!candidate || typeof candidate !== 'string') {
        return false;
    }

    const trimmed = candidate.trim();

    // Must start with a single forward slash; reject protocol-relative `//` and backslash `/\`
    if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/\\')) {
        return false;
    }

    // Reject control characters or null bytes
    if (/[\x00-\x1f\x7f]/.test(trimmed)) {
        return false;
    }

    try {
        // Parse against a dummy local origin to detect host/protocol smuggling
        const parsed = new URL(trimmed, 'http://worksphere.local');
        if (parsed.origin !== 'http://worksphere.local') {
            return false;
        }
        return true;
    } catch {
        return false;
    }
}

/**
 * Recursively unwraps nested `redirect_url` parameters and sanitizes the destination
 * into a clean relative path (`pathname + search + hash`), preventing recursive
 * `/sign-in?redirect_url=%2Fsign-in%3Fredirect_url%3D...` loops when cookies are blocked.
 */
export function sanitizeRedirectUrl(
    rawTarget: string | null | undefined,
    fallback: string = DEFAULT_SAFE_REDIRECT
): string {
    const safeFallback = isSafeRelativeRedirect(fallback) ? fallback : DEFAULT_SAFE_REDIRECT;

    if (!rawTarget || typeof rawTarget !== 'string') {
        return safeFallback;
    }

    let current = rawTarget.trim();

    for (let depth = 0; depth < MAX_UNWRAP_DEPTH; depth++) {
        // Handle full same-origin URLs (e.g. Clerk passing http://localhost:3000/workspace/settings)
        if (/^https?:\/\//i.test(current)) {
            try {
                const parsedFull = new URL(current);
                current = `${parsedFull.pathname}${parsedFull.search}${parsedFull.hash}`;
            } catch {
                return safeFallback;
            }
        }

        if (!isSafeRelativeRedirect(current)) {
            return safeFallback;
        }

        const parsed = new URL(current, 'http://worksphere.local');

        // If the target points to `/sign-in` or `/sign-up`, extract its inner `redirect_url`
        // rather than nesting another `/sign-in` layer
        if (isAuthRoute(parsed.pathname)) {
            const nested = parsed.searchParams.get('redirect_url');
            if (!nested || nested === current) {
                return safeFallback;
            }
            current = nested;
            continue;
        }

        // Strip any accidental `redirect_url` query parameter attached to a non-auth route
        if (parsed.searchParams.has('redirect_url')) {
            const nested = parsed.searchParams.get('redirect_url');
            parsed.searchParams.delete('redirect_url');

            // If the outer path was just a wrapper, unwrap; otherwise keep the clean destination
            if (nested && isSafeRelativeRedirect(nested) && !isAuthRoute(nested)) {
                current = nested;
                continue;
            }
        }

        const normalized = `${parsed.pathname}${parsed.search}${parsed.hash}`;
        return isSafeRelativeRedirect(normalized) && !isAuthRoute(parsed.pathname)
            ? normalized
            : safeFallback;
    }

    return safeFallback;
}

/**
 * Constructs a single-level, loop-free sign-in redirect URL:
 * e.g. `/sign-in?redirect_url=%2Fworkspace%2Fsettings`
 */
export function buildSignInRedirectUrl(
    requestUrl: URL,
    signInPath = '/sign-in'
): URL {
    const targetUrl = new URL(signInPath, requestUrl.origin);

    // Check if the incoming request already carries a `redirect_url` (e.g. from a prior bounce)
    const existingRedirectParam = requestUrl.searchParams.get('redirect_url');

    const rawDestination = isAuthRoute(requestUrl.pathname)
        ? existingRedirectParam
        : `${requestUrl.pathname}${requestUrl.search}`;

    const cleanDestination = sanitizeRedirectUrl(rawDestination, DEFAULT_SAFE_REDIRECT);

    targetUrl.searchParams.set('redirect_url', cleanDestination);
    return targetUrl;
}