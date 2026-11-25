import { buildVenueSearchParams } from "@/lib/venues/searchQuery";

describe("buildVenueSearchParams", () => {
  it("serializes minWifiSpeed parameter correctly when provided", () => {
    const params = buildVenueSearchParams({
      minWifiSpeed: 100,
    });
    expect(params.get("minWifiSpeed")).toBe("100");
  });

  it("removes minWifiSpeed if set to 0, negative, or undefined", () => {
    const initialParams = "minWifiSpeed=100&q=cafe";

    const zeroParams = buildVenueSearchParams(
      { minWifiSpeed: 0 },
      initialParams,
    );
    expect(zeroParams.has("minWifiSpeed")).toBe(false);
    expect(zeroParams.get("q")).toBe("cafe");

    const negParams = buildVenueSearchParams(
      { minWifiSpeed: -50 },
      initialParams,
    );
    expect(negParams.has("minWifiSpeed")).toBe(false);

    const undefinedParams = buildVenueSearchParams({}, initialParams);
    expect(undefinedParams.get("minWifiSpeed")).toBe("100");
  });

  it("combines minWifiSpeed with text query, categories, and amenities", () => {
    const params = buildVenueSearchParams({
      q: "Workspace",
      category: "coworking",
      amenities: ["lightning_wifi", "standing_desks"],
      minWifiSpeed: 100,
    });

    expect(params.get("q")).toBe("Workspace");
    expect(params.get("category")).toBe("coworking");
    expect(params.get("amenities")).toBe("lightning_wifi,standing_desks");
    expect(params.get("minWifiSpeed")).toBe("100");
  });
});
