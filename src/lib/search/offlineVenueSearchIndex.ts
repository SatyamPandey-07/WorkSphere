export interface SearchableVenue { id: string; name: string; neighborhood?: string; amenities?: readonly string[]; tags?: readonly string[]; wifiMbps?: number; noiseDb?: number; availableSeats?: number; }
export interface VenueSearchFacets { minWifiMbps?: number; maxNoiseDb?: number; minAvailableSeats?: number; }
export interface VenueSearchMatch { venue: SearchableVenue; score: number; matchedTokens: string[]; }
export function normalizeSearchText(input: string): string { if (typeof input !== 'string') return ''; return input.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim(); }
export function tokenizeSearchText(input: string): string[] { const normalized = normalizeSearchText(input); return normalized ? Array.from(new Set(normalized.split(' ').filter(Boolean))) : []; }
export function boundedEditDistance(a: string, b: string, maxDistance = 2): number {
  if (a === b) return 0; if (!a.length) return b.length <= maxDistance ? b.length : maxDistance + 1; if (!b.length) return a.length <= maxDistance ? a.length : maxDistance + 1;
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;
  let prevRow = new Array<number>(b.length + 1); let currRow = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prevRow[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    currRow[0] = i; let rowMin = currRow[0];
    for (let j = 1; j <= b.length; j += 1) { const val = Math.min(prevRow[j] + 1, currRow[j - 1] + 1, prevRow[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); currRow[j] = val; if (val < rowMin) rowMin = val; }
    if (rowMin > maxDistance) return maxDistance + 1;
    [prevRow, currRow] = [currRow, prevRow];
  }
  return prevRow[b.length];
}
export function matchesVenueFacets(venue: SearchableVenue, facets?: VenueSearchFacets): boolean {
  if (!facets) return true;
  if (typeof facets.minWifiMbps === 'number' && Number.isFinite(facets.minWifiMbps) && (venue.wifiMbps ?? 0) < facets.minWifiMbps) return false;
  if (typeof facets.maxNoiseDb === 'number' && Number.isFinite(facets.maxNoiseDb) && (venue.noiseDb ?? Number.POSITIVE_INFINITY) > facets.maxNoiseDb) return false;
  if (typeof facets.minAvailableSeats === 'number' && Number.isFinite(facets.minAvailableSeats) && (venue.availableSeats ?? 0) < facets.minAvailableSeats) return false;
  return true;
}
export class OfflineVenueSearchIndex {
  private readonly venuesById = new Map<string, SearchableVenue>(); private readonly venueTokens = new Map<string, string[]>();
  constructor(initialVenues: readonly SearchableVenue[] = []) { this.indexMany(initialVenues); }
  public indexVenue(venue: SearchableVenue): void { if (!venue?.id) return; this.venuesById.set(venue.id, venue); this.venueTokens.set(venue.id, tokenizeSearchText([venue.name, venue.neighborhood ?? '', ...(venue.amenities ?? []), ...(venue.tags ?? [])].join(' '))); }
  public indexMany(venues: readonly SearchableVenue[]): void { for (const v of venues) this.indexVenue(v); }
  public removeVenue(venueId: string): void { this.venueTokens.delete(venueId); this.venuesById.delete(venueId); }
  public clear(): void { this.venueTokens.clear(); this.venuesById.clear(); }
  public size(): number { return this.venuesById.size; }
  public search(query: string, facets?: VenueSearchFacets): VenueSearchMatch[] {
    const queryTokens = tokenizeSearchText(query);
    const hasFacets = Boolean(facets && (facets.minWifiMbps !== undefined || facets.maxNoiseDb !== undefined || facets.minAvailableSeats !== undefined));
    if (queryTokens.length === 0 && !hasFacets) return [];
    const results: VenueSearchMatch[] = [];
    for (const [venueId, venue] of this.venuesById.entries()) {
      if (!matchesVenueFacets(venue, facets)) continue;
      if (queryTokens.length === 0) { results.push({ venue, score: Math.round(((venue.wifiMbps ?? 0) / 1000 + (venue.availableSeats ?? 0) / 100) * 1000) / 1000, matchedTokens: [] }); continue; }
      const docTokens = this.venueTokens.get(venueId) ?? []; let totalScore = 0; const matched: string[] = [];
      for (const qToken of queryTokens) {
        let best = 0;
        for (const dToken of docTokens) {
          if (dToken === qToken) best = Math.max(best, 100);
          else if (dToken.startsWith(qToken)) best = Math.max(best, 70);
          else if (qToken.length >= 3) { const maxDist = qToken.length <= 5 ? 1 : 2; const dist = boundedEditDistance(qToken, dToken, maxDist); if (dist <= maxDist) best = Math.max(best, 45 - dist * 10); }
        }
        if (best > 0) { totalScore += best; matched.push(qToken); }
      }
      if (totalScore > 0) results.push({ venue, score: totalScore, matchedTokens: matched });
    }
    return results.sort((a, b) => b.score - a.score || a.venue.id.localeCompare(b.venue.id));
  }
}
