// Self-contained tests for tag-based venue filtering logic

interface Venue {
  id: string;
  name: string;
  tags: string[];
}

function filterByTag(venues: Venue[], tag: string | null): Venue[] {
  if (tag === null) return venues;
  const normalizedTag = tag.toLowerCase();
  return venues.filter((v) =>
    v.tags.some((t) => t.toLowerCase() === normalizedTag)
  );
}

function filterByTags(venues: Venue[], tags: string[]): Venue[] {
  if (tags.length === 0) return venues;
  const normalized = tags.map((t) => t.toLowerCase());
  return venues.filter((v) =>
    v.tags.some((t) => normalized.includes(t.toLowerCase()))
  );
}

const sampleVenues: Venue[] = [
  { id: "1", name: "The Quiet Corner", tags: ["quiet", "wifi", "coffee"] },
  { id: "2", name: "Noise & Co", tags: ["loud", "bar", "music"] },
  { id: "3", name: "Focus Hub", tags: ["quiet", "desk", "24h"] },
  { id: "4", name: "Rooftop Lounge", tags: ["outdoor", "bar", "wifi"] },
  { id: "5", name: "Empty Venue", tags: [] },
];

describe("venueTagFilter - filterByTag", () => {
  it("returns only venues matching the given tag", () => {
    const result = filterByTag(sampleVenues, "quiet");
    expect(result).toHaveLength(2);
    expect(result.map((v) => v.id)).toEqual(expect.arrayContaining(["1", "3"]));
  });

  it("returns all venues when tag is null", () => {
    const result = filterByTag(sampleVenues, null);
    expect(result).toHaveLength(sampleVenues.length);
  });

  it("is case-insensitive (matches 'WiFi' against 'wifi')", () => {
    const result = filterByTag(sampleVenues, "WiFi");
    expect(result).toHaveLength(2);
    expect(result.map((v) => v.id)).toEqual(expect.arrayContaining(["1", "4"]));
  });

  it("returns empty array when no venues match the tag", () => {
    const result = filterByTag(sampleVenues, "rooftop-terrace");
    expect(result).toHaveLength(0);
  });

  it("returns correct match for a unique tag", () => {
    const result = filterByTag(sampleVenues, "24h");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("3");
  });

  it("does not match partial tags", () => {
    // 'qui' should not match 'quiet'
    const result = filterByTag(sampleVenues, "qui");
    expect(result).toHaveLength(0);
  });

  it("returns empty for a venue with no tags", () => {
    const noTagVenues: Venue[] = [{ id: "5", name: "Empty", tags: [] }];
    expect(filterByTag(noTagVenues, "quiet")).toHaveLength(0);
  });
});

describe("venueTagFilter - filterByTags (OR logic)", () => {
  it("returns venues matching any of the provided tags (OR)", () => {
    const result = filterByTags(sampleVenues, ["quiet", "bar"]);
    // quiet: [1,3], bar: [2,4] => union [1,2,3,4]
    expect(result).toHaveLength(4);
    expect(result.map((v) => v.id)).toEqual(
      expect.arrayContaining(["1", "2", "3", "4"])
    );
  });

  it("returns all venues when tags array is empty", () => {
    expect(filterByTags(sampleVenues, [])).toHaveLength(sampleVenues.length);
  });

  it("handles multiple tags with no matches", () => {
    const result = filterByTags(sampleVenues, ["nonexistent1", "nonexistent2"]);
    expect(result).toHaveLength(0);
  });

  it("is case-insensitive for multiple tags", () => {
    const result = filterByTags(sampleVenues, ["QUIET", "BAR"]);
    expect(result).toHaveLength(4);
  });
});
