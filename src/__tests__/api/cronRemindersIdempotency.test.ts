import { POST } from "@/app/api/cron/reminders/route";
import { prisma } from "@/lib/prisma";
import nodemailer from "nodemailer";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    coworkingSession: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock("@/lib/partitionMaintenance", () => ({
  autoCreateUpcomingPartitions: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("nodemailer", () => ({
  createTransport: jest.fn(),
}));

jest.mock("twilio", () => jest.fn());

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();

jest.mock("@upstash/redis", () => {
  return {
    Redis: {
      fromEnv: jest.fn(() => ({
        get: (...args: any[]) => mockRedisGet(...args),
        set: (...args: any[]) => mockRedisSet(...args),
      })),
    },
  };
});

jest.mock("@/lib/notificationWindow", () => ({
  isWithinNotificationWindow: jest.fn().mockReturnValue(true),
}));

describe("POST /api/cron/reminders - Per-Recipient Idempotency", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      CRON_SECRET: "test-cron-secret",
      SMTP_USER: "test@worksphere.com",
      SMTP_PASS: "password123",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns 401 if authorization header is invalid", async () => {
    const req = new Request("http://localhost/api/cron/reminders", {
      method: "POST",
      headers: { authorization: "Bearer wrong-secret" },
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("dispatches notifications per-recipient and sets Redis key ONLY AFTER successful dispatch", async () => {
    const mockSendMail = jest.fn().mockResolvedValue({ messageId: "msg-1" });
    (nodemailer.createTransport as jest.Mock).mockReturnValue({
      sendMail: mockSendMail,
    });

    const mockSession = {
      id: "session-1",
      title: "Design Sync",
      startsAt: new Date(Date.now() + 15 * 60 * 1000),
      venue: { id: "v1", name: "Central Hub", latitude: 10, longitude: 20 },
      host: {
        id: "host-1",
        email: "host@worksphere.com",
        firstName: "Alice",
        lastName: "Smith",
      },
      rsvps: [
        {
          user: {
            id: "user-2",
            email: "rsvp@worksphere.com",
            firstName: "Bob",
            lastName: "Jones",
          },
        },
      ],
    };

    (prisma.coworkingSession.findMany as jest.Mock).mockResolvedValue([
      mockSession,
    ]);
    mockRedisGet.mockResolvedValue(null);

    const req = new Request("http://localhost/api/cron/reminders", {
      method: "POST",
      headers: { authorization: "Bearer test-cron-secret" },
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.emailsSent).toBe(2);

    // Verify per-recipient Redis keys were checked
    expect(mockRedisGet).toHaveBeenCalledWith(
      "session-reminder:session-1:host@worksphere.com",
    );
    expect(mockRedisGet).toHaveBeenCalledWith(
      "session-reminder:session-1:rsvp@worksphere.com",
    );

    // Verify Redis key setting occurred post-dispatch
    expect(mockRedisSet).toHaveBeenCalledWith(
      "session-reminder:session-1:host@worksphere.com",
      "sent",
      { ex: 3600 },
    );
    expect(mockRedisSet).toHaveBeenCalledWith(
      "session-reminder:session-1:rsvp@worksphere.com",
      "sent",
      { ex: 3600 },
    );
  });

  it("retries failed recipients on subsequent runs when dispatch throws an error midway", async () => {
    const mockSendMail = jest
      .fn()
      .mockResolvedValueOnce({ messageId: "msg-1" }) // host succeeds
      .mockRejectedValueOnce(new Error("SMTP Rate limit exceeded")); // rsvp fails

    (nodemailer.createTransport as jest.Mock).mockReturnValue({
      sendMail: mockSendMail,
    });

    const mockSession = {
      id: "session-1",
      title: "Engineering Sync",
      startsAt: new Date(Date.now() + 15 * 60 * 1000),
      venue: { id: "v1", name: "Tech Lab", latitude: 10, longitude: 20 },
      host: { id: "h1", email: "host@worksphere.com" },
      rsvps: [{ user: { id: "u2", email: "rsvp@worksphere.com" } }],
    };

    (prisma.coworkingSession.findMany as jest.Mock).mockResolvedValue([
      mockSession,
    ]);
    mockRedisGet.mockResolvedValue(null);

    const req = new Request("http://localhost/api/cron/reminders", {
      method: "POST",
      headers: { authorization: "Bearer test-cron-secret" },
    });

    const res = await POST(req);
    const json = await res.json();

    expect(json.emailsSent).toBe(1);

    // Host succeeded -> Redis set called for host
    expect(mockRedisSet).toHaveBeenCalledWith(
      "session-reminder:session-1:host@worksphere.com",
      "sent",
      { ex: 3600 },
    );
    // RSVP failed -> Redis set NOT called for RSVP (enabling retry on next cron cycle)
    expect(mockRedisSet).not.toHaveBeenCalledWith(
      "session-reminder:session-1:rsvp@worksphere.com",
      "sent",
      expect.anything(),
    );
  });

  it("gracefully handles Redis exceptions without crashing the cron execution", async () => {
    const mockSendMail = jest.fn().mockResolvedValue({ messageId: "msg-1" });
    (nodemailer.createTransport as jest.Mock).mockReturnValue({
      sendMail: mockSendMail,
    });

    mockRedisGet.mockRejectedValue(new Error("Redis connection timeout"));
    mockRedisSet.mockRejectedValue(new Error("Redis connection timeout"));

    const mockSession = {
      id: "session-1",
      title: "Product Sync",
      startsAt: new Date(Date.now() + 15 * 60 * 1000),
      venue: { id: "v1", name: "Main Office", latitude: 10, longitude: 20 },
      host: { id: "h1", email: "host@worksphere.com" },
      rsvps: [],
    };

    (prisma.coworkingSession.findMany as jest.Mock).mockResolvedValue([
      mockSession,
    ]);

    const req = new Request("http://localhost/api/cron/reminders", {
      method: "POST",
      headers: { authorization: "Bearer test-cron-secret" },
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.emailsSent).toBe(1);
  });
});
