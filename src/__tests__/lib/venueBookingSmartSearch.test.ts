/**
 * Tests for venue booking smart search and filtering utilities.
 */

interface SearchFilters {
  city?: string;
  minCapacity?: number;
  maxCapacity?: number;
  minRating?: number;
  maxPricePerHour?: number;
  amenities?: string[];
  eventType?: string;
  availableDate?: string;
}

interface SearchVenue {
  id: string;
  name: string;
  city: string;
  capacity: number;
  rating: number;
  pricePerHour: number;
  amenities: string[];
  eventTypes: string[];
}

function matchesFilters(venue: SearchVenue, filters: SearchFilters): boolean {
  if (filters.city && venue.city.toLowerCase() !== filters.city.toLowerCase()) return false;
  if (filters.minCapacity && venue.capacity < filters.minCapacity) return false;
  if (filters.maxCapacity && venue.capacity > filters.maxCapacity) return false;
  if (filters.minRating && venue.rating < filters.minRating) return false;
  if (filters.maxPricePerHour && venue.pricePerHour > filters.maxPricePerHour) return false;
  if (filters.amenities?.length) {
    if (!filters.amenities.every((a) => venue.amenities.includes(a))) return false;
  }
  if (filters.eventType && !venue.eventTypes.includes(filters.eventType)) return false;
  return true;
}

function searchVenues(venues: SearchVenue[], filters: SearchFilters): SearchVenue[] {
  return venues.filter((v) => matchesFilters(v, filters));
}

function rankByRelevance(
  venues: SearchVenue[],
  filters: SearchFilters
): SearchVenue[] {
  return venues.slice().sort((a, b) => {
    let scoreA = a.rating * 20;
    let scoreB = b.rating * 20;
    if (filters.maxPricePerHour) {
      scoreA += (1 - a.pricePerHour / filters.maxPricePerHour) * 10;
      scoreB += (1 - b.pricePerHour / filters.maxPricePerHour) * 10;
    }
    return scoreB - scoreA;
  });
}

function searchSummary(results: SearchVenue[]): { count: number; avgPrice: number; avgRating: number } {
  if (results.length === 0) return { count: 0, avgPrice: 0, avgRating: 0 };
  return {
    count: results.length,
    avgPrice: Math.round(results.reduce((s, v) => s + v.pricePerHour, 0) / results.length),
    avgRating: Math.round(results.reduce((s, v) => s + v.rating, 0) / results.length * 10) / 10,
  };
}

const VENUES: SearchVenue[] = [
  { id: "v1", name: "Grand Hall",   city: "London", capacity: 300, rating: 4.8, pricePerHour: 200, amenities: ["wifi", "av", "parking"], eventTypes: ["conference", "wedding"] },
  { id: "v2", name: "Small Studio", city: "London", capacity: 20,  rating: 4.2, pricePerHour: 50,  amenities: ["wifi"],                  eventTypes: ["workshop"] },
  { id: "v3", name: "City Arena",   city: "Manchester", capacity: 1000, rating: 4.5, pricePerHour: 500, amenities: ["av", "stage"],       eventTypes: ["concert"] },
];

describe("Smart search and filtering", () => {
  it("matchesFilters: city filter works", () => {
    expect(matchesFilters(VENUES[0], { city: "London" })).toBe(true);
    expect(matchesFilters(VENUES[2], { city: "London" })).toBe(false);
  });

  it("searchVenues: capacity 50+ in London = Grand Hall only", () => {
    const results = searchVenues(VENUES, { city: "London", minCapacity: 50 });
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("v1");
  });

  it("searchVenues: amenity filter", () => {
    const results = searchVenues(VENUES, { amenities: ["av", "stage"] });
    expect(results.map((v) => v.id)).toContain("v3");
  });

  it("rankByRelevance: higher rated first", () => {
    const ranked = rankByRelevance(VENUES, {});
    expect(ranked[0].id).toBe("v1");
  });

  it("searchSummary: correct count and avg", () => {
    const summary = searchSummary([VENUES[0], VENUES[1]]);
    expect(summary.count).toBe(2);
    expect(summary.avgPrice).toBe(125);
  });
});
