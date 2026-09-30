/**
 * Tests for search result text highlighting.
 */

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\]/g, "\$&");
}

function highlightMatches(
  text: string,
  query: string,
  openTag = "<mark>",
  closeTag = "</mark>"
): string {
  if (!query.trim()) return text;
  const pattern = new RegExp(`(${escapeRegex(query.trim())})`, "gi");
  return text.replace(pattern, `${openTag}$1${closeTag}`);
}

function countMatches(text: string, query: string): number {
  if (!query.trim()) return 0;
  const pattern = new RegExp(escapeRegex(query.trim()), "gi");
  return (text.match(pattern) ?? []).length;
}

function stripHighlights(
  html: string,
  openTag = "<mark>",
  closeTag = "</mark>"
): string {
  return html.replace(new RegExp(escapeRegex(openTag) + "|" + escapeRegex(closeTag), "g"), "");
}

describe("Search result highlighting", () => {
  it("wraps matching text in mark tags", () => {
    expect(highlightMatches("Coworking Space", "space")).toContain("<mark>Space</mark>");
  });

  it("case-insensitive match", () => {
    expect(highlightMatches("CAFÉ hub", "café")).toContain("<mark>CAFÉ</mark>");
  });

  it("no match → original text unchanged", () => {
    expect(highlightMatches("Hello World", "xyz")).toBe("Hello World");
  });

  it("empty query → original text", () => {
    expect(highlightMatches("Hello World", "")).toBe("Hello World");
  });

  it("whitespace-only query → original text", () => {
    expect(highlightMatches("Hello World", "   ")).toBe("Hello World");
  });

  it("countMatches: 2 occurrences", () => {
    expect(countMatches("hub hub cafe", "hub")).toBe(2);
  });

  it("countMatches: no match → 0", () => {
    expect(countMatches("cafe", "hub")).toBe(0);
  });

  it("countMatches: empty query → 0", () => {
    expect(countMatches("hello", "")).toBe(0);
  });

  it("stripHighlights removes mark tags", () => {
    const highlighted = highlightMatches("Coworking Space", "space");
    expect(stripHighlights(highlighted)).toBe("Coworking Space");
  });

  it("regex special chars in query don't break", () => {
    expect(() => highlightMatches("price (USD)", "(USD)")).not.toThrow();
  });
});
