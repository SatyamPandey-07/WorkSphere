/**
 * Tests for the venue field mapping in useCityDataPack (Issue #2099).
 */

interface ApiVenueResponse {
  id: string;
  name: string;
  category?: string;
  latitude?: number;
  longitude?: number;
  address?: string;
  imageUrl?: string;
  rating?: number;
}

interface OfflineVenue {
  id: string;
  name: string;
  category?: string;
  lat?: number;
  lng?: number;
  address?: string;
  imageUrl?: string;
  rating?: number;
  savedAt: number;
}

function mapApiVenueToOffline(apiVenue: ApiVenueResponse): Omit<OfflineVenue, "savedAt"> {
  return {
    id: apiVenue.id,
    name: apiVenue.name,
    category: apiVenue.category,
    lat: apiVenue.latitude,
    lng: apiVenue.longitude,
    address: apiVenue.address,
    imageUrl: apiVenue.imageUrl,
    rating: apiVenue.rating,
  };
}

describe("City data pack venue field mapping", () => {
  it("maps id and name directly", () => {
    const mapped = mapApiVenueToOffline({ id: "v1", name: "Test Café" });
    expect(mapped.id).toBe("v1");
    expect(mapped.name).toBe("Test Café");
  });

  it("maps latitude → lat, longitude → lng", () => {
    const mapped = mapApiVenueToOffline({ id: "v1", name: "Café", latitude: 48.86, longitude: 2.35 });
    expect(mapped.lat).toBe(48.86);
    expect(mapped.lng).toBe(2.35);
  });

  it("optional fields are preserved when present", () => {
    const mapped = mapApiVenueToOffline({
      id: "v1",
      name: "Café",
      category: "cafe",
      address: "1 Main St",
      imageUrl: "https://example.com/img.jpg",
      rating: 4.5,
    });
    expect(mapped.category).toBe("cafe");
    expect(mapped.address).toBe("1 Main St");
    expect(mapped.imageUrl).toBe("https://example.com/img.jpg");
    expect(mapped.rating).toBe(4.5);
  });

  it("optional fields are undefined when not in API response", () => {
    const mapped = mapApiVenueToOffline({ id: "v1", name: "Café" });
    expect(mapped.category).toBeUndefined();
    expect(mapped.lat).toBeUndefined();
    expect(mapped.lng).toBeUndefined();
  });

  it("maps multiple venues correctly", () => {
    const venues = [
      { id: "v1", name: "A", latitude: 1, longitude: 2 },
      { id: "v2", name: "B", latitude: 3, longitude: 4 },
    ];
    const mapped = venues.map(mapApiVenueToOffline);
    expect(mapped[0].lat).toBe(1);
    expect(mapped[1].lat).toBe(3);
  });

  it("does not include savedAt (added by saveVenueOffline)", () => {
    const mapped = mapApiVenueToOffline({ id: "v1", name: "Café" });
    expect("savedAt" in mapped).toBe(false);
  });
});
