import {
  haversineKm,
  haversineMiles,
  calculateDistance,
  getWalkingMinutes,
  formatWalkingTimeBadge,
  sortVenuesByProximity,
  filterVenuesByRadius,
} from "@/lib/distance";
import { calculateHaversineDistance } from "@/lib/utils";

describe("distance utility (haversineKm)", () => {
  describe("identical coordinates", () => {
    it("returns 0 km for identical points at origin (0, 0)", () => {
      expect(haversineKm(0, 0, 0, 0)).toBe(0);
    });

    it("returns 0 km for identical arbitrary geographic coordinates", () => {
      expect(haversineKm(40.7128, -74.006, 40.7128, -74.006)).toBe(0);
      expect(haversineKm(-33.8688, 151.2093, -33.8688, 151.2093)).toBe(0);
      expect(haversineKm(51.5074, -0.1278, 51.5074, -0.1278)).toBe(0);
    });
  });

  describe("known reference distances", () => {
    it("calculates distance between New York and London (~5570 km)", () => {
      // New York City: 40.7128° N, 74.0060° W
      // London:        51.5074° N,  0.1278° W
      const dist = haversineKm(40.7128, -74.006, 51.5074, -0.1278);
      expect(dist).toBeGreaterThan(5500);
      expect(dist).toBeLessThan(5650);
    });

    it("calculates distance between Paris and Tokyo (~9710 km)", () => {
      // Paris: 48.8566° N, 2.3522° E
      // Tokyo: 35.6762° N, 139.6503° E
      const dist = haversineKm(48.8566, 2.3522, 35.6762, 139.6503);
      expect(dist).toBeGreaterThan(9600);
      expect(dist).toBeLessThan(9800);
    });

    it("calculates distance between London and Paris (~343 km)", () => {
      // London: 51.5074° N,  0.1278° W
      // Paris:  48.8566° N,  2.3522° E
      const dist = haversineKm(51.5074, -0.1278, 48.8566, 2.3522);
      expect(dist).toBeGreaterThan(340);
      expect(dist).toBeLessThan(350);
    });

    it("calculates distance between Manhattan and Brooklyn (~6.2 km)", () => {
      // Manhattan (Empire State): 40.7484° N, 73.9857° W
      // Brooklyn (Borough Hall):   40.6925° N, 73.9904° W
      const dist = haversineKm(40.7484, -73.9857, 40.6925, -73.9904);
      expect(dist).toBeGreaterThan(5.8);
      expect(dist).toBeLessThan(6.6);
    });

    it("calculates short inter-city distance (San Francisco to Oakland ~13.5 km)", () => {
      // San Francisco: 37.7749° N, 122.4194° W
      // Oakland:       37.8044° N, 122.2712° W
      const dist = haversineKm(37.7749, -122.4194, 37.8044, -122.2712);
      expect(dist).toBeGreaterThan(12);
      expect(dist).toBeLessThan(15);
    });
  });

  describe("antipodal coordinates", () => {
    it("calculates approximate distance for antipodal points (~20,015 km across equator)", () => {
      // Points diametrically opposite on the globe (half Earth circumference ≈ 20,015 km)
      const dist = haversineKm(0, 0, 0, 180);
      expect(dist).toBeGreaterThan(20000);
      expect(dist).toBeLessThan(20030);
    });

    it("calculates antipodal distance from North Pole to South Pole (~20,015 km)", () => {
      const dist = haversineKm(90, 0, -90, 0);
      expect(dist).toBeGreaterThan(20000);
      expect(dist).toBeLessThan(20030);
    });
  });

  describe("coordinate boundary values", () => {
    it("handles extreme latitude boundaries (-90 and 90)", () => {
      expect(haversineKm(90, 0, 90, 0)).toBe(0);
      expect(haversineKm(-90, 0, -90, 0)).toBe(0);
    });

    it("handles extreme longitude boundaries (-180 and 180)", () => {
      // -180 and 180 degrees longitude represent the exact same line
      const dist = haversineKm(0, -180, 0, 180);
      expect(dist).toBeCloseTo(0, 5);
    });

    it("handles diagonal boundary coordinates", () => {
      const dist = haversineKm(90, 180, -90, -180);
      expect(dist).toBeGreaterThan(20000);
      expect(dist).toBeLessThan(20030);
    });
  });

  describe("symmetry and non-negativity", () => {
    it("is symmetric: haversineKm(A, B) === haversineKm(B, A)", () => {
      const distAB = haversineKm(37.7749, -122.4194, 51.5074, -0.1278);
      const distBA = haversineKm(51.5074, -0.1278, 37.7749, -122.4194);
      expect(distAB).toBeCloseTo(distBA, 5);
    });

    it("always returns non-negative distances for various coordinate pairs", () => {
      const testCoordinates: [number, number, number, number][] = [
        [0, 0, 0, 0],
        [-34.6037, -58.3816, 40.7128, -74.006],
        [-90, 180, 90, -180],
        [45, 90, -45, -90],
      ];
      for (const [lat1, lon1, lat2, lon2] of testCoordinates) {
        expect(haversineKm(lat1, lon1, lat2, lon2)).toBeGreaterThanOrEqual(0);
      }
    });

    it("matches calculateHaversineDistance output directly", () => {
      const lat1 = 28.6139;
      const lon1 = 77.209;
      const lat2 = 19.076;
      const lon2 = 72.8777;

      expect(haversineKm(lat1, lon1, lat2, lon2)).toBe(
        calculateHaversineDistance(lat1, lon1, lat2, lon2),
      );
    });
  });

  describe("invalid coordinate handling (#4376)", () => {
    it("returns NaN when latitude or longitude is NaN", () => {
      expect(haversineKm(NaN, 0, 10, 10)).toBeNaN();
      expect(haversineKm(0, NaN, 10, 10)).toBeNaN();
      expect(haversineKm(0, 0, NaN, 10)).toBeNaN();
      expect(haversineKm(0, 0, 10, NaN)).toBeNaN();
    });

    it("returns NaN when coordinates are undefined", () => {
      expect(haversineKm(undefined as any, 0, 10, 10)).toBeNaN();
      expect(haversineKm(0, undefined as any, 10, 10)).toBeNaN();
      expect(haversineKm(0, 0, undefined as any, 10)).toBeNaN();
      expect(haversineKm(0, 0, 10, undefined as any)).toBeNaN();
    });

    it("returns NaN when coordinates are null", () => {
      expect(haversineKm(null as any, 0, 10, 10)).toBeNaN();
      expect(haversineKm(0, null as any, 10, 10)).toBeNaN();
      expect(haversineKm(0, 0, null as any, 10)).toBeNaN();
      expect(haversineKm(0, 0, 10, null as any)).toBeNaN();
    });

    it("returns NaN when coordinates are non-finite or infinite", () => {
      expect(haversineKm(Infinity, 0, 10, 10)).toBeNaN();
      expect(haversineKm(0, -Infinity, 10, 10)).toBeNaN();
      expect(haversineKm(0, 0, Infinity, 10)).toBeNaN();
      expect(haversineKm(0, 0, 10, -Infinity)).toBeNaN();
    });
  });
});

