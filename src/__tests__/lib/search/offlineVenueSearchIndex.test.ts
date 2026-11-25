import {
  OfflineVenueSearchIndex,
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

  it('supports exact token, prefix, accent/punctuation normalization, and bounded typo fuzzy matching', () => {
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

  it('applies facet filters for minimum WiFi Mbps, max noise dB, and minimum open seats', () => {
    const index = new OfflineVenueSearchIndex(sampleVenues);

    const filtered = index.search('power', {
      minWifiMbps: 150,
      maxNoiseDb: 55,
      minAvailableSeats: 5,
    });

    expect(filtered.map((r) => r.venue.id)).toEqual(['v-bandra', 'v-powai']);
  });

  it('returns empty results for blank queries when no filters apply and breaks ties deterministically by venue id', () => {
    const index = new OfflineVenueSearchIndex([
      { id: 'venue-z', name: 'Quiet Desk', amenities: ['quiet'], wifiMbps: 100 },
      { id: 'venue-a', name: 'Quiet Desk', amenities: ['quiet'], wifiMbps: 100 },
    ]);

    expect(index.search('   ')).toEqual([]);

    const tied = index.search('quiet');
    expect(tied.map((r) => r.venue.id)).toEqual(['venue-a', 'venue-z']);
  });
});
