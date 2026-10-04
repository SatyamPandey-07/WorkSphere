import {
  isWithinQuietHours,
  isUserInQuietHours,
  sendPushNotification,
  sendVenueAvailabilityNotification,
} from "@/lib/pushNotifications";
import { sendPushNotification as pushFromAlias } from "@/lib/push";
import { prisma } from "@/lib/prisma";
import webPush from "web-push";

jest.mock("web-push", () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn().mockResolvedValue({}),
  generateVAPIDKeys: jest.fn().mockReturnValue({
    publicKey: "mock-pub",
    privateKey: "mock-priv",
  }),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    pushSubscription: {
      findMany: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    pushNotificationLog: {
      create: jest.fn(),
    },
    favorite: {
      findMany: jest.fn(),
    },
  },
}));

describe("Configurable Quiet Hours for Push Notifications", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "test-pub-key";
    process.env.VAPID_PRIVATE_KEY = "test-priv-key";
  });

  describe("isWithinQuietHours helper", () => {
    it("returns false if start or end is not provided", () => {
      const now = new Date("2026-10-02T14:00:00Z");
      expect(isWithinQuietHours(now, null, "08:00", "UTC")).toBe(false);
      expect(isWithinQuietHours(now, "22:00", null, "UTC")).toBe(false);
      expect(isWithinQuietHours(now, "", "", "UTC")).toBe(false);
    });

    it("evaluates daytime quiet window correctly", () => {
      // 13:00 to 15:00 UTC
      const during = new Date("2026-10-02T14:15:00Z");
      const before = new Date("2026-10-02T12:59:00Z");
      const after = new Date("2026-10-02T15:01:00Z");

      expect(isWithinQuietHours(during, "13:00", "15:00", "UTC")).toBe(true);
      expect(isWithinQuietHours(before, "13:00", "15:00", "UTC")).toBe(false);
      expect(isWithinQuietHours(after, "13:00", "15:00", "UTC")).toBe(false);
    });

    it("evaluates overnight quiet window correctly (e.g. 22:00 to 07:00)", () => {
      const lateNight = new Date("2026-10-02T23:30:00Z");
      const earlyMorning = new Date("2026-10-02T04:15:00Z");
      const midday = new Date("2026-10-02T14:00:00Z");

      expect(isWithinQuietHours(lateNight, "22:00", "07:00", "UTC")).toBe(true);
      expect(isWithinQuietHours(earlyMorning, "22:00", "07:00", "UTC")).toBe(true);
      expect(isWithinQuietHours(midday, "22:00", "07:00", "UTC")).toBe(false);
    });

    it("supports 12-hour AM/PM string formats", () => {
      const night = new Date("2026-10-02T23:00:00Z");
      const morning = new Date("2026-10-02T06:30:00Z");
      const afternoon = new Date("2026-10-02T15:00:00Z");

      expect(isWithinQuietHours(night, "10:00 PM", "7:00 AM", "UTC")).toBe(true);
      expect(isWithinQuietHours(morning, "10:00 PM", "7:00 AM", "UTC")).toBe(true);
      expect(isWithinQuietHours(afternoon, "10:00 PM", "7:00 AM", "UTC")).toBe(false);
    });

    it("correctly respects user timezone offsets", () => {
      // 14:00 UTC = 10:00 EDT (America/New_York)
      const date = new Date("2026-10-02T14:00:00Z");

      // In New York, 10:00 is within 09:00 - 11:00
      expect(
        isWithinQuietHours(date, "09:00", "11:00", "America/New_York"),
      ).toBe(true);

      // In New York, 10:00 is outside 12:00 - 18:00
      expect(
        isWithinQuietHours(date, "12:00", "18:00", "America/New_York"),
      ).toBe(false);
    });
  });

  describe("isUserInQuietHours helper", () => {
    it("returns false if user object is null or undefined", () => {
      expect(isUserInQuietHours(new Date(), null)).toBe(false);
    });

    it("uses quietHoursStart and quietHoursEnd when configured", () => {
      const now = new Date("2026-10-02T23:00:00Z");
      const user = {
        quietHoursStart: "22:00",
        quietHoursEnd: "07:00",
        timezone: "UTC",
      };
      expect(isUserInQuietHours(now, user)).toBe(true);
    });

    it("falls back to allowed notification window (notificationStart/End) when quiet hours are not set", () => {
      // 23:00 UTC is outside active window 09:00-18:00, so it is treated as quiet hours
      const now = new Date("2026-10-02T23:00:00Z");
      const user = {
        notificationStart: "09:00",
        notificationEnd: "18:00",
        timezone: "UTC",
      };
      expect(isUserInQuietHours(now, user)).toBe(true);

      // 12:00 UTC is within active window, so it is NOT quiet hours
      const noon = new Date("2026-10-02T12:00:00Z");
      expect(isUserInQuietHours(noon, user)).toBe(false);
    });
  });

  describe("sendPushNotification quiet hours enforcement", () => {
    const userId = "user-test-quiet";

    it("suppresses and defers non-critical notifications during quiet hours", async () => {
      const currentTime = new Date("2026-10-02T23:30:00Z").getTime();
      const dateSpy = jest.spyOn(Date, "now").mockImplementation(() => currentTime);
      const originalDate = global.Date;

      // Mock user in quiet hours
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: userId,
        quietHoursStart: "22:00",
        quietHoursEnd: "07:00",
        timezone: "UTC",
      });

      const result = await sendPushNotification(userId, {
        title: "Venue Deal!",
        body: "Check out this desk deal tonight.",
      });

      expect(result.suppressed).toBe(true);
      expect(result.deferred).toBe(true);
      expect(result.sent).toBe(0);
      expect(result.reason).toBe("QUIET_HOURS");

      // Verify log entry was created with DEFERRED_QUIET_HOURS
      expect(prisma.pushNotificationLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId,
          status: "DEFERRED_QUIET_HOURS",
          error: "Notification suppressed during user quiet hours",
        }),
      });

      // Verify webPush.sendNotification was NOT called
      expect(webPush.sendNotification).not.toHaveBeenCalled();

      dateSpy.mockRestore();
    });

    it("allows critical notifications to bypass quiet hours", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: userId,
        quietHoursStart: "22:00",
        quietHoursEnd: "07:00",
        timezone: "UTC",
      });

      (prisma.pushSubscription.findMany as jest.Mock).mockResolvedValue([
        {
          id: "sub-1",
          endpoint: "https://push.example.com/sub-1",
          p256dh: "key-1",
          auth: "auth-1",
        },
      ]);

      const result = await sendPushNotification(
        userId,
        {
          title: "Urgent Booking Alert",
          body: "Your reservation was cancelled by venue staff.",
          isCritical: true,
        },
      );

      expect(result.suppressed).toBe(false);
      expect(result.sent).toBe(1);
      expect(webPush.sendNotification).toHaveBeenCalledTimes(1);
    });

    it("allows options.force or options.ignoreQuietHours to bypass quiet hours", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: userId,
        quietHoursStart: "22:00",
        quietHoursEnd: "07:00",
        timezone: "UTC",
      });

      (prisma.pushSubscription.findMany as jest.Mock).mockResolvedValue([
        {
          id: "sub-2",
          endpoint: "https://push.example.com/sub-2",
          p256dh: "key-2",
          auth: "auth-2",
        },
      ]);

      const result = await pushFromAlias(
        userId,
        {
          title: "Security Code",
          body: "Your verification passcode.",
        },
        { ignoreQuietHours: true },
      );

      expect(result.suppressed).toBe(false);
      expect(result.sent).toBe(1);
      expect(webPush.sendNotification).toHaveBeenCalledTimes(1);
    });

    it("dispatches notifications normally when user is outside quiet hours", async () => {
      // 14:00 UTC is outside 22:00-07:00
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: userId,
        quietHoursStart: "22:00",
        quietHoursEnd: "07:00",
        timezone: "UTC",
      });

      (prisma.pushSubscription.findMany as jest.Mock).mockResolvedValue([
        {
          id: "sub-3",
          endpoint: "https://push.example.com/sub-3",
          p256dh: "key-3",
          auth: "auth-3",
        },
      ]);

      const afternoonTime = new Date("2026-10-02T14:00:00Z").getTime();
      const dateSpy = jest.spyOn(Date, "now").mockImplementation(() => afternoonTime);

      const result = await sendPushNotification(userId, {
        title: "Coworking Session",
        body: "A friend joined your session.",
      });

      expect(result.suppressed).toBe(false);
      expect(result.sent).toBe(1);
      expect(webPush.sendNotification).toHaveBeenCalledTimes(1);

      dateSpy.mockRestore();
    });
  });

  describe("sendVenueAvailabilityNotification", () => {
    it("suppresses seat availability push for users in quiet hours", async () => {
      (prisma.favorite.findMany as jest.Mock).mockResolvedValue([
        { userId: "user-quiet-fav" },
      ]);

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: "user-quiet-fav",
        quietHoursStart: "20:00",
        quietHoursEnd: "08:00",
        timezone: "UTC",
      });

      const nightTime = new Date("2026-10-02T22:00:00Z").getTime();
      const dateSpy = jest.spyOn(Date, "now").mockImplementation(() => nightTime);

      await sendVenueAvailabilityNotification("venue-123", "Quiet Cafe", 3);

      expect(webPush.sendNotification).not.toHaveBeenCalled();
      expect(prisma.pushNotificationLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "user-quiet-fav",
          status: "DEFERRED_QUIET_HOURS",
        }),
      });

      dateSpy.mockRestore();
    });
  });
});
