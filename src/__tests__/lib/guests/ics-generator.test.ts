import {
  generateIcsUid,
  buildIcsEventData,
  generateIcsContent,
} from "../../../lib/guests/ics-generator";

describe("ics-generator UID generator", () => {
  it("should generate unique UIDs even with identical inputs", () => {
    const bookingId = "booking_123";
    const guestEmail = "guest@example.com";

    const uid1 = generateIcsUid(bookingId, guestEmail);
    const uid2 = generateIcsUid(bookingId, guestEmail);

    expect(uid1).not.toBe(uid2);
  });

  it("should generate unique UIDs with same booking ID but different guest emails", () => {
    const bookingId = "booking_123";
    const email1 = "guest1@example.com";
    const email2 = "guest2@example.com";

    const uid1 = generateIcsUid(bookingId, email1);
    const uid2 = generateIcsUid(bookingId, email2);

    expect(uid1).not.toBe(uid2);
  });

  it("should contain an @ domain suffix and be ICS-compliant", () => {
    const bookingId = "booking_123";
    const guestEmail = "guest@example.com";

    const uid = generateIcsUid(bookingId, guestEmail);

    expect(uid).toContain("@");
    expect(uid.endsWith("@worksphere.io")).toBe(true);
  });
});

describe("buildIcsEventData and generateIcsContent", () => {
  it("should correctly compile and output ICS data and content", () => {
    const eventParams = {
      bookingId: "booking_123",
      confirmationId: "CONF-123",
      venueName: "Creative Space",
      venueAddress: "123 Main St, City",
      venueLatitude: 37.7749,
      venueLongitude: -122.4194,
      hostName: "Host User",
      hostEmail: "host@example.com",
      guestEmail: "guest@example.com",
      date: "2026-07-25",
      time: "14:00",
      durationMinutes: 60,
    };

    const eventData = buildIcsEventData(eventParams);
    expect(eventData.uid).toContain("@worksphere.io");

    const content = generateIcsContent(eventData);
    expect(content).toContain("BEGIN:VCALENDAR");
    expect(content).toContain("VERSION:2.0");
    expect(content).toContain(`UID:${eventData.uid}`);
    expect(content).toContain("END:VCALENDAR");
  });
});
