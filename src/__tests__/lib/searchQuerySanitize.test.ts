/**
 * Tests for venue search query sanitization.
 */

function sanitizeQuery(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")        // collapse whitespace
    .replace(/[<>"'`]/g, "")     // strip HTML-dangerous chars
    .slice(0, 100);              // max length
}

function tokenize(query: string): string[] {
  return sanitizeQuery(query)
    .toLowerCase()
    .split(" ")
    .filter((t) => t.length > 0);
}

function isEmptyQuery(query: string): boolean {
  return sanitizeQuery(query).length === 0;
}

describe("Search query sanitization", () => {
  it("trims leading/trailing whitespace", () => {
    expect(sanitizeQuery("  coffee  ")).toBe("coffee");
  });

  it("collapses internal whitespace", () => {
    expect(sanitizeQuery("quiet  café   downtown")).toBe("quiet café downtown");
  });

  it("strips HTML angle brackets", () => {
    expect(sanitizeQuery("<script>alert(1)</script>")).toBe("scriptalert(1)/script");
  });

  it("strips quotes", () => {
    expect(sanitizeQuery("\"cowork\" 'space'")).toBe("cowork space");
  });

  it("truncates to 100 chars", () => {
    const long = "a".repeat(150);
    expect(sanitizeQuery(long)).toHaveLength(100);
  });

  it("tokenize lowercases", () => {
    expect(tokenize("Quiet CAFÉ")).toEqual(["quiet", "café"]);
  });

  it("tokenize splits on spaces", () => {
    expect(tokenize("fast wifi downtown")).toHaveLength(3);
  });

  it("tokenize filters empty tokens", () => {
    expect(tokenize("  hello  ")).toEqual(["hello"]);
  });

  it("empty string → isEmptyQuery true", () => {
    expect(isEmptyQuery("")).toBe(true);
  });

  it("whitespace-only → isEmptyQuery true", () => {
    expect(isEmptyQuery("   ")).toBe(true);
  });

  it("non-empty → isEmptyQuery false", () => {
    expect(isEmptyQuery("workspace")).toBe(false);
  });
});
