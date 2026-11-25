import { cancelWaitlistEntry } from "@/lib/waitlist/waitlistService";
import { DELETE } from "@/app/api/venues/[venueId]/waitlist/route";
import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

jest.mock("@/lib/notifications/dispatcher", () => ({
  NotificationDispatcher: class {
    async dispatch() {}
  },
}));

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn().mockResolvedValue({ userId: "user-test" }),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venueSeatWaitlist: {
      updateMany: jest.fn(),
    },
  },
}));

describe("Waitlist Cancellation Status Guard (#9855)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("cancelWaitlistEntry status guard", () => {
    it("successfully cancels an ACTIVE waitlist entry", async () => {
      (prisma.venueSeatWaitlist.updateMany as jest.Mock).mockResolvedValueOnce({
        count: 1,
      });

      const success = await cancelWaitlistEntry(
        "waitlist-1",
        "user-1",
        "venue-1",
      );

      expect(success).toBe(true);
      expect(prisma.venueSeatWaitlist.updateMany).toHaveBeenCalledWith({
        where: {
          id: "waitlist-1",
          userId: "user-1",
          venueId: "venue-1",
          status: { in: ["ACTIVE", "NOTIFIED"] },
        },
        data: { status: "CANCELLED" },
      });
    });

    it("successfully cancels a NOTIFIED waitlist entry", async () => {
      (prisma.venueSeatWaitlist.updateMany as jest.Mock).mockResolvedValueOnce({
        count: 1,
      });

      const success = await cancelWaitlistEntry("waitlist-notified", "user-1");

      expect(success).toBe(true);
      expect(prisma.venueSeatWaitlist.updateMany).toHaveBeenCalledWith({
        where: {
          id: "waitlist-notified",
          userId: "user-1",
          status: { in: ["ACTIVE", "NOTIFIED"] },
        },
        data: { status: "CANCELLED" },
      });
    });

    it("refuses to cancel or overwrite an entry that has already been CLAIMED", async () => {
      // updateMany returns count: 0 because status condition (ACTIVE/NOTIFIED) is not met
      (prisma.venueSeatWaitlist.updateMany as jest.Mock).mockResolvedValueOnce({
        count: 0,
      });

      const success = await cancelWaitlistEntry(
        "waitlist-claimed",
        "user-1",
        "venue-1",
      );

      expect(success).toBe(false);
      // Confirmed that updateMany scoped strictly to ACTIVE and NOTIFIED statuses
      expect(prisma.venueSeatWaitlist.updateMany).toHaveBeenCalledWith({
        where: {
          id: "waitlist-claimed",
          userId: "user-1",
          venueId: "venue-1",
          status: { in: ["ACTIVE", "NOTIFIED"] },
        },
        data: { status: "CANCELLED" },
      });
    });

    it("refuses to cancel an EXPIRED or already CANCELLED entry", async () => {
      (prisma.venueSeatWaitlist.updateMany as jest.Mock).mockResolvedValueOnce({
        count: 0,
      });

      const success = await cancelWaitlistEntry("waitlist-expired", "user-1");
      expect(success).toBe(false);
    });

    it("refuses to cancel when userId or venueId do not match", async () => {
      (prisma.venueSeatWaitlist.updateMany as jest.Mock).mockResolvedValueOnce({
        count: 0,
      });

      const success = await cancelWaitlistEntry(
        "waitlist-1",
        "wrong-user",
        "wrong-venue",
      );
      expect(success).toBe(false);
    });
  });

  describe("DELETE /api/venues/[venueId]/waitlist API Route", () => {
    it("returns 200 with success: true when active entry is cancelled", async () => {
      (prisma.venueSeatWaitlist.updateMany as jest.Mock).mockResolvedValueOnce({
        count: 1,
      });

      const req = new NextRequest(
        "http://localhost:3000/api/venues/venue-test/waitlist?waitlistId=w-1",
        { method: "DELETE" },
      );

      const res = await DELETE(req, {
        params: Promise.resolve({ venueId: "venue-test" }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.message).toBe("Waitlist entry cancelled.");
    });

    it("returns 200 with success: false when entry was already claimed or not found", async () => {
      (prisma.venueSeatWaitlist.updateMany as jest.Mock).mockResolvedValueOnce({
        count: 0,
      });

      const req = new NextRequest(
        "http://localhost:3000/api/venues/venue-test/waitlist?waitlistId=w-claimed",
        { method: "DELETE" },
      );

      const res = await DELETE(req, {
        params: Promise.resolve({ venueId: "venue-test" }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.message).toBe("Entry not found.");
    });
  });
});
