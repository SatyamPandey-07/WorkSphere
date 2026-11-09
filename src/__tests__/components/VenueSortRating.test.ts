import {
  SORT_OPTIONS,
  sortVenuesByRating,
} from "@/components/venue/VenueFilter";

describe("sortVenuesByRating helper & SORT_OPTIONS (#4819)", () => {
  it("exports SORT_OPTIONS containing rating sort options", () => {
    expect(SORT_OPTIONS).toEqual([
      { id: "default", label: "Default" },
      { id: "rating_desc", label: "Rating: High to Low" },
      { id: "rating_asc", label: "Rating: Low to High" },
    ]);
  });

  const mockVenues = [
    { id: "v1", name: "Solid Cafe", averageRating: 4.2 },
    { id: "v2", name: "Top Hub", averageRating: 4.9 },
    { id: "v3", name: "Average Space", rating: 3.5 },
    { id: "v4", name: "Brand New Spot" }, // no rating
    { id: "v5", name: "Zero Star Spot", averageRating: 0 },
  ];

  it("sorts venues in descending order of rating (High to Low / Highest Rated first)", () => {
    const sorted = sortVenuesByRating(mockVenues, "rating_desc");

    expect(sorted.map((v) => v.id)).toEqual(["v2", "v1", "v3", "v4", "v5"]);
    expect(sorted[0].name).toBe("Top Hub");
  });

  it("sorts venues in ascending order of rating (Low to High / Lowest Rated first)", () => {
    const sorted = sortVenuesByRating(mockVenues, "rating_asc");

    expect(sorted.map((v) => v.id)).toEqual(["v4", "v5", "v3", "v1", "v2"]);
    expect(sorted[sorted.length - 1].name).toBe("Top Hub");
  });

  it("prefers averageRating over rating when both are present", () => {
    const venues = [
      { id: "v1", name: "Venue A", averageRating: 4.8, rating: 2.0 },
      { id: "v2", name: "Venue B", averageRating: 3.0, rating: 5.0 },
    ];
    const sorted = sortVenuesByRating(venues, "rating_desc");
    expect(sorted.map((v) => v.id)).toEqual(["v1", "v2"]);
  });

  it("returns original order if sortBy is default or invalid", () => {
    const sortedDefault = sortVenuesByRating(mockVenues, "default");
    expect(sortedDefault.map((v) => v.id)).toEqual(["v1", "v2", "v3", "v4", "v5"]);

    const sortedInvalid = sortVenuesByRating(mockVenues, "unknown_sort");
    expect(sortedInvalid.map((v) => v.id)).toEqual(["v1", "v2", "v3", "v4", "v5"]);
  });

  it("does not mutate the original array", () => {
    const copy = [...mockVenues];
    sortVenuesByRating(mockVenues, "rating_desc");
    expect(mockVenues).toEqual(copy);
  });
});
