import {
  DEFAULT_SEMANTIC_CONFIDENCE_THRESHOLD,
  LOW_CONFIDENCE_FUZZY_LIMIT,
  interleaveFuzzyAndSemantic,
  labelFuzzySuggestions,
  searchVenuesWithRrf,
  type RankedVenueList,
} from "@/lib/search/hybridVenueSearch";
import { clearMemorySWRCache } from "@/lib/cache/swrCache";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn().mockResolvedValue(1),
    venue: { findMany: jest.fn().mockResolvedValue([]) },
  },
}));

const queryRaw = prisma.$queryRaw as jest.Mock;
const EMBEDDING = [3, 4];

/** Rows as the main ranking query returns them. */
function semanticRows(
  ids: string[],
  topSimilarity: number | null,
  hasTextMatch = false,
) {
  return ids.map((id, index) => ({
    id,
    score: 0.01 - index * 0.001,
    needs_embedding: false,
    top_vector_similarity: topSimilarity,
    has_text_match: hasTextMatch,
  }));
}

function fuzzyRows(names: Record<string, string>) {
  return Object.entries(names).map(([id, name], index) => ({
    id,
    name,
    similarity: 0.6 - index * 0.1,
    score: 0.6 - index * 0.1,
    needs_embedding: false,
  }));
}

describe("interleaveFuzzyAndSemantic", () => {
  const fuzzy = (id: string) => ({ id, score: 1, fuzzyMatched: true });
  const semantic = (id: string) => ({ id, score: 1 });
  const ids = (venues: Array<{ id: string }>) => venues.map(({ id }) => id);

  it("alternates the two lists, starting with a fuzzy match", () => {
    const merged = interleaveFuzzyAndSemantic(
      [fuzzy("f1"), fuzzy("f2")],
      [semantic("s1"), semantic("s2")],
    );
    expect(ids(merged)).toEqual(["f1", "s1", "f2", "s2"]);
  });

  it("appends the rest of the longer list", () => {
    expect(
      ids(
        interleaveFuzzyAndSemantic(
          [fuzzy("f1")],
          [semantic("s1"), semantic("s2"), semantic("s3")],
        ),
      ),
    ).toEqual(["f1", "s1", "s2", "s3"]);
    expect(
      ids(
        interleaveFuzzyAndSemantic(
          [fuzzy("f1"), fuzzy("f2"), fuzzy("f3")],
          [semantic("s1")],
        ),
      ),
    ).toEqual(["f1", "s1", "f2", "f3"]);
  });

  it("keeps one entry per venue and prefers the fuzzy entry", () => {
    const merged = interleaveFuzzyAndSemantic(
      [fuzzy("shared"), fuzzy("f2")],
      [semantic("s1"), semantic("shared"), semantic("s2")],
    );
    expect(ids(merged)).toEqual(["shared", "s1", "f2", "s2"]);
    expect(merged[0].fuzzyMatched).toBe(true);
  });

  it("handles empty lists", () => {
    expect(interleaveFuzzyAndSemantic([], [])).toEqual([]);
    expect(ids(interleaveFuzzyAndSemantic([], [semantic("s1")]))).toEqual([
      "s1",
    ]);
  });
});

