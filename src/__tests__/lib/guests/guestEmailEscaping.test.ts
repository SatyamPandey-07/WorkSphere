import {
  escapeHtml,
  sanitizeUrl,
  buildInviteHtml,
} from "@/lib/guests/email-service";

describe("Guest Email Template Escaping and URL Sanitization (Issue #10067)", () => {
  describe("escapeHtml", () => {
    it("should escape HTML tags and special characters", () => {
      const input = '<script>alert("XSS & attack")</script>';
      const expected =
        "&lt;script&gt;alert(&quot;XSS &amp; attack&quot;)&lt;/script&gt;";
      expect(escapeHtml(input)).toBe(expected);
    });

    it("should escape single and double quotes", () => {
      expect(escapeHtml(`'single' and "double"`)).toBe(
        "&#39;single&#39; and &quot;double&quot;",
      );
    });

    it("should return empty string for null or undefined", () => {
      expect(escapeHtml(null)).toBe("");
      expect(escapeHtml(undefined)).toBe("");
      expect(escapeHtml("")).toBe("");
    });
  });

  describe("sanitizeUrl", () => {
    it("should allow valid https and http URLs", () => {
      expect(sanitizeUrl("https://example.com/venue.jpg")).toBe(
        "https://example.com/venue.jpg",
      );
      expect(sanitizeUrl("http://maps.google.com/?q=Test")).toBe(
        "http://maps.google.com/?q=Test",
      );
    });

    it("should allow safe relative paths", () => {
      expect(sanitizeUrl("/api/bookings/123/guests?status=ACCEPTED")).toBe(
        "/api/bookings/123/guests?status=ACCEPTED",
      );
    });

    it("should reject dangerous javascript: and data: schemes", () => {
      expect(sanitizeUrl("javascript:alert(1)")).toBe("#");
      expect(sanitizeUrl("  javascript:alert(1)")).toBe("#");
      expect(sanitizeUrl("data:text/html,<script>alert(1)</script>")).toBe("#");
      expect(sanitizeUrl("vbscript:msgbox(1)")).toBe("#");
    });

    it("should reject protocol-relative URLs", () => {
      expect(sanitizeUrl("//evil.com/phishing")).toBe("#");
    });

    it("should use custom fallback if provided", () => {
      expect(sanitizeUrl("javascript:void(0)", "")).toBe("");
    });
  });

  describe("buildInviteHtml", () => {
    const baseParams = {
      guestEmail: "guest@example.com",
      guestName: "Alice Smith",
      hostName: "Bob Jones",
      venueName: "Downtown Coworking",
      venueAddress: "123 Main St, Suite 400",
      date: "2026-12-01",
      time: "10:00 AM",
      durationMinutes: 90,
      icsContent: "BEGIN:VCALENDAR...",
      directionsUrl: "https://maps.google.com/?q=123+Main+St",
      venuePhotoUrl: "https://images.example.com/venue.jpg",
      bookingRef: "REF-12345",
      bookingId: "booking-abc",
      guestId: "guest-xyz",
    };

    it("should escape user-controlled guest name containing HTML markup", () => {
      const html = buildInviteHtml({
        ...baseParams,
        guestName: '<b>Guest</b><a href="https://example.com">Click</a>',
      });

      expect(html).not.toContain("<b>Guest</b>");
      expect(html).not.toContain('<a href="https://example.com">Click</a>');
      expect(html).toContain(
        "&lt;b&gt;Guest&lt;/b&gt;&lt;a href=&quot;https://example.com&quot;&gt;Click&lt;/a&gt;",
      );
    });

    it("should escape hostName, venueName, venueAddress, and bookingRef", () => {
      const html = buildInviteHtml({
        ...baseParams,
        hostName: '<img src=x onerror="alert(1)">',
        venueName: 'Cool "Workspace" & Lounge <script>',
        venueAddress: '456 Hackers Way <iframe src="evil.com">',
        bookingRef: '<REF-9999&"SPECIAL">',
      });

      expect(html).not.toContain("<img src=x");
      expect(html).not.toContain("<script>");
      expect(html).not.toContain("<iframe");
      expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
      expect(html).toContain(
        "Cool &quot;Workspace&quot; &amp; Lounge &lt;script&gt;",
      );
      expect(html).toContain(
        "456 Hackers Way &lt;iframe src=&quot;evil.com&quot;&gt;",
      );
      expect(html).toContain("&lt;REF-9999&amp;&quot;SPECIAL&quot;&gt;");
    });

    it("should sanitize malicious venuePhotoUrl and directionsUrl", () => {
      const html = buildInviteHtml({
        ...baseParams,
        venuePhotoUrl: 'javascript:alert("photo")',
        directionsUrl: 'javascript:alert("directions")',
      });

      expect(html).not.toContain('src="javascript:');
      expect(html).not.toContain('href="javascript:');
      expect(html).toContain('href="#"');
    });

    it("should safely render normal invitation elements and links", () => {
      const html = buildInviteHtml(baseParams);

      expect(html).toContain("Hi Alice Smith,");
      expect(html).toContain("Downtown Coworking");
      expect(html).toContain("1h 30m");
      expect(html).toContain(
        'href="https://maps.google.com/?q=123+Main+St" target="_blank"',
      );
      expect(html).toContain("Accept RSVP");
      expect(html).toContain("Decline RSVP");
      expect(html).toContain("status=ACCEPTED");
      expect(html).toContain("status=DECLINED");
    });
  });
});
