import {
  MAX_SEARCH_LIST_ITEMS,
  MAX_SEARCH_QUERY_LENGTH,
  normalizeSearchQuery,
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

  it("applies the query length cap per entry without truncating the full list", () => {
    const long = `Mumbai,${"x".repeat(MAX_SEARCH_QUERY_LENGTH + 20)}`;
    const result = splitSearchList(long);
    expect(result[0]).toBe("Mumbai");
    expect(result[1]).toHaveLength(MAX_SEARCH_QUERY_LENGTH);
  });

  it("sanitizes long multi-item lists without mid-word truncation", () => {
    const list = [
      "San Francisco",
      "Los Angeles",
      "New York City",
      "Chicago",
      "Seattle",
      "Philadelphia",
      "Washington",
      "Boston",
    ];
    const raw = list.join(",");
    expect(splitSearchList(raw)).toEqual(list);
  });

  it("returns an empty array for an empty value", () => {
    expect(splitSearchList("   ")).toEqual([]);
  });

  describe("maximum items limit", () => {
    it("exports MAX_SEARCH_LIST_ITEMS as 25", () => {
      expect(MAX_SEARCH_LIST_ITEMS).toBe(25);
    });

    it("retains exactly 25 valid entries", () => {
      const items = Array.from({ length: 25 }, (_, i) => `City${i + 1}`);
      const raw = items.join(",");
      const result = splitSearchList(raw);
      expect(result).toHaveLength(25);
      expect(result).toEqual(items);
    });

    it("truncates 26 valid entries to exactly 25", () => {
      const items = Array.from({ length: 26 }, (_, i) => `City${i + 1}`);
      const raw = items.join(",");
      const result = splitSearchList(raw);
      expect(result).toHaveLength(25);
      expect(result).toEqual(items.slice(0, 25));
    });

    it("truncates 50 valid entries to exactly 25", () => {
      const items = Array.from({ length: 50 }, (_, i) => `City${i + 1}`);
      const raw = items.join(",");
      const result = splitSearchList(raw);
      expect(result).toHaveLength(25);
      expect(result).toEqual(items.slice(0, 25));
    });

    it("never produces more than 25 results for hundreds or thousands of comma-separated entries", () => {
      const items = Array.from({ length: 2000 }, (_, i) => `Loc${i + 1}`);
      const raw = items.join(",");
      const result = splitSearchList(raw);
      expect(result).toHaveLength(25);
      expect(result).toEqual(items.slice(0, 25));
    });

    it("preserves the first 25 valid entries in their original order", () => {
      const items = Array.from({ length: 30 }, (_, i) => `Item_${i}`);
      const result = splitSearchList(items.join(","));
      expect(result).toEqual(items.slice(0, 25));
    });
  });

  describe("normal inputs and backward compatibility", () => {
    it("handles one valid entry", () => {
      expect(splitSearchList("Bengaluru")).toEqual(["Bengaluru"]);
    });

    it("handles five valid entries", () => {
      expect(
        splitSearchList("Delhi, Mumbai, Kolkata, Chennai, Hyderabad"),
      ).toEqual(["Delhi", "Mumbai", "Kolkata", "Chennai", "Hyderabad"]);
    });

    it("handles ten valid entries", () => {
      const items = [
        "Tokyo",
        "Kyoto",
        "Osaka",
        "Nagoya",
        "Sapporo",
        "Fukuoka",
        "Kobe",
        "Yokohama",
        "Sendai",
        "Hiroshima",
      ];
      expect(splitSearchList(items.join(","))).toEqual(items);
    });

    it("preserves normal existing input unchanged", () => {
      expect(splitSearchList("Berlin, Paris, London")).toEqual([
        "Berlin",
        "Paris",
        "London",
      ]);
    });

    it("retains duplicate entries per existing behavior", () => {
      expect(splitSearchList("Delhi, Mumbai, Delhi, Mumbai")).toEqual([
        "Delhi",
        "Mumbai",
        "Delhi",
        "Mumbai",
      ]);
    });
  });

  describe("empty and whitespace entries", () => {
    it("handles empty input string", () => {
      expect(splitSearchList("")).toEqual([]);
    });

    it("handles comma-only input", () => {
      expect(splitSearchList(",,,,")).toEqual([]);
    });

    it("handles leading commas", () => {
      expect(splitSearchList(",,,Delhi,Mumbai")).toEqual(["Delhi", "Mumbai"]);
    });

    it("handles trailing commas", () => {
      expect(splitSearchList("Delhi,Mumbai,,,")).toEqual(["Delhi", "Mumbai"]);
    });

    it("handles multiple consecutive commas", () => {
      expect(splitSearchList("Delhi,,,,Mumbai,,,Pune")).toEqual([
        "Delhi",
        "Mumbai",
        "Pune",
      ]);
    });

    it("handles whitespace-only entries", () => {
      expect(splitSearchList("   ,  \t ,  \n  ")).toEqual([]);
    });

    it("handles empty entries mixed with valid entries", () => {
      expect(splitSearchList("  , Pune, , Goa,   , Delhi ")).toEqual([
        "Pune",
        "Goa",
        "Delhi",
      ]);
    });

    it("counts only non-empty sanitized entries when more than 25 raw entries exist with empty entries", () => {
      // Create 40 raw entries: 20 empty and 20 valid, then 10 more valid
      const rawParts: string[] = [];
      const expectedValid: string[] = [];
      for (let i = 1; i <= 25; i++) {
        rawParts.push("");
        rawParts.push(`Valid${i}`);
        expectedValid.push(`Valid${i}`);
      }
      // Add 5 more valid entries (making 30 total valid entries interspersed with blanks)
      for (let i = 26; i <= 30; i++) {
        rawParts.push(`Valid${i}`);
      }

      const result = splitSearchList(rawParts.join(","));
      expect(result).toHaveLength(25);
      expect(result).toEqual(expectedValid);
    });

    it("does not count control-character-only entries as valid entries towards the limit", () => {
      const rawParts = ["\0\x1b", "Valid1", "\x7f\t\n", "Valid2"];
      expect(splitSearchList(rawParts.join(","))).toEqual(["Valid1", "Valid2"]);
    });
  });

  describe("non-string inputs", () => {
    it("returns empty array for null", () => {
      expect(splitSearchList(null)).toEqual([]);
    });

    it("returns empty array for undefined", () => {
      expect(splitSearchList(undefined)).toEqual([]);
    });

    it("returns empty array for numbers", () => {
      expect(splitSearchList(12345)).toEqual([]);
      expect(splitSearchList(0)).toEqual([]);
    });

    it("returns empty array for booleans", () => {
      expect(splitSearchList(true)).toEqual([]);
      expect(splitSearchList(false)).toEqual([]);
    });

    it("returns empty array for arrays", () => {
      expect(splitSearchList(["Delhi", "Mumbai"])).toEqual([]);
    });

    it("returns empty array for plain objects", () => {
      expect(splitSearchList({ cities: "Delhi,Mumbai" })).toEqual([]);
    });
  });

  describe("individual query length", () => {
    it("handles an entry shorter than 100 characters", () => {
      const entry = "a".repeat(50);
      expect(splitSearchList(entry)).toEqual([entry]);
    });

    it("handles an entry exactly 100 characters", () => {
      const entry = "b".repeat(MAX_SEARCH_QUERY_LENGTH);
      const result = splitSearchList(entry);
      expect(result).toEqual([entry]);
      expect(result[0]).toHaveLength(100);
    });

    it("truncates an entry longer than 100 characters", () => {
      const longEntry = "c".repeat(150);
      const result = splitSearchList(longEntry);
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveLength(MAX_SEARCH_QUERY_LENGTH);
      expect(result[0]).toBe("c".repeat(100));
    });

    it("truncates each overlength entry in a list independently", () => {
      const raw = `${"x".repeat(120)},${"y".repeat(110)},${"z".repeat(90)}`;
      const result = splitSearchList(raw);
      expect(result).toEqual([
        "x".repeat(100),
        "y".repeat(100),
        "z".repeat(90),
      ]);
    });
  });

  describe("boundary conditions", () => {
    it("handles zero valid entries", () => {
      expect(splitSearchList("")).toEqual([]);
      expect(splitSearchList(",,,   ,  ")).toEqual([]);
    });

    it("handles exactly 1 valid entry", () => {
      expect(splitSearchList("OnlyOne")).toEqual(["OnlyOne"]);
    });

    it("handles exactly 24 valid entries", () => {
      const items = Array.from({ length: 24 }, (_, i) => `City_${i + 1}`);
      const result = splitSearchList(items.join(","));
      expect(result).toHaveLength(24);
      expect(result).toEqual(items);
    });

    it("handles exactly 25 valid entries", () => {
      const items = Array.from({ length: 25 }, (_, i) => `City_${i + 1}`);
      const result = splitSearchList(items.join(","));
      expect(result).toHaveLength(25);
      expect(result).toEqual(items);
    });

    it("handles exactly 26 valid entries", () => {
      const items = Array.from({ length: 26 }, (_, i) => `City_${i + 1}`);
      const result = splitSearchList(items.join(","));
      expect(result).toHaveLength(25);
      expect(result).toEqual(items.slice(0, 25));
    });

    it("handles more than 25 entries with interspersed empty values", () => {
      const raw =
        " , c1,  , c2, c3, , c4, c5, , c6, c7, c8, , c9, c10, c11, , c12, c13, c14, , c15, c16, c17, , c18, c19, c20, , c21, c22, c23, , c24, c25, , c26, c27";
      const result = splitSearchList(raw);
      expect(result).toHaveLength(25);
      const expected = Array.from({ length: 25 }, (_, i) => `c${i + 1}`);
      expect(result).toEqual(expected);
    });
  });
});

