import {
  SORT_OPTIONS,
  sortVenuesByCapacity,
} from "@/components/venues/VenueSearchDrawer";

describe("sortVenuesByCapacity helper & SORT_OPTIONS (#4591)", () => {
  it("exports SORT_OPTIONS containing capacity sort options", () => {
    expect(SORT_OPTIONS).toEqual([
      { id: "default", label: "Default" },
      { id: "capacity_asc", label: "Capacity: Low to High" },
      { id: "capacity_desc", label: "Capacity: High to Low" },
    ]);
  });

  const mockVenues = [
    { id: "v1", name: "Medium Space", capacity: 20 },
    { id: "v2", name: "Large Hub", totalDesks: 50 },
    { id: "v3", name: "Cozy Nook", capacity: 5 },
    { id: "v4", name: "Unknown Cap" },
  ];

  it("sorts venues in ascending order of capacity (Low to High)", () => {
    const sorted = sortVenuesByCapacity(mockVenues, "capacity_asc");

    expect(sorted.map((v) => v.id)).toEqual(["v4", "v3", "v1", "v2"]);
  });

  it("sorts venues in descending order of capacity (High to Low)", () => {
    const sorted = sortVenuesByCapacity(mockVenues, "capacity_desc");

    expect(sorted.map((v) => v.id)).toEqual(["v2", "v1", "v3", "v4"]);
  });

  it("returns original order if sortBy is default or invalid", () => {
    const sortedDefault = sortVenuesByCapacity(mockVenues, "default");
    expect(sortedDefault.map((v) => v.id)).toEqual(["v1", "v2", "v3", "v4"]);

    const sortedInvalid = sortVenuesByCapacity(mockVenues, "other");
    expect(sortedInvalid.map((v) => v.id)).toEqual(["v1", "v2", "v3", "v4"]);
  });

  it("does not mutate the original array", () => {
    const copy = [...mockVenues];
    sortVenuesByCapacity(mockVenues, "capacity_desc");
    expect(mockVenues).toEqual(copy);
  });
});
