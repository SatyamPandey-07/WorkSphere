import {
  parseFiltersFromSearchParams,
  buildQueryStringWithFilters,
  DEFAULT_FILTER_STATE,
} from "@/hooks/useVenueFilterParams";

describe("useVenueFilterParams & URL Search Parameter Synchronization", () => {
  describe("parseFiltersFromSearchParams", () => {
    test("returns default filter state when search params are empty or null", () => {
      const parsedNull = parseFiltersFromSearchParams(null);
      expect(parsedNull).toEqual(DEFAULT_FILTER_STATE);

      const parsedEmpty = parseFiltersFromSearchParams(new URLSearchParams(""));
      expect(parsedEmpty).toEqual(DEFAULT_FILTER_STATE);
    });

    test("accurately parses all filter parameters and view mode", () => {
      const params = new URLSearchParams(
        "q=blue+bottle&category=cafe&wifi=true&wifiSpeedBand=fast&noise=quiet&quietHours=true&outlets=true&price=$$&distance=3&view=map",
      );

      const parsed = parseFiltersFromSearchParams(params);

      expect(parsed.query).toBe("blue bottle");
      expect(parsed.category).toBe("cafe");
      expect(parsed.wifi).toBe(true);
      expect(parsed.wifiSpeedBand).toBe("fast");
      expect(parsed.noiseLevel).toBe("quiet");
      expect(parsed.quietHours).toBe(true);
      expect(parsed.outlets).toBe(true);
      expect(parsed.priceRange).toBe("$$");
      expect(parsed.maxDistance).toBe(3);
      expect(parsed.view).toBe("map");
      expect(parsed.amenities).toEqual(
        expect.arrayContaining(["wifi", "outlets", "quiet"]),
      );
    });

    test("handles parameter aliases gracefully", () => {
      const params = new URLSearchParams(
        "query=library&type=library&hasWifi=true&hasOutlets=true&quiet=true&maxDistance=5&view=list",
      );

      const parsed = parseFiltersFromSearchParams(params);

      expect(parsed.query).toBe("library");
      expect(parsed.category).toBe("library");
      expect(parsed.wifi).toBe(true);
      expect(parsed.outlets).toBe(true);
      expect(parsed.noiseLevel).toBe("quiet");
      expect(parsed.maxDistance).toBe(5);
      expect(parsed.view).toBe("list");
    });

    test("restores standing desk alongside other amenity filters", () => {
      const parsed = parseFiltersFromSearchParams(
        new URLSearchParams("standingDesk=true&wifi=true&amenities=outlets"),
      );

      expect(parsed.standingDesk).toBe(true);
      expect(parsed.amenities).toEqual(
        expect.arrayContaining(["standing_desk", "wifi", "outlets"]),
      );
    });

    describe("whitespace normalization (#7727)", () => {
      test("trims leading and trailing whitespace from q", () => {
        const parsed = parseFiltersFromSearchParams(
          new URLSearchParams("q=%20%20quiet%20cafe%20%20"),
        );
        expect(parsed.query).toBe("quiet cafe");
      });

      test("treats a padded q and a clean q as the same state", () => {
        const padded = parseFiltersFromSearchParams(
          new URLSearchParams("q=%20cafe%20"),
        );
        const clean = parseFiltersFromSearchParams(
          new URLSearchParams("q=cafe"),
        );
        expect(padded).toEqual(clean);
      });

      test("trims the query alias too", () => {
        const parsed = parseFiltersFromSearchParams(
          new URLSearchParams("query=%09library%20"),
        );
        expect(parsed.query).toBe("library");
      });

      test("turns a whitespace-only q into an empty query", () => {
        const parsed = parseFiltersFromSearchParams(
          new URLSearchParams("q=%20%20%20"),
        );
        expect(parsed.query).toBe("");
        expect(parsed).toEqual(DEFAULT_FILTER_STATE);
      });

      test("falls back to the query alias when q is only whitespace", () => {
        const parsed = parseFiltersFromSearchParams(
          new URLSearchParams("q=%20&query=coworking"),
        );
        expect(parsed.query).toBe("coworking");
      });

      test("keeps inner spaces untouched", () => {
        const parsed = parseFiltersFromSearchParams(
          new URLSearchParams("q=%20blue%20%20bottle%20"),
        );
        expect(parsed.query).toBe("blue  bottle");
      });
    });
  });

  describe("buildQueryStringWithFilters & View Switching", () => {
    test("strictly preserves active filter query parameters when switching view from Map to List", () => {
      const initialParams = new URLSearchParams(
        "q=starbucks&category=cafe&wifi=true&noise=quiet&price=$$&view=map&session=abc123xyz",
      );

      const updatedQuery = buildQueryStringWithFilters(initialParams, {
        view: "list",
      });

      const nextParams = new URLSearchParams(updatedQuery.replace(/^\?/, ""));

      // "list" is the default view, so buildQueryStringWithFilters canonicalizes it
      // out of the URL; the parser resolves the absent param back to "list".
      expect(nextParams.has("view")).toBe(false);
      expect(parseFiltersFromSearchParams(nextParams).view).toBe("list");

      // All existing filters must remain completely intact
      expect(nextParams.get("q")).toBe("starbucks");
      expect(nextParams.get("category")).toBe("cafe");
      expect(nextParams.get("wifi")).toBe("true");
      expect(nextParams.get("noise")).toBe("quiet");
      expect(nextParams.get("price")).toBe("$$");
      expect(nextParams.get("session")).toBe("abc123xyz");
    });

    test("strictly preserves active filter query parameters when switching view from List to Map", () => {
      const initialParams = new URLSearchParams(
        "q=wework&category=coworking&wifi=true&outlets=true&distance=5&view=list",
      );

      const updatedQuery = buildQueryStringWithFilters(initialParams, {
        view: "map",
      });

      const nextParams = new URLSearchParams(updatedQuery.replace(/^\?/, ""));

      expect(nextParams.get("view")).toBe("map");
      expect(nextParams.get("q")).toBe("wework");
      expect(nextParams.get("category")).toBe("coworking");
      expect(nextParams.get("wifi")).toBe("true");
      expect(nextParams.get("outlets")).toBe("true");
      expect(nextParams.get("distance")).toBe("5");
    });

    test("updates filter values while preserving view mode", () => {
      const initialParams = new URLSearchParams(
        "q=cafe&category=cafe&wifi=true&view=map",
      );

      const updatedQuery = buildQueryStringWithFilters(initialParams, {
        priceRange: "$$$",
        quietHours: true,
      });

      const nextParams = new URLSearchParams(updatedQuery.replace(/^\?/, ""));

      expect(nextParams.get("view")).toBe("map");
      expect(nextParams.get("q")).toBe("cafe");
      expect(nextParams.get("category")).toBe("cafe");
      expect(nextParams.get("wifi")).toBe("true");
      expect(nextParams.get("price")).toBe("$$$");
      expect(nextParams.get("quietHours")).toBe("true");
    });

    test("serializes standing desk as its dedicated parameter and preserves other filters", () => {
      const initialParams = new URLSearchParams(
        "q=desk&session=abc&amenities=wifi",
      );

      const updatedQuery = buildQueryStringWithFilters(initialParams, {
        amenities: ["wifi", "standing_desk"],
      });
      const nextParams = new URLSearchParams(updatedQuery.slice(1));

      expect(nextParams.get("standingDesk")).toBe("true");
      expect(nextParams.get("amenities")).toBe("wifi");
      expect(nextParams.get("q")).toBe("desk");
      expect(nextParams.get("session")).toBe("abc");

      const clearedQuery = buildQueryStringWithFilters(nextParams, {
        amenities: ["wifi"],
      });
      const clearedParams = new URLSearchParams(clearedQuery.slice(1));
      expect(clearedParams.has("standingDesk")).toBe(false);
      expect(clearedParams.get("amenities")).toBe("wifi");
    });

    test("removes default or cleared filters from query string", () => {
      const initialParams = new URLSearchParams(
        "q=cafe&category=cafe&wifi=true&price=$$&view=map",
      );

      const updatedQuery = buildQueryStringWithFilters(initialParams, {
        query: "",
        category: "all",
        wifi: false,
        priceRange: "all",
      });

      const nextParams = new URLSearchParams(updatedQuery.replace(/^\?/, ""));

      expect(nextParams.has("q")).toBe(false);
      expect(nextParams.has("category")).toBe(false);
      expect(nextParams.has("wifi")).toBe(false);
      expect(nextParams.has("price")).toBe(false);
      expect(nextParams.get("view")).toBe("map");
    });

    test("preserves and updates capacity sortBy parameter", () => {
      const initialParams = new URLSearchParams("q=cafe&sortBy=capacity_asc");
      const parsed = parseFiltersFromSearchParams(initialParams);
      expect(parsed.sortBy).toBe("capacity_asc");

      const updatedQuery = buildQueryStringWithFilters(initialParams, {
        sortBy: "capacity_desc",
      });
      const nextParams = new URLSearchParams(updatedQuery.replace(/^\?/, ""));
      expect(nextParams.get("sortBy")).toBe("capacity_desc");

      const clearedQuery = buildQueryStringWithFilters(nextParams, {
        sortBy: "default",
      });
      const clearedParams = new URLSearchParams(
        clearedQuery.replace(/^\?/, ""),
      );
      expect(clearedParams.has("sortBy")).toBe(false);
    });
  });
});
