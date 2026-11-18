import { formatVenueResultsAnnouncement } from "@/lib/venueResultsAnnouncement";

describe("formatVenueResultsAnnouncement (#7609)", () => {
  it.each([
    [0, 0, "No matching workspaces found"],
    [1, 0, "Found 1 matching workspace"],
    [12, 0, "Found 12 matching workspaces"],
    [12, 1, "Found 12 matching workspaces with 1 filter applied"],
    [1, 3, "Found 1 matching workspace with 3 filters applied"],
    [0, 2, "No matching workspaces found with 2 filters applied"],
  ])("count=%i filters=%i -> %s", (count, filters, expected) => {
    expect(formatVenueResultsAnnouncement(count, filters)).toBe(expected);
  });

  it("treats a missing or negative filter count as no filters", () => {
    expect(formatVenueResultsAnnouncement(4)).toBe(
      "Found 4 matching workspaces",
    );
    expect(formatVenueResultsAnnouncement(4, -1)).toBe(
      "Found 4 matching workspaces",
    );
  });
});
