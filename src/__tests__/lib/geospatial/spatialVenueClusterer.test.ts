import {
  clusterSpatialVenues,
  webMercatorMetersPerPixel,
  type SpatialVenueInput,
} from "@/lib/geospatial/spatialVenueClusterer";

type VenueMetrics = Pick<
  SpatialVenueInput,
  | "wifiSpeed"
  | "noiseLevel"
  | "currentOccupancy"
  | "maxCapacity"
  | "avgDecibels"
>;

function makeVenue(
  id: string,
  latitude: number,
  longitude: number,
  metrics: Partial<VenueMetrics> = {},
): SpatialVenueInput {
  return { id, latitude, longitude, ...metrics };
}

function clusterFor(
  venues: readonly SpatialVenueInput[],
  venueId: string,
  zoom = 10,
  radiusPx = 60,
) {
  const result = clusterSpatialVenues(venues, { zoom, radiusPx });
  return result.clusters.find((cluster) =>
    cluster.memberVenueIds.includes(venueId),
  );
}

describe("clusterSpatialVenues", () => {
  describe("basic clustering and determinism", () => {
    it("returns an empty result for empty input", () => {
      expect(clusterSpatialVenues([], { zoom: 5 })).toEqual({
        clusters: [],
        excludedVenues: [],
        distanceComparisons: 0,
      });
    });

    it("returns one singleton cluster for one valid venue", () => {
      const result = clusterSpatialVenues(
        [makeVenue("venue-1", 37.7749, -122.4194)],
        { zoom: 10 },
      );

      expect(result.clusters).toHaveLength(1);
      expect(result.clusters[0]).toMatchObject({
        venueCount: 1,
        memberVenueIds: ["venue-1"],
        zoomLevel: 10,
        averageWifiSpeed: null,
        minimumNoiseLevel: null,
        minimumNoiseDecibels: null,
      });
    });

    it("groups nearby venues and leaves distant venues separate", () => {
      const venues = [
        makeVenue("near-a", 37.7749, -122.4194),
        makeVenue("near-b", 37.775, -122.4195),
        makeVenue("far", 37.8044, -122.2712),
      ];
      const result = clusterSpatialVenues(venues, { zoom: 13 });

      expect(result.clusters).toHaveLength(2);
      expect(clusterFor(venues, "near-a", 13)?.memberVenueIds).toEqual([
        "near-a",
        "near-b",
      ]);
      expect(clusterFor(venues, "far", 13)?.memberVenueIds).toEqual(["far"]);
    });

    it("is independent of venue input order and returns stable ordering", () => {
      const venues = [
        makeVenue("c", 40.713, -74.006),
        makeVenue("a", 40.7128, -74.006),
        makeVenue("b", 40.7129, -74.006),
        makeVenue("z", 34.0522, -118.2437),
      ];
      const first = clusterSpatialVenues(venues, { zoom: 12 });
      const second = clusterSpatialVenues([...venues].reverse(), { zoom: 12 });

      expect(second).toEqual(first);
      expect(first.clusters.map((cluster) => cluster.id)).toEqual(
        [...first.clusters.map((cluster) => cluster.id)].sort(),
      );
    });

    it("rejects duplicate venue identifiers instead of assigning them twice", () => {
      expect(() =>
        clusterSpatialVenues(
          [makeVenue("duplicate", 10, 10), makeVenue("duplicate", 20, 20)],
          { zoom: 5 },
        ),
      ).toThrow('Duplicate venue id "duplicate"');
    });

    it("supports the shared Venue lat/lng coordinate convention", () => {
      const venue: SpatialVenueInput = {
        id: "shared-type-venue",
        lat: 51.5,
        lng: -0.12,
      };

      const result = clusterSpatialVenues([venue], { zoom: 8 });
      expect(result.clusters[0].centroidLatitude).toBeCloseTo(51.5, 10);
      expect(result.clusters[0].centroidLongitude).toBeCloseTo(-0.12, 10);
    });
  });

  describe("zoom and configuration", () => {
    const closePair = [makeVenue("a", 0, 0), makeVenue("b", 0, 0.1)];

    it("combines more venues at low zoom and progressively splits them", () => {
      const zoomOne = clusterSpatialVenues(closePair, { zoom: 1 });
      const zoomFive = clusterSpatialVenues(closePair, { zoom: 5 });
      const zoomTen = clusterSpatialVenues(closePair, { zoom: 10 });

      expect(zoomOne.clusters).toHaveLength(1);
      expect(zoomFive.clusters).toHaveLength(1);
      expect(zoomTen.clusters).toHaveLength(2);
    });

    it("supports zoom levels 1 and 20", () => {
      expect(
        clusterSpatialVenues(closePair, { zoom: 1 }).clusters[0].venueCount,
      ).toBe(2);
      const zoom20 = clusterSpatialVenues(closePair, { zoom: 20 });
      expect(zoom20.clusters).toHaveLength(2);
      expect(zoom20.clusters.every((cluster) => cluster.venueCount === 1)).toBe(
        true,
      );
    });

    it("returns individual pins at the configurable high-zoom threshold", () => {
      const result = clusterSpatialVenues(closePair, {
        zoom: 12,
        individualPinsAtZoom: 12,
      });
      expect(result.clusters.map((cluster) => cluster.venueCount)).toEqual([
        1, 1,
      ]);
      expect(result.distanceComparisons).toBe(0);
    });

    it.each([0, 21, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
      "rejects invalid zoom %s",
      (zoom) => {
        expect(() => clusterSpatialVenues([], { zoom })).toThrow(
          "zoom must be an integer from 1 through 20.",
        );
      },
    );

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1025])(
      "rejects invalid pixel radius %s",
      (radiusPx) => {
        expect(() => clusterSpatialVenues([], { zoom: 5, radiusPx })).toThrow(
          "radiusPx must be finite and in the range (0, 1024].",
        );
      },
    );

    it.each([0, 21, 2.5])(
      "rejects invalid individual-pin threshold %s",
      (individualPinsAtZoom) => {
        expect(() =>
          clusterSpatialVenues([], { zoom: 5, individualPinsAtZoom }),
        ).toThrow("individualPinsAtZoom must be an integer from 1 through 20.");
      },
    );

    it("rejects a malformed configuration object", () => {
      expect(() =>
        Reflect.apply(clusterSpatialVenues, undefined, [[], null]),
      ).toThrow("Clustering options are required.");
    });
  });

  describe("geographic coordinates and centroids", () => {
    it("computes an ordinary spherical centroid", () => {
      const result = clusterSpatialVenues(
        [makeVenue("west", 0, 0), makeVenue("east", 0, 2)],
        { zoom: 5 },
      );

      expect(result.clusters).toHaveLength(1);
      expect(result.clusters[0].centroidLatitude).toBeCloseTo(0, 10);
      expect(result.clusters[0].centroidLongitude).toBeCloseTo(1, 10);
    });

    it("clusters and computes a centroid across the antimeridian", () => {
      const result = clusterSpatialVenues(
        [makeVenue("east", 10, 179.999), makeVenue("west", 10, -179.999)],
        { zoom: 10 },
      );

      expect(result.clusters).toHaveLength(1);
      expect(Math.abs(result.clusters[0].centroidLongitude)).toBeCloseTo(
        180,
        2,
      );
      expect(result.clusters[0].centroidLatitude).toBeCloseTo(10, 2);
    });

    it("handles high latitudes and the Web Mercator projection limit", () => {
      const result = clusterSpatialVenues(
        [makeVenue("high-a", 85, 10), makeVenue("high-b", 85, 10.001)],
        { zoom: 10 },
      );

      expect(result.clusters).toHaveLength(1);
      expect(Number.isFinite(result.clusters[0].centroidLatitude)).toBe(true);
      expect(result.clusters[0].centroidLatitude).toBeGreaterThan(84.9);
      expect(webMercatorMetersPerPixel(89, 10)).toBeGreaterThan(0);
      expect(webMercatorMetersPerPixel(89, 10)).toBeLessThan(
        webMercatorMetersPerPixel(0, 10),
      );
    });

    it("handles identical coordinates without losing venue identity", () => {
      const result = clusterSpatialVenues(
        [makeVenue("a", 45, 90), makeVenue("b", 45, 90)],
        { zoom: 5 },
      );

      expect(result.clusters).toHaveLength(1);
      expect(result.clusters[0].venueCount).toBe(2);
      expect(result.clusters[0].memberVenueIds).toEqual(["a", "b"]);
      expect(result.clusters[0].centroidLatitude).toBeCloseTo(45, 10);
      expect(result.clusters[0].centroidLongitude).toBeCloseTo(90, 10);
    });

    it("uses a stable member-coordinate fallback for an antipodal centroid", () => {
      const result = clusterSpatialVenues(
        [makeVenue("b", 0, 180), makeVenue("a", 0, 0)],
        { zoom: 1, radiusPx: 300 },
      );

      expect(result.clusters).toHaveLength(1);
      expect(result.clusters[0].centroidLatitude).toBeCloseTo(0, 10);
      expect(result.clusters[0].centroidLongitude).toBe(0);
    });

    it("wraps +180 and -180 to the same projected longitude", () => {
      const result = clusterSpatialVenues(
        [makeVenue("east-edge", 0, 180), makeVenue("west-edge", 0, -180)],
        { zoom: 10 },
      );

      expect(result.clusters).toHaveLength(1);
      expect(result.clusters[0].centroidLongitude).toBe(-180);
    });

    it("reports invalid coordinates and conflicting coordinate aliases", () => {
      const invalid = [
        makeVenue("latitude-too-high", 91, 0),
        makeVenue("longitude-too-low", 0, -181),
        makeVenue("not-finite", Number.NaN, 0),
        makeVenue("not-finite-longitude", 0, Number.POSITIVE_INFINITY),
      ];
      const conflicting: SpatialVenueInput = {
        id: "conflicting",
        latitude: 10,
        longitude: 10,
        lat: 11,
        lng: 10,
      };

      const result = clusterSpatialVenues([...invalid, conflicting], {
        zoom: 4,
      });
      expect(result.clusters).toEqual([]);
      expect(result.excludedVenues).toEqual([
        { venueId: "conflicting", reason: "conflicting_coordinates" },
        { venueId: "latitude-too-high", reason: "invalid_coordinates" },
        { venueId: "longitude-too-low", reason: "invalid_coordinates" },
        { venueId: "not-finite", reason: "invalid_coordinates" },
        { venueId: "not-finite-longitude", reason: "invalid_coordinates" },
      ]);
    });

    it("validates the meters-per-pixel helper inputs", () => {
      expect(() => webMercatorMetersPerPixel(91, 5)).toThrow(
        "latitude must be a finite value in [-90, 90].",
      );
      expect(() => webMercatorMetersPerPixel(0, 0)).toThrow(
        "zoom must be an integer from 1 through 20.",
      );
    });
  });

  describe("venue metric aggregates", () => {
    it("averages valid Wi-Fi speeds and finds minimum categorical and numeric noise", () => {
      const venues = [
        makeVenue("a", 37, -122, {
          wifiSpeed: 10,
          noiseLevel: "moderate",
          avgDecibels: 55,
        }),
        makeVenue("b", 37, -122, {
          wifiSpeed: 20,
          noiseLevel: "loud",
          avgDecibels: 42,
        }),
        makeVenue("c", 37, -122, {
          wifiSpeed: Number.NaN,
          noiseLevel: "quiet",
          avgDecibels: Number.POSITIVE_INFINITY,
        }),
        makeVenue("d", 37, -122, {
          wifiSpeed: -1,
          noiseLevel: "unknown",
          avgDecibels: 131,
        }),
      ];
      const cluster = clusterFor(venues, "a");

      expect(cluster?.averageWifiSpeed).toBe(15);
      expect(cluster?.minimumNoiseLevel).toBe("quiet");
      expect(cluster?.minimumNoiseDecibels).toBe(42);
    });

    it("aggregates only repository-supported availability fields", () => {
      const venues = [
        makeVenue("a", 37, -122, { currentOccupancy: 2, maxCapacity: 5 }),
        makeVenue("b", 37, -122, { currentOccupancy: 1, maxCapacity: 3 }),
        makeVenue("over-capacity", 37, -122, {
          currentOccupancy: 2,
          maxCapacity: 1,
        }),
        makeVenue("capacity-only", 37, -122, { maxCapacity: 4 }),
        makeVenue("invalid", 37, -122, {
          currentOccupancy: 1.5,
          maxCapacity: -3,
        }),
      ];
      const availability = clusterFor(venues, "a")?.availability;

      expect(availability).toEqual({
        currentOccupancy: 5,
        maxCapacity: 13,
        availableCapacity: 5,
        occupancyRatio: 3 / 8,
        currentOccupancyVenueCount: 3,
        maxCapacityVenueCount: 4,
        pairedAvailabilityVenueCount: 2,
      });
    });

    it("returns null aggregate values when all metrics are missing or invalid", () => {
      const cluster = clusterFor(
        [
          makeVenue("a", 37, -122, {
            wifiSpeed: Number.NaN,
            noiseLevel: "unrecognized",
            avgDecibels: -1,
            currentOccupancy: -1,
            maxCapacity: 1.5,
          }),
        ],
        "a",
      );

      expect(cluster).toMatchObject({
        averageWifiSpeed: null,
        minimumNoiseLevel: null,
        minimumNoiseDecibels: null,
        availability: {
          currentOccupancy: null,
          maxCapacity: null,
          availableCapacity: null,
          occupancyRatio: null,
          currentOccupancyVenueCount: 0,
          maxCapacityVenueCount: 0,
          pairedAvailabilityVenueCount: 0,
        },
      });
    });

    it("does not claim Wi-Fi or noise averages for empty metric sets", () => {
      const result = clusterSpatialVenues([], { zoom: 4 });
      expect(result.clusters).toEqual([]);
    });
  });

  describe("geographic bounds", () => {
    const venues = [
      makeVenue("inside", 37.75, -122.4),
      makeVenue("edge", 37.7, -122.5),
      makeVenue("outside", 38, -122),
    ];

    it("filters by normal bounds and includes boundary coordinates", () => {
      const result = clusterSpatialVenues(venues, {
        zoom: 8,
        bounds: {
          minLat: 37.7,
          maxLat: 37.8,
          minLng: -122.5,
          maxLng: -122.3,
        },
      });

      expect(
        result.clusters.flatMap((cluster) => cluster.memberVenueIds),
      ).toEqual(["edge", "inside"]);
      expect(result.excludedVenues).toEqual([
        { venueId: "outside", reason: "outside_bounds" },
      ]);
    });

    it("treats null bounds as an explicit empty viewport", () => {
      const result = clusterSpatialVenues(venues, { zoom: 8, bounds: null });
      expect(result.clusters).toEqual([]);
      expect(result.excludedVenues).toEqual([
        { venueId: "edge", reason: "empty_bounds" },
        { venueId: "inside", reason: "empty_bounds" },
        { venueId: "outside", reason: "empty_bounds" },
      ]);
    });

    it("supports antimeridian-crossing bounds", () => {
      const result = clusterSpatialVenues(
        [
          makeVenue("east", 0, 179),
          makeVenue("west", 0, -179),
          makeVenue("middle", 0, 0),
        ],
        {
          zoom: 5,
          bounds: { minLat: -1, maxLat: 1, minLng: 170, maxLng: -170 },
        },
      );

      expect(
        result.clusters.flatMap((cluster) => cluster.memberVenueIds),
      ).toEqual(["east", "west"]);
      expect(result.excludedVenues).toEqual([
        { venueId: "middle", reason: "outside_bounds" },
      ]);
    });

    it("returns no clusters when valid bounds match no venues", () => {
      const result = clusterSpatialVenues(venues, {
        zoom: 8,
        bounds: {
          minLat: -10,
          maxLat: -5,
          minLng: 10,
          maxLng: 20,
        },
      });
      expect(result.clusters).toEqual([]);
      expect(result.excludedVenues).toHaveLength(3);
    });

    it("rejects malformed or out-of-range bounds", () => {
      expect(() =>
        clusterSpatialVenues([], {
          zoom: 4,
          bounds: { minLat: 10, maxLat: 0, minLng: -1, maxLng: 1 },
        }),
      ).toThrow("bounds latitude values must satisfy");
      expect(() =>
        clusterSpatialVenues([], {
          zoom: 4,
          bounds: { minLat: -91, maxLat: 0, minLng: -1, maxLng: 1 },
        }),
      ).toThrow("bounds latitude values must satisfy");
      expect(() =>
        clusterSpatialVenues([], {
          zoom: 4,
          bounds: { minLat: 0, maxLat: 1, minLng: -181, maxLng: 1 },
        }),
      ).toThrow("bounds longitude values must be in [-180, 180].");
      expect(() =>
        clusterSpatialVenues([], {
          zoom: 4,
          bounds: {
            minLat: 0,
            maxLat: Number.NaN,
            minLng: -1,
            maxLng: 1,
          },
        }),
      ).toThrow("bounds must contain four finite coordinates.");
    });
  });

  describe("membership integrity and performance", () => {
    it("assigns every valid in-bounds venue exactly once and reports exclusions", () => {
      const venues = [
        makeVenue("a", 10, 10),
        makeVenue("b", 10, 10.001),
        makeVenue("outside", 40, 40),
        makeVenue("invalid", 100, 0),
      ];
      const result = clusterSpatialVenues(venues, {
        zoom: 8,
        bounds: { minLat: 0, maxLat: 20, minLng: 0, maxLng: 20 },
      });
      const members = result.clusters.flatMap(
        (cluster) => cluster.memberVenueIds,
      );

      expect(members.sort()).toEqual(["a", "b"]);
      expect(new Set(members).size).toBe(members.length);
      expect(result.excludedVenues).toEqual([
        { venueId: "invalid", reason: "invalid_coordinates" },
        { venueId: "outside", reason: "outside_bounds" },
      ]);
    });

    it("uses the quadtree to reduce comparisons for spatially separated points", () => {
      const venues = Array.from({ length: 2000 }, (_, index) => {
        const row = Math.floor(index / 50);
        const column = index % 50;
        return makeVenue(
          `venue-${String(index).padStart(4, "0")}`,
          -60 + row * 2.4,
          -170 + column * 6.8,
        );
      });

      const result = clusterSpatialVenues(venues, {
        zoom: 10,
        radiusPx: 30,
      });
      const allMembers = result.clusters.flatMap(
        (cluster) => cluster.memberVenueIds,
      );

      expect(allMembers).toHaveLength(venues.length);
      expect(new Set(allMembers).size).toBe(venues.length);
      expect(result.distanceComparisons).toBeLessThan(venues.length * 10);
      expect(result.clusters).toHaveLength(venues.length);
    });

    it("keeps aggregates stable across repeated executions", () => {
      const venues = [
        makeVenue("b", 40.7129, -74.006, {
          wifiSpeed: 85,
          noiseLevel: "moderate",
          currentOccupancy: 2,
          maxCapacity: 8,
        }),
        makeVenue("a", 40.7128, -74.006, {
          wifiSpeed: 45,
          noiseLevel: "quiet",
          currentOccupancy: 1,
          maxCapacity: 4,
        }),
      ];

      const first = clusterSpatialVenues(venues, { zoom: 12 });
      const second = clusterSpatialVenues(venues, { zoom: 12 });
      expect(second).toEqual(first);
    });
  });
});
