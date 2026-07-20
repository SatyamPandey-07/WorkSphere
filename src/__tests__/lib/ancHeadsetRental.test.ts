import { venueCreateSchema, venueSearchSchema } from "@/lib/validations";

describe("ANC headset rental validation", () => {
  it("coerces the search query flag from a URL parameter", () => {
    const result = venueSearchSchema.parse({
      lat: "18.5204",
      lng: "73.8567",
      hasAncHeadsetRental: "true",
    });

    expect(result.hasAncHeadsetRental).toBe(true);
  });

  it("accepts the rental flag on venue creation", () => {
    const result = venueCreateSchema.parse({
      name: "Focus Hub",
      latitude: 18.5204,
      longitude: 73.8567,
      category: "coworking",
      hasAncHeadsetRental: true,
    });

    expect(result.hasAncHeadsetRental).toBe(true);
  });

  it("remains backward compatible when the field is omitted", () => {
    const result = venueCreateSchema.parse({
      name: "Existing Cafe",
      latitude: 18.5204,
      longitude: 73.8567,
      category: "cafe",
    });

    expect(result.hasAncHeadsetRental).toBeUndefined();
  });
});
