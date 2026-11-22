import {
    sanitizeOverpassNameQuery,
    buildOverpassVenueQuery,
    queryOverpassVenues,
    MAX_OVERPASS_QUERY_LENGTH,
} from '@/lib/osm/overpassClient';

describe('overpassClient (OverpassQL Injection & Regex Sanitization)', () => {
    test('escapes double quotes, backslashes, and all regex metacharacters', () => {
        const malicious = 'Cafe "Blue" [Main] (24/7) \\ Test ^$.*+?{}|';
        const escaped = sanitizeOverpassNameQuery(malicious);

        expect(escaped).toBe(
            'Cafe \\"Blue\\" \\[Main\\] \\(24/7\\) \\\\ Test \\^\\$\\.\\*\\+\\?\\{\\}\\|'
        );
    });

    test('neutralizes OverpassQL breakout injection payloads', () => {
        const injectionAttempt = '"]; node["amenity"="bank"]; out; //';
        const query = buildOverpassVenueQuery({
            latitude: 18.5158,
            longitude: 73.7798,
            radiusMeters: 1500,
            nameQuery: injectionAttempt,
            amenityTypes: ['cafe'],
        });

        // No unescaped closing quote + bracket sequence can break out of ["name"~"...",i]
        expect(query).not.toContain('"]; node["amenity"="bank"]');
        expect(query).toContain(
            'node["amenity"="cafe"]["name"~"\\"\\]; node\\[\\"amenity\\"=\\"bank\\"\\]; out; //",i](around:1500,18.5158,73.7798);'
        );
    });

    test('enforces maximum query length of 100 characters before escaping', () => {
        const longInput = 'A'.repeat(150);
        const sanitized = sanitizeOverpassNameQuery(longInput);

        expect(sanitized).toHaveLength(MAX_OVERPASS_QUERY_LENGTH);
        expect(sanitized).toBe('A'.repeat(100));
    });

    test('strips control characters and returns empty string for blank input', () => {
        expect(sanitizeOverpassNameQuery('   \n\t\r  ')).toBe('');
        expect(sanitizeOverpassNameQuery('Third\nWave\rCoffee')).toBe('Third Wave Coffee');
    });

    test('submits sanitized URL-encoded Overpass QL body via POST', async () => {
        const fetchSpy = jest.fn().mockResolvedValueOnce(
            new Response(
                JSON.stringify({
                    version: 0.6,
                    generator: 'Overpass API',
                    elements: [{ type: 'node', id: 101, lat: 18.52, lon: 73.84 }],
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
        );

        const elements = await queryOverpassVenues(
            {
                latitude: 18.52,
                longitude: 73.84,
                nameQuery: 'Blue [Tokai]',
                amenityTypes: ['cafe'],
            },
            { fetchFn: fetchSpy as unknown as typeof fetch }
        );

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
        const decodedBody = decodeURIComponent(String(init.body));
        expect(decodedBody).toContain('["name"~"Blue \\[Tokai\\]",i]');
        expect(elements).toHaveLength(1);
    });
});