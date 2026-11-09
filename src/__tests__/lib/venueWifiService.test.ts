import {
  escapeWifiQrString,
  buildWifiQrString,
  getVenueWifiConfig,
} from "@/lib/venues/venueWifiService";

describe("venueWifiService", () => {
  it("guards non-string values in escapeWifiQrString gracefully", () => {
    expect(escapeWifiQrString(undefined as any)).toBe("");
    expect(escapeWifiQrString(null as any)).toBe("");
    expect(escapeWifiQrString(12345 as any)).toBe("");
    expect(escapeWifiQrString("Network;Name:\"Test\"")).toBe(
      "Network\\;Name\\:\\\"Test\\\"",
    );
  });

  it("builds valid Wi-Fi QR string even when ssid is undefined", () => {
    const qr = buildWifiQrString({ ssid: undefined as any });
    expect(qr).toBe("WIFI:T:nopass;S:;;;");
  });

  it("handles empty or null venueName in getVenueWifiConfig without error", () => {
    const config = getVenueWifiConfig("venue-null-name", null as any);
    expect(config.ssid).toBe("Venue_Guest");
  });
});
