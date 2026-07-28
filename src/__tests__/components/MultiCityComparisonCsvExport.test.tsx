import { formatVenueComparisonCsv } from "@/components/venues/MultiCityComparison";
import { Venue } from "@/components/chat/ChatMessages";

describe("formatVenueComparisonCsv", () => {
  it("correctly formats venue comparison data into a valid CSV string", () => {
    const mockVenues: Venue[] = [
      {
        id: "v1",
        name: "Cafe Code",
        address: "123 Tech St, San Francisco",
        wifi: true,
        wifiSpeed: 120,
        hasOutlets: true,
        noiseLevel: "quiet",
        score: 0.95,
      },
      {
        id: "v2",
        name: "Library Hub",
        address: "456 Quiet Rd, Tokyo",
        wifi: true,
        wifiSpeed: 50,
        hasOutlets: false,
        noiseLevel: "moderate",
        score: 0.8,
      },
    ];

    const csv = formatVenueComparisonCsv(mockVenues);

    expect(csv).toContain("Name,Address,Wi-Fi Speed (Mbps),Power Outlets,Noise Level,Score");
    expect(csv).toContain('"Cafe Code","123 Tech St, San Francisco",120,Yes,quiet,95%');
    expect(csv).toContain('"Library Hub","456 Quiet Rd, Tokyo",50,No,moderate,80%');
  });

  it("handles missing optional venue attributes gracefully in CSV formatting", () => {
    const mockVenues: Venue[] = [
      {
        id: "v3",
        name: "Minimalist Workspace",
      },
    ];

    const csv = formatVenueComparisonCsv(mockVenues);

    expect(csv).toContain('"Minimalist Workspace","",N/A,No,N/A,N/A');
  });
});
