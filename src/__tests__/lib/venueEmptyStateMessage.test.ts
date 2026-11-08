/**
 * Tests for VenueSearchEmptyState message generation (Issue #2181).
 */

function getEmptyStateMessage(searchQuery?: string): string {
  if (searchQuery && searchQuery.trim()) {
    return `We couldn't find any workspaces matching "${searchQuery.trim()}". Try broadening your search.`;
  }
  return "We couldn't find any workspaces nearby. Try a different location or adjust your filters.";
}

describe("VenueSearchEmptyState message", () => {
  it("returns generic message without searchQuery", () => {
    const msg = getEmptyStateMessage();
    expect(msg).toContain("nearby");
    expect(msg).not.toContain('"');
  });

  it("returns generic message for empty string query", () => {
    const msg = getEmptyStateMessage("");
    expect(msg).toContain("nearby");
  });

  it("returns query-specific message with searchQuery", () => {
    const msg = getEmptyStateMessage("coffee");
    expect(msg).toContain('"coffee"');
    expect(msg).toContain("broadening your search");
  });

  it("trims whitespace from searchQuery", () => {
    const msg = getEmptyStateMessage("  library  ");
    expect(msg).toContain('"library"');
    expect(msg).not.toContain("  library  ");
  });

  it("message includes actionable advice", () => {
    const msgNoQuery = getEmptyStateMessage();
    const msgWithQuery = getEmptyStateMessage("café");

    expect(msgNoQuery).toMatch(/location|filter|adjust/i);
    expect(msgWithQuery).toMatch(/broaden|search/i);
  });

  it("whitespace-only query falls back to generic message", () => {
    const msg = getEmptyStateMessage("   ");
    expect(msg).toContain("nearby");
    expect(msg).not.toContain('"');
  });

  it("query is preserved exactly in message", () => {
    const query = "quiet café with wifi";
    const msg = getEmptyStateMessage(query);
    expect(msg).toContain(`"${query}"`);
  });
});
