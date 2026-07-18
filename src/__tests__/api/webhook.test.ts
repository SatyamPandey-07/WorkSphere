import { POST } from "@/app/api/webhook/route";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

jest.mock("svix", () => {
  return {
    Webhook: jest.fn().mockImplementation(() => {
      return {
        verify: jest.fn().mockImplementation((body) => JSON.parse(body)),
      };
    }),
  };
});

jest.mock("next/headers", () => ({
  headers: jest.fn().mockImplementation(async () => {
    const getMock = jest.fn().mockImplementation((key: string) => {
      if (key === "svix-id") return "msg_123";
      if (key === "svix-timestamp") return "123456789";
      if (key === "svix-signature") return "sig_123";
      return null;
    });
    return {
      get: getMock,
    };
  }),
}));

describe("POST /api/webhook - Clerk User Sync", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WEBHOOK_SECRET = "test_secret";
  });

  it("should process user.created with a fully populated user profile", async () => {
    const payload = {
      type: "user.created",
      data: {
        id: "user_123",
        first_name: "John",
        last_name: "Doe",
        image_url: "https://example.com/avatar.jpg",
        primary_email_address_id: "email_1",
        email_addresses: [{ id: "email_1", email_address: "john@example.com" }],
      },
    };

    const req = new Request("http://localhost/api/webhook", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    const response = await POST(req);
    expect(response.status).toBe(200);

    expect(prisma.user.upsert).toHaveBeenCalledWith({
      where: { id: "user_123" },
      update: {
        email: "john@example.com",
        firstName: "John",
        lastName: "Doe",
        imageUrl: "https://example.com/avatar.jpg",
      },
      create: {
        id: "user_123",
        email: "john@example.com",
        firstName: "John",
        lastName: "Doe",
        imageUrl: "https://example.com/avatar.jpg",
      },
    });
  });

  it("should handle user.created gracefully when login cancellation results in undefined email_addresses or profile details", async () => {
    // Under oauth cancellation, the user metadata returned from Clerk can have undefined email_addresses
    const payload = {
      type: "user.created",
      data: {
        id: "user_crashed",
        first_name: undefined,
        last_name: undefined,
        image_url: undefined,
        email_addresses: undefined, // undefined profile
      },
    };

    const req = new Request("http://localhost/api/webhook", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    const response = await POST(req);
    expect(response.status).toBe(200);

    expect(prisma.user.upsert).toHaveBeenCalledWith({
      where: { id: "user_crashed" },
      update: {
        email: null,
        firstName: null,
        lastName: null,
        imageUrl: expect.stringContaining("ui-avatars.com"),
      },
      create: {
        id: "user_crashed",
        email: null,
        firstName: null,
        lastName: null,
        imageUrl: expect.stringContaining("ui-avatars.com"),
      },
    });
  });

  it("should process user.updated idempotently using upsert", async () => {
    const payload = {
      type: "user.updated",
      data: {
        id: "user_123",
        first_name: "Jane",
        last_name: "Doe",
        image_url: "https://example.com/new_avatar.jpg",
        email_addresses: [{ id: "email_2", email_address: "jane@example.com" }],
      },
    };

    const req = new Request("http://localhost/api/webhook", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    const response = await POST(req);
    expect(response.status).toBe(200);

    expect(prisma.user.upsert).toHaveBeenCalledWith({
      where: { id: "user_123" },
      update: {
        email: "jane@example.com",
        firstName: "Jane",
        lastName: "Doe",
        imageUrl: "https://example.com/new_avatar.jpg",
      },
      create: {
        id: "user_123",
        email: "jane@example.com",
        firstName: "Jane",
        lastName: "Doe",
        imageUrl: "https://example.com/new_avatar.jpg",
      },
    });
  });

  it("should process user.deleted using deleteMany for safe silent deletion", async () => {
    const payload = {
      type: "user.deleted",
      data: {
        id: "user_123",
      },
    };

    const req = new Request("http://localhost/api/webhook", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    const response = await POST(req);
    expect(response.status).toBe(200);

    expect(prisma.user.deleteMany).toHaveBeenCalledWith({
      where: { id: "user_123" },
    });
  });
});