describe("searchVenuesWithRrf low-confidence fuzzy fallback (#7846)", () => {
  beforeEach(() => {
    queryRaw.mockReset();
    clearMemorySWRCache();
  });

  it("uses 0.65 as the default confidence threshold", () => {
    expect(DEFAULT_SEMANTIC_CONFIDENCE_THRESHOLD).toBe(0.65);
  });

  it("mixes trigram matches into semantic results below the threshold", async () => {
    queryRaw
      .mockResolvedValueOnce(semanticRows(["s1", "s2"], 0.41))
      .mockResolvedValueOnce(fuzzyRows({ f1: "Blue Tokai Coffee" }));

    const results = await searchVenuesWithRrf("blue tokia cofee", {
      queryEmbedding: EMBEDDING,
    });

    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(results.map(({ id }) => id)).toEqual(["f1", "s1", "s2"]);
    expect(results.lowConfidenceFallback).toBe(true);
    expect(results.fuzzyMatched).toBe(true);
    expect(results.suggestedQuery).toBeUndefined();
    expect(results[0]).toMatchObject({
      id: "f1",
      fuzzyMatched: true,
      matchedName: "Blue Tokai Coffee",
      similarity: 0.6,
    });
    expect(results[1].fuzzyMatched).toBeUndefined();
  });

  it("searches name, address and amenities, capped at the fuzzy limit", async () => {
    queryRaw
      .mockResolvedValueOnce(semanticRows(["s1"], 0.2))
      .mockResolvedValueOnce([]);

    await searchVenuesWithRrf("blue tokia cofee", {
      queryEmbedding: EMBEDDING,
      minSimilarity: 0.4,
    });

    const fallbackQuery = queryRaw.mock.calls[1][0];
    const sql = fallbackQuery.strings.join("?");
    expect(sql).toContain('SIMILARITY(v."name"');
    expect(sql).toContain('COALESCE(v."address"');
    expect(sql).toContain('v."foodTags"');
    expect(sql).toContain('v."powerTypes"');
    expect(fallbackQuery.values).toContain("blue tokia cofee");
    expect(fallbackQuery.values).toContain(0.4);
    expect(fallbackQuery.values).toContain(LOW_CONFIDENCE_FUZZY_LIMIT);
  });

  it("passes venue filters on to the fallback query", async () => {
    queryRaw
      .mockResolvedValueOnce(semanticRows(["s1"], 0.2))
      .mockResolvedValueOnce([]);

    await searchVenuesWithRrf("blue tokia cofee", {
      queryEmbedding: EMBEDDING,
      category: "library",
    });

    const fallbackQuery = queryRaw.mock.calls[1][0];
    expect(fallbackQuery.strings.join("?")).toContain('v."category" =');
    expect(fallbackQuery.values).toContain("library");
  });

  it("does not expose the confidence columns on returned venues", async () => {
    queryRaw.mockResolvedValueOnce(semanticRows(["s1"], 0.9));

    const results = await searchVenuesWithRrf("coffee", {
      queryEmbedding: EMBEDDING,
    });

    expect(results[0]).toEqual({
      id: "s1",
      score: 0.01,
      needs_embedding: false,
    });
  });

  it.each([
    ["the best similarity meets the threshold", semanticRows(["s1"], 0.65)],
    ["the best similarity is high", semanticRows(["s1"], 0.92)],
    ["a text match exists", semanticRows(["s1"], 0.1, true)],
    ["no similarity was reported", semanticRows(["s1"], null)],
  ])("skips the fallback when %s", async (_case, rows) => {
    queryRaw.mockResolvedValueOnce(rows);

    const results = await searchVenuesWithRrf("coffee shop", {
      queryEmbedding: EMBEDDING,
    });

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(results.lowConfidenceFallback).toBeUndefined();
    expect(results.fuzzyMatched).toBe(false);
  });

  it("skips the fallback when it is disabled or the query is too short", async () => {
    queryRaw.mockResolvedValue(semanticRows(["s1"], 0.1));

    await searchVenuesWithRrf("coffee shop", {
      queryEmbedding: EMBEDDING,
      enableFuzzyFallback: false,
    });
    await searchVenuesWithRrf("ab", { queryEmbedding: EMBEDDING });

    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it("honours a custom confidence threshold", async () => {
    queryRaw
      .mockResolvedValueOnce(semanticRows(["s1"], 0.5))
      .mockResolvedValueOnce(semanticRows(["s1"], 0.5))
      .mockResolvedValueOnce(fuzzyRows({ f1: "Blue Tokai Coffee" }));

    const strict = await searchVenuesWithRrf("coffee shop", {
      queryEmbedding: EMBEDDING,
      semanticConfidenceThreshold: 0.4,
    });
    const loose = await searchVenuesWithRrf("coffee shop", {
      queryEmbedding: EMBEDDING,
      semanticConfidenceThreshold: 0.8,
    });

    expect(strict.lowConfidenceFallback).toBeUndefined();
    expect(loose.lowConfidenceFallback).toBe(true);
  });

  it("keeps the semantic results when no trigram match is found", async () => {
    queryRaw
      .mockResolvedValueOnce(semanticRows(["s1", "s2"], 0.3))
      .mockResolvedValueOnce([]);

    const results = await searchVenuesWithRrf("qqqq zzzz", {
      queryEmbedding: EMBEDDING,
    });

    expect(results.map(({ id }) => id)).toEqual(["s1", "s2"]);
    expect(results.lowConfidenceFallback).toBeUndefined();
    expect(results.fuzzyMatched).toBe(false);
  });

  it("keeps the semantic results when the fallback query fails", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    queryRaw
      .mockResolvedValueOnce(semanticRows(["s1"], 0.3))
      .mockRejectedValueOnce(new Error("pg_trgm is not installed"));

    const results = await searchVenuesWithRrf("blue tokia", {
      queryEmbedding: EMBEDDING,
    });

    expect(results.map(({ id }) => id)).toEqual(["s1"]);
    expect(results.lowConfidenceFallback).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("labelFuzzySuggestions", () => {
  const venues = [
    { id: "f1", name: "Blue Tokai" },
    { id: "s1", name: "Third Wave" },
  ];
  const ranked = (lowConfidenceFallback: boolean): RankedVenueList =>
    Object.assign(
      [
        { id: "f1", score: 1, fuzzyMatched: true },
        { id: "s1", score: 1 },
      ],
      { lowConfidenceFallback },
    );

  it("marks only the trigram matches of a low-confidence search", () => {
    expect(labelFuzzySuggestions(venues, ranked(true))).toEqual([
      { id: "f1", name: "Blue Tokai", fuzzyMatched: true },
      { id: "s1", name: "Third Wave" },
    ]);
  });

  it("returns other result sets unchanged", () => {
    expect(labelFuzzySuggestions(venues, ranked(false))).toBe(venues);
  });
});
