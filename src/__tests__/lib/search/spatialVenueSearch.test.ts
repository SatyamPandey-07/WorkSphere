import {
    GeoCoordinateSchema,
    toPostGisLonLatTuple,
    calculateSphericalDistanceMeters,
    searchVenuesWithinRadius,
} from '@/lib/search/spatialVenueSearch';
import { prisma } from '@/lib/prisma';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        $queryRaw: jest.fn(),
    },
}));

const mockedQueryRaw = prisma.$queryRaw as jest.Mock;

describe('spatialVenueSearch (PostGIS lon/lat Axis Order & Bounds Validation)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    // Known Indian tech hub coordinates (lat ~12-18°N, lon ~73-77°E)
    const PUNE_BAVDHAN = { latitude: 18.5158, longitude: 73.7798 };
    const PUNE_FC_ROAD = { latitude: 18.5225, longitude: 73.8415 };
    const PUNE_KOREGAON_PARK = { latitude: 18.5362, longitude: 73.894 };

    const BLR_INDIRANAGAR = { latitude: 12.9784, longitude: 77.6408 };
    const BLR_KORAMANGALA = { latitude: 12.9352, longitude: 77.6245 };

    test('validates WGS84 latitude [-90, 90] and longitude [-180, 180] bounds via Zod', () => {
        expect(() =>
            GeoCoordinateSchema.parse({ latitude: 91.5, longitude: 73.85 })
        ).toThrow(/Latitude must be <= 90/);

        expect(() =>
            GeoCoordinateSchema.parse({ latitude: -90.01, longitude: 73.85 })
        ).toThrow(/Latitude must be >= -90/);

        expect(() =>
            GeoCoordinateSchema.parse({ latitude: 18.52, longitude: 181.2 })
        ).toThrow(/Longitude must be <= 180/);

        expect(() =>
            GeoCoordinateSchema.parse({ latitude: 18.52, longitude: -180.5 })
        ).toThrow(/Longitude must be >= -180/);
    });

    test('orders PostGIS tuple strictly as [longitude, latitude] for Pune and Bangalore landmarks', () => {
        // Pune: longitude (73.7798) MUST precede latitude (18.5158)
        expect(toPostGisLonLatTuple(PUNE_BAVDHAN)).toEqual([73.7798, 18.5158]);

        // Bangalore: longitude (77.6408) MUST precede latitude (12.9784)
        expect(toPostGisLonLatTuple(BLR_INDIRANAGAR)).toEqual([77.6408, 12.9784]);
    });

    test('passes (longitude, latitude) in exact ST_MakePoint($1, $2) order to Prisma $queryRaw', async () => {
        mockedQueryRaw.mockResolvedValueOnce([
            {
                id: 'venue-pune-fc',
                name: 'Third Wave Coffee FC Road',
                address: 'Fergusson College Rd, Pune',
                latitude: PUNE_FC_ROAD.latitude,
                longitude: PUNE_FC_ROAD.longitude,
                wifiSpeedMbps: 150,
                noiseDb: 46,
                outletDensity: 4,
                rating: 4.8,
                distanceMeters: 6550,
            },
        ]);

        const results = await searchVenuesWithinRadius({
            latitude: PUNE_BAVDHAN.latitude,
            longitude: PUNE_BAVDHAN.longitude,
            radiusMeters: 10_000,
            limit: 10,
        });

        expect(mockedQueryRaw).toHaveBeenCalledTimes(1);

        // Inspect Prisma.Sql parameterized values array passed to $queryRaw
        const sqlObject = mockedQueryRaw.mock.calls[0][0] as {
            strings: string[];
            values: unknown[];
        };

        expect(sqlObject.strings.join('?')).toContain('ST_SetSRID(ST_MakePoint(');
        // First bound coordinate pair MUST be (longitude = 73.7798, latitude = 18.5158)
        expect(sqlObject.values[0]).toBe(PUNE_BAVDHAN.longitude);
        expect(sqlObject.values[1]).toBe(PUNE_BAVDHAN.latitude);
        expect(results).toHaveLength(1);
        expect(results[0].name).toBe('Third Wave Coffee FC Road');
    });

    test('catches axis inversion against known Pune & Bangalore landmark distances', () => {
        // Bavdhan to Koregaon Park in Pune is ~12.2 km (not > 6,000 km in the Arabian Sea / Antarctica)
        const puneDistance = calculateSphericalDistanceMeters(
            PUNE_BAVDHAN,
            PUNE_KOREGAON_PARK
        );
        expect(puneDistance).toBeGreaterThan(11_500);
        expect(puneDistance).toBeLessThan(13_000);

        // Indiranagar to Koramangala in Bangalore is ~5.1 km
        const blrDistance = calculateSphericalDistanceMeters(
            BLR_INDIRANAGAR,
            BLR_KORAMANGALA
        );
        expect(blrDistance).toBeGreaterThan(4_500);
        expect(blrDistance).toBeLessThan(5_800);

        // Transposing (lat, lon) -> (lon, lat) creates an error > 6,000 km
        const transposedPune = {
            latitude: PUNE_BAVDHAN.longitude,
            longitude: PUNE_BAVDHAN.latitude,
        };
        const invertedErrorDistance = calculateSphericalDistanceMeters(
            transposedPune,
            PUNE_KOREGAON_PARK
        );
        expect(invertedErrorDistance).toBeGreaterThan(6_000_000);
    });
});