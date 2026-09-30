/**
 * Tests for combining multiple venue search filters.
 */

interface VenueRecord {
  venueId: string;
  name: string;
  category: string;
  distanceKm: number;
  rating: number;
  priceCents: number;
  amenities: string[];
  isOpen: boolean;
  capacity: number;
}

type FilterFn = (venue: VenueRecord) => boolean;

function categoryFilter(categories: string[]): FilterFn {
  return (v) => categories.length === 0 || categories.includes(v.category);
}

function distanceFilter(maxKm: number): FilterFn {
  return (v) => v.distanceKm <= maxKm;
}

function ratingFilter(minRating: number): FilterFn {
  return (v) => v.rating >= minRating;
}

function priceFilter(maxCents: number): FilterFn {
  return (v) => v.priceCents <= maxCents;
}

function amenityFilter(required: string[]): FilterFn {
  return (v) => required.every((a) => v.amenities.includes(a));
}

function openNowFilter(): FilterFn {
  return (v) => v.isOpen;
}

function applyFilters(venues: VenueRecord[], filters: FilterFn[]): VenueRecord[] {
  return venues.filter((v) => filters.every((f) => f(v)));
}

const VENUES: VenueRecord[] = [
  { venueId: "v1", name: "Café A",  category: "cafe",      distanceKm: 0.5, rating: 4.5, priceCents: 500,  amenities: ["wifi", "outlets"],          isOpen: true,  capacity: 20 },
  { venueId: "v2", name: "Hub B",   category: "coworking", distanceKm: 1.5, rating: 4.0, priceCents: 1000, amenities: ["wifi", "standing_desk"],     isOpen: true,  capacity: 50 },
  { venueId: "v3", name: "Lib C",   category: "library",   distanceKm: 3.0, rating: 4.8, priceCents: 0,    amenities: ["wifi", "quiet"],             isOpen: false, capacity: 30 },
  { venueId: "v4", name: "Club D",  category: "cafe",      distanceKm: 5.0, rating: 3.5, priceCents: 800,  amenities: ["coffee", "wifi"],            isOpen: true,  capacity: 15 },
];

describe("Venue search filter combination", () => {
  it("categoryFilter: cafe only", () => {
    const result = applyFilters(VENUES, [categoryFilter(["cafe"])]);
    expect(result.every((v) => v.category === "cafe")).toBe(true);
    expect(result).toHaveLength(2);
  });

  it("distanceFilter: within 2km", () => {
    const result = applyFilters(VENUES, [distanceFilter(2)]);
    expect(result).toHaveLength(2);
  });

  it("ratingFilter: min 4.5 → v1, v3", () => {
    const result = applyFilters(VENUES, [ratingFilter(4.5)]);
    expect(result).toHaveLength(2);
  });

  it("openNowFilter: excludes v3 (closed)", () => {
    const result = applyFilters(VENUES, [openNowFilter()]);
    expect(result.every((v) => v.isOpen)).toBe(true);
    expect(result).toHaveLength(3);
  });

  it("amenityFilter: requires outlets → only v1", () => {
    const result = applyFilters(VENUES, [amenityFilter(["outlets"])]);
    expect(result).toHaveLength(1);
    expect(result[0].venueId).toBe("v1");
  });

  it("combined filters: open + wifi + max 1km + min 4.0", () => {
    const result = applyFilters(VENUES, [
      openNowFilter(),
      amenityFilter(["wifi"]),
      distanceFilter(1),
      ratingFilter(4.0),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].venueId).toBe("v1");
  });

  it("empty filters: returns all venues", () => {
    expect(applyFilters(VENUES, [])).toHaveLength(4);
  });
});
