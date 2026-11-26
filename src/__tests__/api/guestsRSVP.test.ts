import {
  GET,
  POST,
  PATCH,
} from "../../app/api/bookings/[bookingId]/guests/route";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/auth", () => ({
  ensureUserExists: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    bookingGuest: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  },
}));

describe("Guest RSVP Endpoints (#10066)", () => {
  const mockFindFirst = (prisma as any).bookingGuest.findFirst as jest.Mock;
  const mockUpdate = (prisma as any).bookingGuest.update as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /api/bookings/[bookingId]/guests (Read-Only RSVP Confirmation)", () => {
    it("returns 400 for invalid status query values", async () => {
      const req = {
        url: "http://localhost/api/bookings/123/guests?guestId=guest_123&status=INVALID",
      };
      const context = { params: Promise.resolve({ bookingId: "123" }) };

      const res = await GET(req as any, context);
      expect(res.status).toBe(400);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("returns 404 if guest invitation is not found", async () => {
      mockFindFirst.mockResolvedValue(null);

      const req = {
        url: "http://localhost/api/bookings/123/guests?guestId=guest_123&status=ACCEPTED",
      };
      const context = { params: Promise.resolve({ bookingId: "123" }) };

      const res = await GET(req as any, context);
      expect(res.status).toBe(404);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("returns 200 HTML confirmation page WITHOUT mutating database on GET", async () => {
      mockFindFirst.mockResolvedValue({
        id: "guest_123",
        email: "guest@example.com",
        booking: {
          venue: {
            name: "Nomad Oasis",
          },
        },
      });

      const req = {
        url: "http://localhost/api/bookings/123/guests?guestId=guest_123&status=ACCEPTED",
      };
      const context = { params: Promise.resolve({ bookingId: "123" }) };

      const res = await GET(req as any, context);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("Respond to Invitation");
      expect(text).toContain("Nomad Oasis");
      expect(text).toContain("Accept Invitation");
      expect(text).toContain("Decline instead");

      // Core Bug Invariant: GET request MUST NEVER modify database state
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/bookings/[bookingId]/guests (Public RSVP Submission)", () => {
    it("updates guest status to ACCEPTED via form submission and returns confirmation HTML", async () => {
      mockFindFirst.mockResolvedValue({
        id: "guest_123",
        email: "guest@example.com",
        booking: {
          venue: {
            name: "Nomad Oasis",
          },
        },
      });
      mockUpdate.mockResolvedValue({ id: "guest_123", status: "ACCEPTED" });

      const formDataMap = new Map<string, string>([
        ["guestId", "guest_123"],
        ["status", "ACCEPTED"],
      ]);

      const req = {
        headers: {
          get: jest.fn((h: string) =>
            h.toLowerCase() === "content-type"
              ? "application/x-www-form-urlencoded"
              : null,
          ),
        },
        formData: jest.fn().mockResolvedValue(formDataMap),
      };
      const context = { params: Promise.resolve({ bookingId: "123" }) };

      const res = await POST(req as any, context);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("RSVP Submitted!");
      expect(text).toContain("Nomad Oasis");
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: "guest_123" },
        data: { status: "ACCEPTED" },
      });
    });

    it("updates guest status to DECLINED via JSON payload", async () => {
      mockFindFirst.mockResolvedValue({
        id: "guest_123",
        email: "guest@example.com",
      });
      mockUpdate.mockResolvedValue({ id: "guest_123", status: "DECLINED" });

      const req = {
        headers: {
          get: jest.fn((h: string) =>
            h.toLowerCase() === "content-type" ? "application/json" : null,
          ),
        },
        clone: () => ({
          json: jest.fn().mockResolvedValue({
            guestId: "guest_123",
            status: "DECLINED",
          }),
        }),
      };
      const context = { params: Promise.resolve({ bookingId: "123" }) };

      const res = await POST(req as any, context);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.guest.status).toBe("DECLINED");
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: "guest_123" },
        data: { status: "DECLINED" },
      });
    });

    it("returns 400 for invalid status on public RSVP POST", async () => {
      const req = {
        headers: {
          get: jest.fn((h: string) =>
            h.toLowerCase() === "content-type" ? "application/json" : null,
          ),
        },
        clone: () => ({
          json: jest.fn().mockResolvedValue({
            guestId: "guest_123",
            status: "INVALID_STATUS",
          }),
        }),
      };
      const context = { params: Promise.resolve({ bookingId: "123" }) };

      const res = await POST(req as any, context);
      expect(res.status).toBe(400);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("returns 404 if guest not found during public RSVP POST", async () => {
      mockFindFirst.mockResolvedValue(null);

      const req = {
        headers: {
          get: jest.fn((h: string) =>
            h.toLowerCase() === "content-type" ? "application/json" : null,
          ),
        },
        clone: () => ({
          json: jest.fn().mockResolvedValue({
            guestId: "non_existent",
            status: "ACCEPTED",
          }),
        }),
      };
      const context = { params: Promise.resolve({ bookingId: "123" }) };

      const res = await POST(req as any, context);
      expect(res.status).toBe(404);
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe("PATCH /api/bookings/[bookingId]/guests (Programmatic RSVP)", () => {
    it("returns 400 for missing fields", async () => {
      const req = {
        json: jest.fn().mockResolvedValue({}),
      };
      const context = { params: Promise.resolve({ bookingId: "123" }) };

      const res = await PATCH(req as any, context);
      expect(res.status).toBe(400);
    });

    it("returns 404 if guest is not found", async () => {
      mockFindFirst.mockResolvedValue(null);

      const req = {
        json: jest.fn().mockResolvedValue({
          guestId: "guest_123",
          status: "ACCEPTED",
        }),
      };
      const context = { params: Promise.resolve({ bookingId: "123" }) };

      const res = await PATCH(req as any, context);
      expect(res.status).toBe(404);
    });

    it("returns 200 with updated guest on successful PATCH", async () => {
      mockFindFirst.mockResolvedValue({
        id: "guest_123",
        email: "guest@example.com",
      });
      mockUpdate.mockResolvedValue({ id: "guest_123", status: "DECLINED" });

      const req = {
        json: jest.fn().mockResolvedValue({
          guestId: "guest_123",
          status: "DECLINED",
        }),
      };
      const context = { params: Promise.resolve({ bookingId: "123" }) };

      const res = await PATCH(req as any, context);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.guest.status).toBe("DECLINED");
    });
  });
});
