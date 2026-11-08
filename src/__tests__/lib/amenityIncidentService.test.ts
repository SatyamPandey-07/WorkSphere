import { amenityIncidentService } from "@/lib/venues/amenityIncidentService";

describe("amenityIncidentService", () => {
  it("guards against NaN and non-positive ttlHours without throwing RangeError", () => {
    const incidentWithNan = amenityIncidentService.reportIncident({
      venueId: "venue-test",
      amenity: "wifi",
      title: "Wi-Fi down",
      userId: "u-1",
      userName: "Alice",
      ttlHours: NaN,
    });
    expect(incidentWithNan.expiresAt).toBeDefined();
    expect(new Date(incidentWithNan.expiresAt).getTime()).not.toBeNaN();

    const incidentWithNegative = amenityIncidentService.reportIncident({
      venueId: "venue-test",
      amenity: "coffee",
      title: "Espresso machine broken",
      userId: "u-2",
      userName: "Bob",
      ttlHours: -2,
    });
    expect(new Date(incidentWithNegative.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });
});