describe("normalizeSearchQuery", () => {
  it("leaves an already canonical query untouched", () => {
    expect(normalizeSearchQuery("quiet cafe")).toBe("quiet cafe");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeSearchQuery("  quiet cafe  ")).toBe("quiet cafe");
  });

  it("collapses runs of inner whitespace to a single space", () => {
    expect(normalizeSearchQuery("quiet     cafe")).toBe("quiet cafe");
    expect(normalizeSearchQuery("quiet \t\n cafe")).toBe("quiet cafe");
  });

  it("treats non-breaking and ideographic spaces as whitespace", () => {
    expect(normalizeSearchQuery("quiet\u00a0cafe")).toBe("quiet cafe");
    expect(normalizeSearchQuery("\u3000quiet\u3000\u3000cafe\u3000")).toBe(
      "quiet cafe",
    );
  });

  it("lowercases the query", () => {
    expect(normalizeSearchQuery("Quiet CAFE")).toBe("quiet cafe");
  });

  it("maps every spelling variant of the same query to one string", () => {
    const variants = [
      "quiet cafe",
      " quiet cafe ",
      "quiet  cafe",
      "QUIET CAFE",
      "\tQuiet\u00a0 Cafe\n",
    ];
    expect(new Set(variants.map(normalizeSearchQuery)).size).toBe(1);
  });

  it("does not merge genuinely different queries", () => {
    expect(normalizeSearchQuery("quiet cafe")).not.toBe(
      normalizeSearchQuery("quietcafe"),
    );
  });

  it("returns an empty string for blank or non-string input", () => {
    expect(normalizeSearchQuery("   ")).toBe("");
    expect(normalizeSearchQuery(undefined)).toBe("");
    expect(normalizeSearchQuery(null)).toBe("");
    expect(normalizeSearchQuery(42)).toBe("");
  });
});