describe("haversineMiles", () => {
  it("converts kilometers to miles correctly", () => {
    // New York to London
    const miles = haversineMiles(40.7128, -74.006, 51.5074, -0.1278);
    // 5570 km * 0.621371 = 3461 miles
    expect(miles).toBeGreaterThan(3400);
    expect(miles).toBeLessThan(3550);
  });

  it("returns 0 for identical points", () => {
    expect(haversineMiles(40.7128, -74.006, 40.7128, -74.006)).toBe(0);
  });

  it("matches haversineKm scaled by the mile conversion factor", () => {
    const km = haversineKm(28.6139, 77.209, 19.076, 72.8777);
    expect(haversineMiles(28.6139, 77.209, 19.076, 72.8777)).toBeCloseTo(
      km * 0.621371,
      10,
    );
  });
});

describe("getWalkingMinutes", () => {
  it("calculates correct walking minutes at 4.8 km/h", () => {
    // 4.8 km = 60 mins
    expect(getWalkingMinutes(4.8)).toBe(60);
    // 2.4 km = 30 mins
    expect(getWalkingMinutes(2.4)).toBe(30);
    // 0.8 km = 10 mins
    expect(getWalkingMinutes(0.8)).toBe(10);
  });

  it("always rounds up using ceil", () => {
    // 0.1 km = 1.25 mins -> 2 mins
    expect(getWalkingMinutes(0.1)).toBe(2);
    // 0.05 km = 0.625 mins -> 1 min
    expect(getWalkingMinutes(0.05)).toBe(1);
  });

  it("returns 0 for a zero distance", () => {
    expect(getWalkingMinutes(0)).toBe(0);
  });
});

