import {
  generateWeeklyVenueAnalyticsCSV,
  fetchWeeklyVenueAnalyticsData,
  sendWeeklyVenueAnalyticsEmail,
  processWeeklyVenueAnalyticsJob,
  type WeeklyVenueAnalyticsData,
} from "@/lib/export/domain/weeklyVenueAnalyticsExporter";

// Mock dependencies
jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock("nodemailer", () => ({
  createTransport: jest.fn(() => ({
    sendMail: jest.fn().mockResolvedValue({ messageId: "msg-123456" }),
  })),
}));

const { prisma } = require("@/lib/prisma");
const nodemailer = require("nodemailer");

describe("Weekly Venue Analytics CSV Exporter & Automated Email Dispatch (#5070)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SMTP_USER = "test@worksphere.app";
    process.env.SMTP_PASS = "secret-pass";
  });

  const sampleData: WeeklyVenueAnalyticsData = {
    startDate: "2026-10-01",
    endDate: "2026-10-08",
    generatedAt: "2026-10-08T12:00:00.000Z",
    venues: [
      {
        venueId: "venue-alpha-100",
        venueName: "Downtown WorkHub",
        category: "Coworking Space",
        managerEmail: "manager@workhub.com",
        totalBookings: 24,
        totalRevenue: 1200.5,
        currency: "$",
        footTrafficCount: 42,
        averageRating: 4.8,
      },
      {
        venueId: "venue-beta-200",
        venueName: "Quiet Study Cafe",
        category: "Cafe",
        managerEmail: "owner@quietcafe.com",
        totalBookings: 15,
        totalRevenue: 450.0,
        currency: "$",
        footTrafficCount: 18,
        averageRating: 4.5,
      },
    ],
  };

  describe("generateWeeklyVenueAnalyticsCSV", () => {
    it("generates structured CSV output with headers and section metadata", () => {
      const csv = generateWeeklyVenueAnalyticsCSV(sampleData);

      expect(csv).toContain("WEEKLY VENUE ANALYTICS & FOOT-TRAFFIC REPORT");
      expect(csv).toContain("Report Window,2026-10-01 to 2026-10-08");
      expect(csv).toContain("Total Venues Reported,2");
      expect(csv).toContain("Venue ID,Venue Name,Category,Manager Email,Total Bookings,Total Revenue,Currency,Foot Traffic Check-Ins,Average Rating");
      expect(csv).toContain("venue-alpha-100,Downtown WorkHub,Coworking Space,manager@workhub.com,24,$1200.50,42,4.8");
      expect(csv).toContain("venue-beta-200,Quiet Study Cafe,Cafe,owner@quietcafe.com,15,$450.00,18,4.5");
    });

    it("handles empty venue lists gracefully", () => {
      const emptyData: WeeklyVenueAnalyticsData = {
        startDate: "2026-10-01",
        endDate: "2026-10-08",
        generatedAt: "2026-10-08T12:00:00.000Z",
        venues: [],
      };

      const csv = generateWeeklyVenueAnalyticsCSV(emptyData);
      expect(csv).toContain("Total Venues Reported,0");
      expect(csv).toContain("Venue ID,Venue Name");
    });
  });

  describe("fetchWeeklyVenueAnalyticsData", () => {
    it("aggregates venue booking revenue and foot-traffic check-ins from Prisma", async () => {
      prisma.venue.findMany.mockResolvedValue([
        {
          id: "venue-1",
          name: "Innovation Loft",
          category: "Coworking Space",
          rating: 4.9,
          creator: { email: "creator@loft.com", firstName: "Alex", lastName: "Rivera" },
          bookings: [
            { id: "b1", totalAmount: 100.0, currency: "$" },
            { id: "b2", totalAmount: 150.5, currency: "$" },
          ],
          checkIns: [{ id: "c1" }, { id: "c2" }, { id: "c3" }],
          ratings: [{ rating: 5.0 }, { rating: 4.8 }],
        },
      ]);

      const result = await fetchWeeklyVenueAnalyticsData();

      expect(result.venues).toHaveLength(1);
      const v = result.venues[0];
      expect(v.venueId).toBe("venue-1");
      expect(v.venueName).toBe("Innovation Loft");
      expect(v.managerEmail).toBe("creator@loft.com");
      expect(v.totalBookings).toBe(2);
      expect(v.totalRevenue).toBe(250.5);
      expect(v.footTrafficCount).toBe(3);
      expect(v.averageRating).toBe(4.9);
    });
  });

  describe("sendWeeklyVenueAnalyticsEmail", () => {
    it("creates transporter and sends email with CSV attachment via Nodemailer", async () => {
      const sendMailMock = jest.fn().mockResolvedValue({ messageId: "msg-789" });
      nodemailer.createTransport.mockReturnValue({ sendMail: sendMailMock });

      const res = await sendWeeklyVenueAnalyticsEmail(sampleData, "manager@workhub.com");

      expect(res.success).toBe(true);
      expect(res.recipient).toBe("manager@workhub.com");
      expect(sendMailMock).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "manager@workhub.com",
          subject: expect.stringContaining("Weekly Venue Analytics & Revenue Report"),
          attachments: [
            expect.objectContaining({
              filename: expect.stringContaining("weekly-venue-analytics"),
              contentType: "text/csv; charset=utf-8",
            }),
          ],
        }),
      );
    });

    it("skips email sending if SMTP environment credentials are missing", async () => {
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;

      const res = await sendWeeklyVenueAnalyticsEmail(sampleData);
      expect(res.success).toBe(false);
    });
  });

  describe("processWeeklyVenueAnalyticsJob", () => {
    it("executes full export job returning aggregated CSV and email dispatch status", async () => {
      prisma.venue.findMany.mockResolvedValue([]);
      const sendMailMock = jest.fn().mockResolvedValue({ messageId: "msg-job-123" });
      nodemailer.createTransport.mockReturnValue({ sendMail: sendMailMock });

      const result = await processWeeklyVenueAnalyticsJob({
        recipientEmail: "admin@worksphere.app",
      });

      expect(result.success).toBe(true);
      expect(result.csvContent).toContain("WEEKLY VENUE ANALYTICS");
      expect(result.emailSent).toBe(true);
      expect(result.recipient).toBe("admin@worksphere.app");
    });
  });
});
