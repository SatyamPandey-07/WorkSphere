/**
 * Tests for saved venue bookmark sorting.
 */

interface BookmarkedVenue {
  id: string;
  name: string;
  savedAt: number;
  rating?: number;
}

function sortByRecentlySaved(venues: BookmarkedVenue[]): BookmarkedVenue[] {
  return [...venues].sort((a, b) => b.savedAt - a.savedAt);
}

function sortByName(venues: BookmarkedVenue[]): BookmarkedVenue[] {
  return [...venues].sort((a, b) => a.name.localeCompare(b.name));
}

function sortByRating(venues: BookmarkedVenue[]): BookmarkedVenue[] {
  return [...venues].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
}

const BOOKMARKS: BookmarkedVenue[] = [
  { id: "v1", name: "Zara Café",     savedAt: 1000, rating: 4.5 },
  { id: "v2", name: "Alpha Library", savedAt: 3000, rating: 3.0 },
  { id: "v3", name: "Midtown Hub",   savedAt: 2000, rating: 5.0 },
];

describe("Bookmarked venue sorting", () => {
  it("sortByRecentlySaved: most recent first", () => {
    const sorted = sortByRecentlySaved(BOOKMARKS);
    expect(sorted[0].id).toBe("v2"); // savedAt=3000
    expect(sorted[2].id).toBe("v1"); // savedAt=1000
  });

  it("sortByName: alphabetical", () => {
    const sorted = sortByName(BOOKMARKS);
    expect(sorted[0].name).toBe("Alpha Library");
    expect(sorted[2].name).toBe("Zara Café");
  });

  it("sortByRating: highest first", () => {
    const sorted = sortByRating(BOOKMARKS);
    expect(sorted[0].id).toBe("v3"); // rating=5.0
    expect(sorted[2].id).toBe("v2"); // rating=3.0
  });

  it("no mutations to original", () => {
    const original = [...BOOKMARKS];
    sortByRecentlySaved(BOOKMARKS);
    expect(BOOKMARKS).toEqual(original);
  });

  it("empty array produces empty result", () => {
    expect(sortByRecentlySaved([])).toHaveLength(0);
  });

  it("undefined rating treated as 0 in rating sort", () => {
    const noRating = [{ id: "x", name: "X", savedAt: 0 }];
    const withRating = [{ id: "y", name: "Y", savedAt: 0, rating: 1 }];
    const sorted = sortByRating([...noRating, ...withRating]);
    expect(sorted[0].id).toBe("y");
  });
});