describe("formatWalkingTimeBadge", () => {
  it("formats distances >= 1 km correctly", () => {
    // 1.2 km -> 15 min walk
    expect(formatWalkingTimeBadge(1.2)).toBe("15 min walk · 1.2km");
    // 2.5 km -> 32 min walk
    expect(formatWalkingTimeBadge(2.5)).toBe("32 min walk · 2.5km");
  });

  it("formats distances < 1 km correctly using meters", () => {
    // 0.65 km -> 9 min walk
    expect(formatWalkingTimeBadge(0.65)).toBe("9 min walk · 650m");
    // 0.5 km -> 7 min walk
    expect(formatWalkingTimeBadge(0.5)).toBe("7 min walk · 500m");
  });

  it("switches from meters to kilometers at the 1 km boundary", () => {
    expect(formatWalkingTimeBadge(0.95)).toBe("12 min walk · 950m");
    expect(formatWalkingTimeBadge(0.99)).toBe("13 min walk · 990m");
    expect(formatWalkingTimeBadge(0.999)).toBe("13 min walk · 999m");
    expect(formatWalkingTimeBadge(0.9995)).toBe("13 min walk · 1.0km");
    expect(formatWalkingTimeBadge(1)).toBe("13 min walk · 1.0km");
  });

  it("handles a zero distance", () => {
    expect(formatWalkingTimeBadge(0)).toBe("0 min walk · 0m");
  });
});

describe("calculateDistance", () => {
  it("defaults to kilometers", () => {
    const dist = calculateDistance(51.5074, -0.1278, 48.8566, 2.3522);
    expect(dist).toBeCloseTo(haversineKm(51.5074, -0.1278, 48.8566, 2.3522), 5);
  });

  it("calculates distance in miles", () => {
    const miles = calculateDistance(51.5074, -0.1278, 48.8566, 2.3522, "miles");
    expect(miles).toBeCloseTo(haversineMiles(51.5074, -0.1278, 48.8566, 2.3522), 5);
  });

  it("calculates distance in meters", () => {
    const meters = calculateDistance(51.5074, -0.1278, 48.8566, 2.3522, "meters");
    const km = haversineKm(51.5074, -0.1278, 48.8566, 2.3522);
    expect(meters).toBeCloseTo(km * 1000, 2);
  });

  it("calculates walking minutes at 4.8 km/h", () => {
    const mins = calculateDistance(40.7484, -73.9857, 40.6925, -73.9904, "walking_minutes");
    const km = haversineKm(40.7484, -73.9857, 40.6925, -73.9904);
    expect(mins).toBe(getWalkingMinutes(km));
  });

  it("returns NaN for invalid inputs", () => {
    expect(calculateDistance(NaN, 0, 10, 10)).toBeNaN();
  });
});

describe("sortVenuesByProximity", () => {
  const venues = [
    { id: "far", name: "Paris", lat: 48.8566, lng: 2.3522 },
    { id: "near", name: "Brooklyn", lat: 40.6925, lng: -73.9904 },
    { id: "closest", name: "Midtown", lat: 40.7549, lng: -73.9840 },
  ];
  const userLocation = { lat: 40.7484, lng: -73.9857 }; // Empire State Building

  it("sorts venues by ascending distance from user location", () => {
    const sorted = sortVenuesByProximity(venues, userLocation);
    expect(sorted.map((v) => v.id)).toEqual(["closest", "near", "far"]);
  });

  it("returns unchanged array if userLocation is null or invalid", () => {
    expect(sortVenuesByProximity(venues, null)).toEqual(venues);
    expect(sortVenuesByProximity(venues, { lat: NaN, lng: 0 })).toEqual(venues);
  });
});

describe("filterVenuesByRadius", () => {
  const venues = [
    { id: "1", name: "Close Spot", lat: 40.7490, lng: -73.9860 }, // ~0.1 km
    { id: "2", name: "Medium Spot", lat: 40.7600, lng: -73.9800 }, // ~1.4 km
    { id: "3", name: "Far Spot", lat: 40.8000, lng: -73.9500 }, // ~6.4 km
  ];
  const userLocation = { lat: 40.7484, lng: -73.9857 };

  it("filters venues within maxDistanceKm", () => {
    const within1km = filterVenuesByRadius(venues, userLocation, 1);
    expect(within1km.map((v) => v.id)).toEqual(["1"]);

    const within3km = filterVenuesByRadius(venues, userLocation, 3);
    expect(within3km.map((v) => v.id)).toEqual(["1", "2"]);

    const within10km = filterVenuesByRadius(venues, userLocation, 10);
    expect(within10km.map((v) => v.id)).toEqual(["1", "2", "3"]);
  });

  it("returns all venues when maxDistanceKm is 0 or negative", () => {
    expect(filterVenuesByRadius(venues, userLocation, 0)).toEqual(venues);
    expect(filterVenuesByRadius(venues, userLocation, -1)).toEqual(venues);
  });
});

