import {
  MAX_SEARCH_QUERY_LENGTH,
  sanitizeSearchQuery,
  splitSearchList,
} from "@/lib/searchSanitizer";

describe("sanitizeSearchQuery", () => {
  it("leaves an ordinary query untouched", () => {
    expect(sanitizeSearchQuery("quiet cafe with fast wifi")).toBe(
      "quiet cafe with fast wifi",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeSearchQuery("   Koramangala   ")).toBe("Koramangala");
  });

  it("strips NUL and ESC control characters", () => {
    const raw = "Beng\0aluru\x1b";
    expect(sanitizeSearchQuery(raw)).toBe("Bengaluru");
  });

  it("strips embedded tab and newline bytes", () => {
    expect(sanitizeSearchQuery("Indiranagar\t\n")).toBe("Indiranagar");
  });

  it("removes control characters instead of leaving a gap", () => {
    // Stripping (not replacing) keeps the two halves joined, which is what the
    // Prisma `contains` filter expects for a name that was corrupted in transit.
    expect(sanitizeSearchQuery("White\x00field")).toBe("Whitefield");
  });

  it("truncates a value longer than the maximum", () => {
    const long = "a".repeat(MAX_SEARCH_QUERY_LENGTH + 40);
    const result = sanitizeSearchQuery(long);
    expect(result).toHaveLength(MAX_SEARCH_QUERY_LENGTH);
  });

  it("truncates after trimming so padding does not eat into the limit", () => {
    const padded = `   ${"b".repeat(MAX_SEARCH_QUERY_LENGTH)}   `;
    expect(sanitizeSearchQuery(padded)).toHaveLength(MAX_SEARCH_QUERY_LENGTH);
  });

  it("returns an empty string when only control characters are supplied", () => {
    expect(sanitizeSearchQuery("\0\x1b\x7f")).toBe("");
  });

  it("is idempotent", () => {
    const once = sanitizeSearchQuery("  Jayanagar\0  ");
    expect(sanitizeSearchQuery(once)).toBe(once);
  });
});

describe("splitSearchList", () => {
  it("splits a comma separated list and trims each entry", () => {
    expect(splitSearchList("Mumbai, Delhi ,Pune")).toEqual([
      "Mumbai",
      "Delhi",
      "Pune",
    ]);
  });

  it("drops empty entries left by trailing separators", () => {
    expect(splitSearchList("Mumbai,,Delhi,")).toEqual(["Mumbai", "Delhi"]);
  });

  it("strips control characters before splitting", () => {
    expect(splitSearchList("Mum\0bai,\x1bDelhi")).toEqual(["Mumbai", "Delhi"]);
  });

  it("applies the query length cap before splitting", () => {
    const long = `Mumbai,${"x".repeat(MAX_SEARCH_QUERY_LENGTH + 20)}`;
    const result = splitSearchList(long);
    expect(result[0]).toBe("Mumbai");
    expect(result.join(",").length).toBeLessThanOrEqual(MAX_SEARCH_QUERY_LENGTH);
  });

  it("returns an empty array for an empty value", () => {
    expect(splitSearchList("   ")).toEqual([]);
  });
});
