/**
 * PATCH /api/user/settings now validates values with userSettingsSchema,
 * matching POST. Auth, Prisma and validation run through mocks so only the
 * route layer is exercised.
 */

import { PATCH } from "@/app/api/user/settings/route";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn().mockResolvedValue({ userId: "user-123" }),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      upsert: jest.fn(),
    },
  },
}));

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/user/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/user/settings", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user-123" });
    (prisma.user.upsert as unknown as jest.Mock).mockResolvedValue({
      id: "user-123",
      smsAlertsEnabled: false,
    });
  });

  it("returns 401 without an authenticated session", async () => {
    (auth as unknown as jest.Mock).mockResolvedValueOnce({ userId: null });

    const res = await PATCH(makeRequest({ timezone: "UTC" }));

    expect(res.status).toBe(401);
  });

  it("returns 400 for a malformed webhook URL", async () => {
    const res = await PATCH(makeRequest({ whatsappWebhookUrl: "not-a-url" }));

    expect(res.status).toBe(400);
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });

  it("returns 400 for a time window outside HH:mm", async () => {
    const res = await PATCH(makeRequest({ notificationStart: "midnight" }));

    expect(res.status).toBe(400);
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });

  it("returns 400 for a wrongly typed flag", async () => {
    const res = await PATCH(
      makeRequest({ smsAlertsEnabled: "yes" } as unknown as Record<
        string,
        unknown
      >),
    );

    expect(res.status).toBe(400);
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });

  it("accepts a partial update with valid values", async () => {
    const res = await PATCH(
      makeRequest({ timezone: "Asia/Kolkata", smsAlertsEnabled: true }),
    );

    expect(res.status).toBe(200);
    expect(prisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-123" },
      }),
    );
    const data = await res.json();
    expect(data.success).toBe(true);
  });
});
