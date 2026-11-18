import {
  MAX_RECENT_SEARCHES,
  MAX_RECENT_SEARCH_LENGTH,
  RECENT_SEARCHES_STORAGE_KEY,
  addRecentSearch,
  clearRecentSearches,
  getRecentSearches,
  normalizeRecentSearch,
  removeRecentSearch,
} from "@/lib/recentSearches";

describe("recent searches storage (#7731)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    jest.restoreAllMocks();
  });

  describe("normalizeRecentSearch", () => {
    it("trims and collapses whitespace", () => {
      expect(normalizeRecentSearch("  quiet   library \n in  Shoreditch ")).toBe(
        "quiet library in Shoreditch",
      );
    });

    it("rejects empty, non-string and overlong input", () => {
      expect(normalizeRecentSearch("   ")).toBe("");
      expect(normalizeRecentSearch(42)).toBe("");
      expect(normalizeRecentSearch(null)).toBe("");
      expect(normalizeRecentSearch("a".repeat(MAX_RECENT_SEARCH_LENGTH + 1))).toBe("");
      expect(normalizeRecentSearch("a".repeat(MAX_RECENT_SEARCH_LENGTH))).not.toBe("");
    });
  });

  describe("storing and loading", () => {
    it("starts empty", () => {
      expect(getRecentSearches()).toEqual([]);
    });

    it("saves most recent first and loads them back", () => {
      addRecentSearch("coffee with outdoor seating");
      addRecentSearch("quiet library in Shoreditch");

      expect(getRecentSearches()).toEqual([
        "quiet library in Shoreditch",
        "coffee with outdoor seating",
      ]);
      expect(JSON.parse(window.localStorage.getItem(RECENT_SEARCHES_STORAGE_KEY)!)).toEqual([
        "quiet library in Shoreditch",
        "coffee with outdoor seating",
      ]);
    });

    it("ignores blank queries", () => {
      addRecentSearch("   ");
      addRecentSearch("");
      expect(getRecentSearches()).toEqual([]);
      expect(window.localStorage.getItem(RECENT_SEARCHES_STORAGE_KEY)).toBeNull();
    });
  });

  describe("LRU behaviour", () => {
    it("moves a repeated query to the front without duplicating it", () => {
      addRecentSearch("cafe");
      addRecentSearch("library");
      addRecentSearch("cafe");
      expect(getRecentSearches()).toEqual(["cafe", "library"]);
    });

    it("treats queries that differ only by case or spacing as the same", () => {
      addRecentSearch("Quiet Cafe");
      addRecentSearch("  quiet   cafe ");
      expect(getRecentSearches()).toEqual(["quiet cafe"]);
    });

    it("evicts the oldest query once there are more than 10", () => {
      for (let i = 1; i <= MAX_RECENT_SEARCHES + 2; i++) addRecentSearch(`query ${i}`);

      const list = getRecentSearches();
      expect(MAX_RECENT_SEARCHES).toBe(10);
      expect(list).toHaveLength(10);
      expect(list[0]).toBe("query 12");
      expect(list[9]).toBe("query 3");
      expect(list).not.toContain("query 1");
      expect(list).not.toContain("query 2");
    });

    it("keeps a re-used old query alive when the list is full", () => {
      for (let i = 1; i <= 10; i++) addRecentSearch(`query ${i}`);
      addRecentSearch("query 1");
      addRecentSearch("query 11");

      const list = getRecentSearches();
      expect(list).toHaveLength(10);
      expect(list).toContain("query 1");
      expect(list).not.toContain("query 2");
    });
  });

  describe("removing", () => {
    it("removes one query and keeps the rest in order", () => {
      addRecentSearch("a1");
      addRecentSearch("b2");
      addRecentSearch("c3");

      expect(removeRecentSearch("B2")).toEqual(["c3", "a1"]);
      expect(getRecentSearches()).toEqual(["c3", "a1"]);
    });

    it("does nothing for an unknown query", () => {
      addRecentSearch("a1");
      expect(removeRecentSearch("nope")).toEqual(["a1"]);
    });

    it("clears everything and removes the storage key", () => {
      addRecentSearch("a1");
      addRecentSearch("b2");

      expect(clearRecentSearches()).toEqual([]);
      expect(getRecentSearches()).toEqual([]);
      expect(window.localStorage.getItem(RECENT_SEARCHES_STORAGE_KEY)).toBeNull();
    });
  });

  describe("bad storage", () => {
    it("ignores corrupt JSON", () => {
      window.localStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, "{not json");
      expect(getRecentSearches()).toEqual([]);
    });

    it("ignores data that is not an array", () => {
      window.localStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify({ a: 1 }));
      expect(getRecentSearches()).toEqual([]);
    });

    it("drops non-string, blank and duplicate entries and caps the list at 10", () => {
      const many = Array.from({ length: 15 }, (_, i) => `q${i}`);
      window.localStorage.setItem(
        RECENT_SEARCHES_STORAGE_KEY,
        JSON.stringify([1, null, "  ", "Cafe", "cafe", ...many]),
      );

      const list = getRecentSearches();
      expect(list).toHaveLength(10);
      expect(list.slice(0, 3)).toEqual(["Cafe", "q0", "q1"]);
    });

    it("does not throw when storage writes fail", () => {
      jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("quota");
      });
      expect(() => addRecentSearch("cafe")).not.toThrow();
      expect(addRecentSearch("cafe")).toEqual(["cafe"]);
    });

    it("does not throw when storage reads fail", () => {
      jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      expect(getRecentSearches()).toEqual([]);
    });
  });
});
