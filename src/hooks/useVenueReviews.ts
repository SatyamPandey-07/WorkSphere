'use client';

import useSWR, { useSWRConfig } from 'swr';
import { useCallback } from 'react';
import {
    buildVenueReviewsCacheKey,
    createVenueReviewsInvalidationMatcher,
    VenueReviewKeyParams,
} from '@/lib/cache/venueReviewCacheKeys';

export interface VenueReview {
    id: string;
    venueId: string;
    userId: string;
    userName?: string;
    wifiRating: number;
    noiseRating: number;
    outletRating: number;
    overallRating: number;
    comment?: string | null;
    createdAt: string;
}

export interface VenueReviewsResponse {
    reviews: VenueReview[];
    total: number;
    averageRating: number;
}

async function fetchVenueReviews(cacheKey: string): Promise<VenueReviewsResponse> {
    // Extract venueId and optional query params safely from the encoded key
    const prefix = 'venue:reviews:';
    const remainder = cacheKey.slice(prefix.length);
    const [encodedVenueId, queryString] = remainder.split('?');
    const venueId = decodeURIComponent(encodedVenueId);

    const url = `/api/venues/${encodeURIComponent(venueId)}/reviews${queryString ? `?${queryString}` : ''
        }`;

    const res = await fetch(url, {
        headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
        throw new Error(`Failed to fetch venue reviews (${res.status})`);
    }

    return (await res.json()) as VenueReviewsResponse;
}

export function useVenueReviews(params: VenueReviewKeyParams | null) {
    const { mutate } = useSWRConfig();

    const cacheKey = params?.venueId
        ? buildVenueReviewsCacheKey(params)
        : null;

    const { data, error, isLoading, isValidating } = useSWR<VenueReviewsResponse>(
        cacheKey,
        fetchVenueReviews,
        {
            revalidateOnFocus: false,
            dedupingInterval: 5000,
        }
    );

    /**
     * Invalidates all cached review pages/sort variants for this venueId
     * without fragmenting on colons inside `osm:node:123456`.
     */
    const invalidateVenueReviews = useCallback(async () => {
        if (!params?.venueId) return;
        const matcher = createVenueReviewsInvalidationMatcher(params.venueId);
        await mutate(matcher);
    }, [mutate, params?.venueId]);

    return {
        reviews: data?.reviews ?? [],
        total: data?.total ?? 0,
        averageRating: data?.averageRating ?? 0,
        isLoading,
        isValidating,
        error,
        cacheKey,
        invalidateVenueReviews,
    };
}