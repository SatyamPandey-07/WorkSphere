import { formatVenueComparisonCsv } from "@/components/venues/MultiCityComparison";
import { Venue } from "@/components/chat/ChatMessages";

describe("formatVenueComparisonCsv", () => {
  it("correctly formats venue comparison data into a valid CSV string", () => {
    const mockVenues: Venue[] = [
      {
        id: "v1",
        name: "Cafe Code",
        lat: 37.7749,
        lng: -122.4194,
        category: "cafe",
        address: "123 Tech St, San Francisco",
        wifi: true,
        wifiSpeed: 120,
        hasOutlets: true,
        noiseLevel: "quiet",
        score: 9.5,
      },
      {
        id: "v2",
        name: "Library Hub",
        lat: 35.6762,
        lng: 139.6503,
        category: "library",
        address: "456 Quiet Rd, Tokyo",
        wifi: true,
        wifiSpeed: 50,
        hasOutlets: false,
        noiseLevel: "moderate",
        score: 8,
      },
    ];

    const csv = formatVenueComparisonCsv(mockVenues);

    expect(csv).toContain(
      "Name,Address,Wi-Fi Speed (Mbps),Power Outlets,Noise Level,Score",
    );
    expect(csv).toContain(
      '"Cafe Code","123 Tech St, San Francisco",120,Yes,quiet,95%',
    );
    expect(csv).toContain(
      '"Library Hub","456 Quiet Rd, Tokyo",50,No,moderate,80%',
    );
  });

  it("handles missing optional venue attributes gracefully in CSV formatting", () => {
    const mockVenues: Venue[] = [
      {
        id: "v3",
        name: "Minimalist Workspace",
        lat: 0,
        lng: 0,
        category: "coworking",
      },
    ];

    const csv = formatVenueComparisonCsv(mockVenues);

    expect(csv).toContain('"Minimalist Workspace","",N/A,No,N/A,N/A');
  });
});
