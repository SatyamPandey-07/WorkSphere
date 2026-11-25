export interface SearchableVenue {
  id: string;
  name: string;
  neighborhood?: string;
  amenities?: readonly string[];
  tags?: readonly string[];
  wifiMbps?: number;
  noiseDb?: number;
  availableSeats?: number;
}

export interface VenueSearchFacets {
  minWifiMbps?: number;
  maxNoiseDb?: number;
  minAvailableSeats?: number;
}

export interface VenueSearchMatch {
  venue: SearchableVenue;
  score: number;
  matchedTokens: string[];
}

/**
 * Normalizes text with Unicode NFD normalization and strips combining diacritical marks
 * (Unicode range \u0300-\u036f), lowercase, and non-alphanumeric characters.
 */
export function normalizeSearchText(input: string): string {
  if (typeof input !== 'string') return '';
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenizeSearchText(input: string): string[] {
  const normalized = normalizeSearchText(input);
  if (!normalized) return [];
  return Array.from(
    new Set(
      normalized
        .split(' ')
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
    )
  );
}

export function boundedEditDistance(
  a: string,
  b: string,
  maxDistance = 2
): number {
  if (a === b) return 0;
  if (!a.length) return b.length <= maxDistance ? b.length : maxDistance + 1;
  if (!b.length) return a.length <= maxDistance ? a.length : maxDistance + 1;

  if (Math.abs(a.length - b.length) > maxDistance) {
    return maxDistance + 1;
  }

  let prevRow = new Array<number>(b.length + 1);
  let currRow = new Array<number>(b.length + 1);

  for (let j = 0; j <= b.length; j += 1) {
    prevRow[j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    currRow[0] = i;
    let rowMin = currRow[0];

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const deletion = prevRow[j] + 1;
      const insertion = currRow[j - 1] + 1;
      const substitution = prevRow[j - 1] + cost;
      const val = Math.min(deletion, insertion, substitution);
      currRow[j] = val;
      if (val < rowMin) rowMin = val;
    }

    if (rowMin > maxDistance) {
      return maxDistance + 1;
    }

    const tmp = prevRow;
    prevRow = currRow;
    currRow = tmp;
  }

  return prevRow[b.length];
}

export function matchesVenueFacets(
  venue: SearchableVenue,
  facets?: VenueSearchFacets
): boolean {
  if (!facets) return true;

  if (
    typeof facets.minWifiMbps === 'number' &&
    Number.isFinite(facets.minWifiMbps)
  ) {
    const wifi = typeof venue.wifiMbps === 'number' ? venue.wifiMbps : 0;
    if (wifi < facets.minWifiMbps) return false;
  }

  if (
    typeof facets.maxNoiseDb === 'number' &&
    Number.isFinite(facets.maxNoiseDb)
  ) {
    const noise =
      typeof venue.noiseDb === 'number'
        ? venue.noiseDb
        : Number.POSITIVE_INFINITY;
    if (noise > facets.maxNoiseDb) return false;
  }

  if (
    typeof facets.minAvailableSeats === 'number' &&
    Number.isFinite(facets.minAvailableSeats)
  ) {
    const seats =
      typeof venue.availableSeats === 'number' ? venue.availableSeats : 0;
    if (seats < facets.minAvailableSeats) return false;
  }

  return true;
}

export class OfflineVenueSearchIndex {
  private readonly venuesById = new Map<string, SearchableVenue>();
  private readonly tokenToVenueIds = new Map<string, Set<string>>();
  private readonly venueTokens = new Map<string, string[]>();

  constructor(initialVenues: readonly SearchableVenue[] = []) {
    this.indexMany(initialVenues);
  }

  public indexVenue(venue: SearchableVenue): void {
    if (!venue || !venue.id) return;
    this.removeVenue(venue.id);
    this.venuesById.set(venue.id, venue);

    const corpus = [
      venue.name,
      venue.neighborhood ?? '',
      ...(venue.amenities ?? []),
      ...(venue.tags ?? []),
    ].join(' ');

    const tokens = tokenizeSearchText(corpus);
    this.venueTokens.set(venue.id, tokens);

    for (const token of tokens) {
      let bucket = this.tokenToVenueIds.get(token);
      if (!bucket) {
        bucket = new Set<string>();
        this.tokenToVenueIds.set(token, bucket);
      }
      bucket.add(venue.id);
    }
  }

  public indexMany(venues: readonly SearchableVenue[]): void {
    for (const venue of venues) {
      this.indexVenue(venue);
    }
  }

  public removeVenue(venueId: string): void {
    const existingTokens = this.venueTokens.get(venueId);
    if (existingTokens) {
      for (const token of existingTokens) {
        const bucket = this.tokenToVenueIds.get(token);
        if (bucket) {
          bucket.delete(venueId);
          if (bucket.size === 0) {
            this.tokenToVenueIds.delete(token);
          }
        }
      }
      this.venueTokens.delete(venueId);
    }
    this.venuesById.delete(venueId);
  }

  public clear(): void {
    this.venuesById.clear();
    this.tokenToVenueIds.clear();
    this.venueTokens.clear();
  }

  public size(): number {
    return this.venuesById.size;
  }

  public search(
    query: string,
    facets?: VenueSearchFacets
  ): VenueSearchMatch[] {
    const queryTokens = tokenizeSearchText(query);
    const hasFacets = Boolean(
      facets &&
        (facets.minWifiMbps !== undefined ||
          facets.maxNoiseDb !== undefined ||
          facets.minAvailableSeats !== undefined)
    );

    if (queryTokens.length === 0 && !hasFacets) {
      return [];
    }

    const results: VenueSearchMatch[] = [];

    for (const [venueId, venue] of this.venuesById.entries()) {
      if (!matchesVenueFacets(venue, facets)) continue;

      if (queryTokens.length === 0) {
        const facetBonus =
          (typeof venue.wifiMbps === 'number' ? venue.wifiMbps : 0) / 1000 +
          (typeof venue.availableSeats === 'number' ? venue.availableSeats : 0) /
            100;
        results.push({
          venue,
          score: Math.round(facetBonus * 1000) / 1000,
          matchedTokens: [],
        });
        continue;
      }

      const docTokens = this.venueTokens.get(venueId) ?? [];
      let totalScore = 0;
      const matched: string[] = [];

      for (const qToken of queryTokens) {
        let bestTokenScore = 0;

        for (const dToken of docTokens) {
          if (dToken === qToken) {
            bestTokenScore = Math.max(bestTokenScore, 100);
          } else if (dToken.startsWith(qToken)) {
            bestTokenScore = Math.max(bestTokenScore, 70);
          } else if (qToken.length >= 3) {
            const maxDist = qToken.length <= 5 ? 1 : 2;
            const dist = boundedEditDistance(qToken, dToken, maxDist);
            if (dist <= maxDist) {
              bestTokenScore = Math.max(bestTokenScore, 45 - dist * 10);
            }
          }
        }

        if (bestTokenScore > 0) {
          totalScore += bestTokenScore;
          matched.push(qToken);
        }
      }

      if (totalScore > 0) {
        results.push({
          venue,
          score: totalScore,
          matchedTokens: matched,
        });
      }
    }

    return results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.venue.id.localeCompare(b.venue.id);
    });
  }
}
