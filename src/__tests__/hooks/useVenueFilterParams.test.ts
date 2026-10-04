import {
  parseFiltersFromSearchParams,
  buildQueryStringWithFilters,
  DEFAULT_FILTER_STATE,
  type VenueFilterState,
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

      // View should be updated
      expect(nextParams.get("view")).toBe("list");

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
  });
});
