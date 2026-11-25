import {
  OfflineVenueSearchIndex,
  normalizeSearchText,
  tokenizeSearchText,
  type SearchableVenue,
} from '@/lib/search/offlineVenueSearchIndex';

describe('OfflineVenueSearchIndex', () => {
  const sampleVenues: SearchableVenue[] = [
    {
      id: 'v-bandra',
      name: 'Café Bandra Studio',
      neighborhood: 'Bandra West',
      amenities: ['fiber', 'quiet', 'power'],
      tags: ['espresso', 'laptop-friendly'],
      wifiMbps: 180,
      noiseDb: 46,
      availableSeats: 8,
    },
    {
      id: 'v-powai',
      name: 'Powai Lake Desk',
      neighborhood: 'Hiranandani',
      amenities: ['24x7', 'fiber', 'power'],
      tags: ['sprint-ready', 'meeting-pod'],
      wifiMbps: 220,
      noiseDb: 54,
      availableSeats: 14,
    },
    {
      id: 'v-bhandup',
      name: 'Bhandup Station Hub',
      neighborhood: 'Bhandup West',
      amenities: ['power', 'quiet'],
      tags: ['commuter', 'focus'],
      wifiMbps: 95,
      noiseDb: 48,
      availableSeats: 3,
    },
  ];

  const internationalVenues: SearchableVenue[] = [
    {
      id: 'v-zurich',
      name: 'Zürich Altstadt Coworking',
      neighborhood: 'Kreis 1',
      amenities: ['espresso', 'quiet'],
      tags: ['swiss-fintech'],
      wifiMbps: 300,
    },
    {
      id: 'v-saopaulo',
      name: 'Espaço São Paulo Inovação',
      neighborhood: 'Jardins',
      amenities: ['café', 'ar-condicionado'],
      tags: ['paulista', 'startup'],
      wifiMbps: 250,
    },
    {
      id: 'v-bogota',
      name: 'Bogotá Emprendedores Café',
      neighborhood: 'Chapinero',
      amenities: ['café de origen', 'internet rápido'],
      tags: ['colombia'],
      wifiMbps: 150,
    },
    {
      id: 'v-munchen',
      name: 'München Kreativwerkstatt',
      neighborhood: 'Schwabing',
      amenities: ['ruhebereich', 'kaffee'],
      tags: ['bavaria'],
      wifiMbps: 200,
    },
    {
      id: 'v-valparaiso',
      name: 'Valparaíso Puerto Tech',
      neighborhood: 'Cerro Alegre',
      amenities: ['vistas al mar', 'café'],
      tags: ['pacífico'],
      wifiMbps: 120,
    },
    {
      id: 'v-reykjavik',
      name: 'Reykjavík Bryggjan Loft',
      neighborhood: 'Vesturbær',
      amenities: ['kaffi', 'hljóðlátt'],
      tags: ['nordic'],
      wifiMbps: 500,
    },
  ];

  it('normalizes diacritics using Unicode NFD and strips combining marks', () => {
    expect(normalizeSearchText('Café')).toBe('cafe');
    expect(normalizeSearchText('Zürich')).toBe('zurich');
    expect(normalizeSearchText('São Paulo')).toBe('sao paulo');
    expect(normalizeSearchText('Bogotá')).toBe('bogota');
    expect(normalizeSearchText('München')).toBe('munchen');
    expect(normalizeSearchText('Valparaíso')).toBe('valparaiso');
    expect(normalizeSearchText('Reykjavík')).toBe('reykjavik');
  });

  it('tokenizes search text into deduplicated normalized tokens', () => {
    const tokens = tokenizeSearchText('Café Zürich café');
    expect(tokens).toEqual(['cafe', 'zurich']);
  });

  it('matches accented and unaccented search queries bidirectionally', () => {
    const index = new OfflineVenueSearchIndex(internationalVenues);

    // Unaccented query matches accented indexed venue
    const matchZurichUnaccented = index.search('zurich');
    expect(matchZurichUnaccented.map((r) => r.venue.id)).toContain('v-zurich');

    // Accented query matches accented indexed venue
    const matchZurichAccented = index.search('Zürich');
    expect(matchZurichAccented.map((r) => r.venue.id)).toContain('v-zurich');

    // Query for "cafe" matches "Café" in name/amenities
    const matchCafeUnaccented = index.search('cafe');
    expect(matchCafeUnaccented.map((r) => r.venue.id)).toContain('v-saopaulo');
    expect(matchCafeUnaccented.map((r) => r.venue.id)).toContain('v-bogota');
    expect(matchCafeUnaccented.map((r) => r.venue.id)).toContain('v-valparaiso');

    // Query for "café" matches unaccented / accented equivalently
    const matchCafeAccented = index.search('café');
    expect(matchCafeAccented.map((r) => r.venue.id)).toContain('v-saopaulo');
    expect(matchCafeAccented.map((r) => r.venue.id)).toContain('v-bogota');

    // Latin American names with tildes and acutes
    const matchSaoPaulo = index.search('Sao Paulo');
    expect(matchSaoPaulo.map((r) => r.venue.id)).toContain('v-saopaulo');

    const matchBogota = index.search('bogota');
    expect(matchBogota.map((r) => r.venue.id)).toContain('v-bogota');

    const matchMunchen = index.search('Munchen');
    expect(matchMunchen.map((r) => r.venue.id)).toContain('v-munchen');

    const matchValparaiso = index.search('valparaiso');
    expect(matchValparaiso.map((r) => r.venue.id)).toContain('v-valparaiso');
  });

  it('matches unaccented venue indexing with accented queries', () => {
    const index = new OfflineVenueSearchIndex([
      {
        id: 'v-plain-cafe',
        name: 'Cafe Central',
        neighborhood: 'Downtown',
      },
    ]);

    // Querying with accent "café" matches indexed "Cafe"
    const results = index.search('café');
    expect(results.length).toBe(1);
    expect(results[0]?.venue.id).toBe('v-plain-cafe');
  });

  it('preserves existing token, prefix, typo tolerance, and punctuation normalization', () => {
    const index = new OfflineVenueSearchIndex(sampleVenues);

    const exact = index.search('fiber');
    expect(exact.map((r) => r.venue.id)).toContain('v-bandra');
    expect(exact.map((r) => r.venue.id)).toContain('v-powai');

    const prefix = index.search('ban');
    expect(prefix[0]?.venue.id).toBe('v-bandra');

    const typo = index.search('qiet');
    expect(typo.map((r) => r.venue.id)).toContain('v-bandra');

    const specialChars = index.search('@@@   ---   ');
    expect(specialChars).toEqual([]);
  });

  it('preserves facet filters and ranking order', () => {
    const index = new OfflineVenueSearchIndex(sampleVenues);

    const filtered = index.search('power', {
      minWifiMbps: 150,
      maxNoiseDb: 55,
      minAvailableSeats: 5,
    });

    expect(filtered.map((r) => r.venue.id)).toEqual(['v-bandra', 'v-powai']);
  });

  it('returns empty results for blank queries without facets and breaks ties deterministically', () => {
    const index = new OfflineVenueSearchIndex([
      { id: 'venue-z', name: 'Quiet Desk', amenities: ['quiet'], wifiMbps: 100 },
      { id: 'venue-a', name: 'Quiet Desk', amenities: ['quiet'], wifiMbps: 100 },
    ]);

    expect(index.search('   ')).toEqual([]);

    const tied = index.search('quiet');
    expect(tied.map((r) => r.venue.id)).toEqual(['venue-a', 'venue-z']);
  });
});
