export const VENUE_REVIEWS_NAMESPACE = 'venue:reviews' as const;

export interface VenueReviewKeyParams {
    venueId: string;
    page?: number;
    limit?: number;
    sortBy?: 'recent' | 'highest' | 'lowest';
}

export interface ParsedVenueReviewKey {
    namespace: typeof VENUE_REVIEWS_NAMESPACE;
    venueId: string;
    page?: number;
    limit?: number;
    sortBy?: string;
}

/**
 * Normalizes and URI-encodes a venue/place ID so reserved delimiters (`:`, `|`, `?`)
 * inside external IDs like `osm:node:123456` never corrupt key segmentation.
 */
export function encodeVenueKeySegment(venueId: string): string {
    const trimmed = venueId.trim();
    if (!trimmed) {
        throw new Error('venueId must be a non-empty string');
    }
    return encodeURIComponent(trimmed);
}

/**
 * Decodes an encoded venueId segment back to its original identifier (e.g. `osm:node:123456`).
 */
export function decodeVenueKeySegment(encodedSegment: string): string {
    try {
        return decodeURIComponent(encodedSegment);
    } catch {
        return encodedSegment;
    }
}

/**
 * Builds a collision-free SWR cache key for venue reviews.
 * Example:
 *   buildVenueReviewsCacheKey('osm:node:123456')
 *   => 'venue:reviews:osm%3Anode%3A123456'
 */
export function buildVenueReviewsCacheKey(
    input: string | VenueReviewKeyParams
): string {
    const params: VenueReviewKeyParams =
        typeof input === 'string' ? { venueId: input } : input;

    const encodedId = encodeVenueKeySegment(params.venueId);
    const baseKey = `${VENUE_REVIEWS_NAMESPACE}:${encodedId}`;

    const queryParts: string[] = [];
    if (typeof params.page === 'number') {
        queryParts.push(`page=${params.page}`);
    }
    if (typeof params.limit === 'number') {
        queryParts.push(`limit=${params.limit}`);
    }
    if (params.sortBy) {
        queryParts.push(`sortBy=${encodeURIComponent(params.sortBy)}`);
    }

    return queryParts.length > 0 ? `${baseKey}?${queryParts.join('&')}` : baseKey;
}

/**
 * Builds an SWR array tuple key for structured SWR caches (`useSWR(buildVenueReviewsTupleKey(...))`).
 * SWR hashes tuple keys natively without delimiter splitting ambiguity.
 */
export function buildVenueReviewsTupleKey(
    input: string | VenueReviewKeyParams
): readonly [string, string, string, string] {
    const params: VenueReviewKeyParams =
        typeof input === 'string' ? { venueId: input } : input;

    const trimmedId = params.venueId.trim();
    if (!trimmedId) {
        throw new Error('venueId must be a non-empty string');
    }

    const querySignature = JSON.stringify({
        page: params.page ?? null,
        limit: params.limit ?? null,
        sortBy: params.sortBy ?? null,
    });

    return ['venue', 'reviews', trimmedId, querySignature] as const;
}

/**
 * Safely parses a venue reviews cache key back into its constituent parts.
 * Handles both URI-encoded keys (`venue:reviews:osm%3Anode%3A123456`)
 * and legacy unencoded keys containing colons (`venue:reviews:osm:node:123456`).
 */
export function parseVenueReviewsCacheKey(
    key: unknown
): ParsedVenueReviewKey | null {
    // Support SWR tuple keys
    if (Array.isArray(key)) {
        if (key[0] === 'venue' && key[1] === 'reviews' && typeof key[2] === 'string') {
            let extra: { page?: number; limit?: number; sortBy?: string } = {};
            if (typeof key[3] === 'string') {
                try {
                    extra = JSON.parse(key[3]) as {
                        page?: number;
                        limit?: number;
                        sortBy?: string;
                    };
                } catch {
                    // Ignore malformed metadata
                }
            }
            return {
                namespace: VENUE_REVIEWS_NAMESPACE,
                venueId: key[2],
                ...(typeof extra.page === 'number' ? { page: extra.page } : {}),
                ...(typeof extra.limit === 'number' ? { limit: extra.limit } : {}),
                ...(typeof extra.sortBy === 'string' ? { sortBy: extra.sortBy } : {}),
            };
        }
        return null;
    }

    if (typeof key !== 'string') {
        return null;
    }

    const prefix = `${VENUE_REVIEWS_NAMESPACE}:`;
    if (!key.startsWith(prefix)) {
        return null;
    }

    // Strip the known `venue:reviews:` prefix instead of splitting on all colons
    const remainder = key.slice(prefix.length);
    if (!remainder) {
        return null;
    }

    const questionIdx = remainder.indexOf('?');
    const rawVenueSegment =
        questionIdx === -1 ? remainder : remainder.slice(0, questionIdx);
    const queryString =
        questionIdx === -1 ? '' : remainder.slice(questionIdx + 1);

    if (!rawVenueSegment) {
        return null;
    }

    const venueId = decodeVenueKeySegment(rawVenueSegment);
    const parsed: ParsedVenueReviewKey = {
        namespace: VENUE_REVIEWS_NAMESPACE,
        venueId,
    };

    if (queryString) {
        const searchParams = new URLSearchParams(queryString);
        const page = searchParams.get('page');
        const limit = searchParams.get('limit');
        const sortBy = searchParams.get('sortBy');

        if (page !== null && !Number.isNaN(Number(page))) {
            parsed.page = Number(page);
        }
        if (limit !== null && !Number.isNaN(Number(limit))) {
            parsed.limit = Number(limit);
        }
        if (sortBy) {
            parsed.sortBy = sortBy;
        }
    }

    return parsed;
}

/**
 * Predicate matcher for SWR's global `mutate(matcher)` cache invalidation.
 * Matches all paginated/sorted review cache entries belonging to `targetVenueId`,
 * regardless of colons in external identifiers like `osm:node:123456`.
 */
export function createVenueReviewsInvalidationMatcher(
    targetVenueId: string
): (key: unknown) => boolean {
    const normalizedTarget = targetVenueId.trim();

    return (key: unknown): boolean => {
        const parsed = parseVenueReviewsCacheKey(key);
        return parsed !== null && parsed.venueId === normalizedTarget;
    };
}