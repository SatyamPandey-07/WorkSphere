import {
  encodeAdmissionToken,
  decodeAdmissionToken,
  generateAdmissionTicketQR,
  AdmissionTokenPayload,
} from "@/lib/social/admissionTicket";

describe("Attendee Admission Token & Ticket Generator (#5066)", () => {
  const samplePayload: AdmissionTokenPayload = {
    sessionSlug: "friday-deep-work",
    userId: "user_attendee_123",
    venueName: "Downtown Creative Lounge",
    startsAt: "2026-10-16T14:00:00.000Z",
    issuedAt: 1729087200,
  };

  it("encodes attendee admission token with prefix and valid base64url payload", () => {
    const token = encodeAdmissionToken(samplePayload);

    expect(typeof token).toBe("string");
    expect(token.startsWith("ws-admit:v1:")).toBe(true);

    // Verify token length is compact for QR code matrix constraints (< 213 bytes)
    expect(token.length).toBeLessThan(200);
  });

  it("decodes a valid admission token correctly preserving payload fields", () => {
    const token = encodeAdmissionToken(samplePayload);
    const decoded = decodeAdmissionToken(token);

    expect(decoded).not.toBeNull();
    expect(decoded?.sessionSlug).toBe(samplePayload.sessionSlug);
    expect(decoded?.userId).toBe(samplePayload.userId);
    expect(decoded?.venueName).toBe(samplePayload.venueName);
    expect(decoded?.startsAt).toBe(samplePayload.startsAt);
    expect(decoded?.issuedAt).toBe(samplePayload.issuedAt);
  });

  it("handles admission tokens with optional venueName and startsAt omitted", () => {
    const minimalPayload: AdmissionTokenPayload = {
      sessionSlug: "morning-standup",
      userId: "user_min_456",
    };

    const token = encodeAdmissionToken(minimalPayload);
    const decoded = decodeAdmissionToken(token);

    expect(decoded).not.toBeNull();
    expect(decoded?.sessionSlug).toBe("morning-standup");
    expect(decoded?.userId).toBe("user_min_456");
    expect(decoded?.venueName).toBeUndefined();
    expect(decoded?.startsAt).toBeUndefined();
    expect(typeof decoded?.issuedAt).toBe("number");
  });

  it("returns null for malformed, missing, or invalid token prefixes", () => {
    expect(decodeAdmissionToken("")).toBeNull();
    // @ts-expect-error test invalid argument
    expect(decodeAdmissionToken(null)).toBeNull();
    expect(decodeAdmissionToken("invalid-prefix:eyJzIjoiMSJ9")).toBeNull();
    expect(decodeAdmissionToken("ws-admit:v1:not-valid-base64-json@@@")).toBeNull();
    expect(decodeAdmissionToken("ws-admit:v1:eyJuZSI6Im5vLXNsdWcifQ==")).toBeNull();
  });

  it("generates an SVG QR code encoding the admission token", () => {
    const svg = generateAdmissionTicketQR(samplePayload, { size: 140 });

    expect(typeof svg).toBe("string");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain('width="140"');
    expect(svg).toContain('height="140"');
    expect(svg).toContain("Admission Ticket for friday-deep-work");
  });
});
