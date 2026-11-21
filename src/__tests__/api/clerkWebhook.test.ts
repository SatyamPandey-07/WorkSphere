import { POST } from "@/app/api/webhooks/clerk/route";
import { prisma } from "@/lib/prisma";
import { Webhook as StandardWebhook } from "standardwebhooks";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

describe("Clerk Webhook Handler & Verification", () => {
  const TEST_SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      CLERK_WEBHOOK_SIGNING_SECRET: TEST_SECRET,
    };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  function createSignedRequest(
    payloadObj: any,
    options?: {
      id?: string;
      timestamp?: Date | number;
      secret?: string;
      omitId?: boolean;
      omitTimestamp?: boolean;
      omitSignature?: boolean;
      customSignature?: string;
      rawBodyOverride?: string;
    },
  ) {
    const rawBody =
      options?.rawBodyOverride !== undefined
        ? options.rawBodyOverride
        : JSON.stringify(payloadObj);
    const id = options?.id || "msg_test_123";
    const ts =
      options?.timestamp instanceof Date
        ? options.timestamp
        : typeof options?.timestamp === "number"
          ? new Date(options.timestamp * 1000)
          : new Date();

    const wh = new StandardWebhook(options?.secret || TEST_SECRET);
    const signature =
      options?.customSignature || wh.sign(id, ts, rawBody);

    const headers: Record<string, string> = {};
    if (!options?.omitId) {
      headers["svix-id"] = id;
    }
    if (!options?.omitTimestamp) {
      headers["svix-timestamp"] = String(Math.floor(ts.getTime() / 1000));
    }
    if (!options?.omitSignature) {
      headers["svix-signature"] = signature;
    }

    return new Request("http://localhost:3000/api/webhooks/clerk", {
      method: "POST",
      headers,
      body: rawBody,
    });
  }

  describe("Signature verification & security", () => {
    it("1. accepts a request with a valid Svix signature", async () => {
      const payload = {
        type: "user.created",
        data: {
          id: "user_valid_sig",
          first_name: "Jane",
          last_name: "Doe",
          primary_email_address_id: "email_1",
          email_addresses: [
            { id: "email_1", email_address: "jane@example.com" },
          ],
        },
      };

      const req = createSignedRequest(payload);
      const res = await POST(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.action).toBe("created");
      expect(prisma.user.upsert).toHaveBeenCalledTimes(1);
    });

    it("2. rejects request when svix-id header is missing", async () => {
      const payload = { type: "user.created", data: { id: "user_test" } };
      const req = createSignedRequest(payload, { omitId: true });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/Missing required Svix signature headers/i);
      expect(prisma.user.upsert).not.toHaveBeenCalled();
      expect(prisma.user.deleteMany).not.toHaveBeenCalled();
    });

    it("3. rejects request when svix-timestamp header is missing", async () => {
      const payload = { type: "user.created", data: { id: "user_test" } };
      const req = createSignedRequest(payload, { omitTimestamp: true });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/Missing required Svix signature headers/i);
      expect(prisma.user.upsert).not.toHaveBeenCalled();
    });

    it("4. rejects request when svix-signature header is missing", async () => {
      const payload = { type: "user.created", data: { id: "user_test" } };
      const req = createSignedRequest(payload, { omitSignature: true });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/Missing required Svix signature headers/i);
      expect(prisma.user.upsert).not.toHaveBeenCalled();
    });

    it("5. rejects invalid signatures", async () => {
      const payload = { type: "user.created", data: { id: "user_test" } };
      const req = createSignedRequest(payload, {
        customSignature: "v1,invalid_signature_bytes_12345",
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/Invalid webhook signature/i);
      expect(prisma.user.upsert).not.toHaveBeenCalled();
    });

    it("6. rejects stale/replayed timestamps", async () => {
      const payload = { type: "user.created", data: { id: "user_test" } };
      // 10 minutes in the past
      const staleTimestamp = new Date(Date.now() - 10 * 60 * 1000);
      const req = createSignedRequest(payload, {
        timestamp: staleTimestamp,
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/Invalid webhook signature/i);
      expect(prisma.user.upsert).not.toHaveBeenCalled();
    });

    it("7. handles malformed JSON safely without throwing", async () => {
      const malformedBody = "{ invalid json payload: ...";
      const id = "msg_malformed";
      const ts = new Date();
      const wh = new StandardWebhook(TEST_SECRET);
      const sig = wh.sign(id, ts, malformedBody);

      const req = new Request("http://localhost:3000/api/webhooks/clerk", {
        method: "POST",
        headers: {
          "svix-id": id,
          "svix-timestamp": String(Math.floor(ts.getTime() / 1000)),
          "svix-signature": sig,
        },
        body: malformedBody,
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/Invalid JSON in webhook payload/i);
      expect(prisma.user.upsert).not.toHaveBeenCalled();
    });

    it("8. ensures no Prisma operation occurs when signature verification fails", async () => {
      const payload = {
        type: "user.created",
        data: { id: "user_unauthorized" },
      };
      // Signed with a different secret
      const req = createSignedRequest(payload, {
        secret: "whsec_AnotherWrongSecret12345678901234",
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
      expect(prisma.user.upsert).not.toHaveBeenCalled();
      expect(prisma.user.deleteMany).not.toHaveBeenCalled();
    });

    it("returns 500 when webhook signing secret is not configured", async () => {
      delete process.env.CLERK_WEBHOOK_SIGNING_SECRET;
      delete process.env.CLERK_WEBHOOK_SECRET;
      delete process.env.WEBHOOK_SECRET;

      const payload = { type: "user.created", data: { id: "user_test" } };
      const req = createSignedRequest(payload);
      const res = await POST(req);

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toMatch(/Webhook signing secret is not configured/i);
      expect(prisma.user.upsert).not.toHaveBeenCalled();
    });
  });

  describe("Event handling & user synchronization", () => {
    it("9. user.created creates or upserts the user with correct fields", async () => {
      const payload = {
        type: "user.created",
        data: {
          id: "user_alice",
          first_name: "Alice",
          last_name: "Smith",
          image_url: "https://img.clerk.com/alice?sz=300",
          primary_email_address_id: "email_alice_1",
          email_addresses: [
            { id: "email_alice_1", email_address: "alice@example.com" },
            { id: "email_alice_2", email_address: "alice.work@example.com" },
          ],
        },
      };

      (prisma.user.upsert as jest.Mock).mockResolvedValue({
        id: "user_alice",
        email: "alice@example.com",
        firstName: "Alice",
        lastName: "Smith",
        imageUrl: "https://img.clerk.com/alice?sz=150",
      });

      const req = createSignedRequest(payload);
      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(prisma.user.upsert).toHaveBeenCalledWith({
        where: { id: "user_alice" },
        update: {
          email: "alice@example.com",
          firstName: "Alice",
          lastName: "Smith",
          imageUrl: "https://img.clerk.com/alice?sz=150",
        },
        create: {
          id: "user_alice",
          email: "alice@example.com",
          firstName: "Alice",
          lastName: "Smith",
          imageUrl: "https://img.clerk.com/alice?sz=150",
        },
      });
    });

    it("10. user.updated synchronizes profile changes", async () => {
      const payload = {
        type: "user.updated",
        data: {
          id: "user_alice",
          first_name: "Alice",
          last_name: "Johnson",
          image_url: "https://img.clerk.com/new_avatar",
          primary_email_address_id: "email_alice_2",
          email_addresses: [
            { id: "email_alice_1", email_address: "alice@example.com" },
            { id: "email_alice_2", email_address: "alice.johnson@example.com" },
          ],
        },
      };

      (prisma.user.upsert as jest.Mock).mockResolvedValue({
        id: "user_alice",
        email: "alice.johnson@example.com",
        firstName: "Alice",
        lastName: "Johnson",
        imageUrl: "https://img.clerk.com/new_avatar",
      });

      const req = createSignedRequest(payload);
      const res = await POST(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.action).toBe("updated");
      expect(prisma.user.upsert).toHaveBeenCalledWith({
        where: { id: "user_alice" },
        update: {
          email: "alice.johnson@example.com",
          firstName: "Alice",
          lastName: "Johnson",
          imageUrl: "https://img.clerk.com/new_avatar",
        },
        create: {
          id: "user_alice",
          email: "alice.johnson@example.com",
          firstName: "Alice",
          lastName: "Johnson",
          imageUrl: "https://img.clerk.com/new_avatar",
        },
      });
    });

    it("11. correctly resolves primary email using primary_email_address_id against email_addresses list", async () => {
      const payload = {
        type: "user.created",
        data: {
          id: "user_multi_email",
          first_name: "Bob",
          last_name: "Ross",
          primary_email_address_id: "email_target",
          email_addresses: [
            { id: "email_other", email_address: "other@example.com" },
            { id: "email_target", email_address: "primary@example.com" },
          ],
        },
      };

      const req = createSignedRequest(payload);
      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(prisma.user.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            email: "primary@example.com",
          }),
        }),
      );
    });

    it("12. handles missing primary email safely (fallback to first or null)", async () => {
      // Case A: primary_email_address_id unmatched, falls back to first email
      const payloadFallback = {
        type: "user.created",
        data: {
          id: "user_fallback",
          first_name: "Charlie",
          last_name: "Brown",
          primary_email_address_id: "non_existent_id",
          email_addresses: [
            { id: "email_only", email_address: "first@example.com" },
          ],
        },
      };

      const reqA = createSignedRequest(payloadFallback);
      await POST(reqA);

      expect(prisma.user.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            email: "first@example.com",
          }),
        }),
      );

      // Case B: empty or missing email_addresses array
      const payloadNoEmails = {
        type: "user.created",
        data: {
          id: "user_no_email",
          first_name: "Charlie",
          last_name: "Brown",
          email_addresses: [],
        },
      };

      const reqB = createSignedRequest(payloadNoEmails);
      await POST(reqB);

      expect(prisma.user.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            email: null,
          }),
        }),
      );
    });

    it("13. handles missing optional profile fields with fallback avatar", async () => {
      const payload = {
        type: "user.created",
        data: {
          id: "user_minimal",
          first_name: null,
          last_name: null,
          image_url: null,
          email_addresses: null,
        },
      };

      const req = createSignedRequest(payload);
      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(prisma.user.upsert).toHaveBeenCalledWith({
        where: { id: "user_minimal" },
        update: {
          email: null,
          firstName: null,
          lastName: null,
          imageUrl:
            "https://ui-avatars.com/api/?name=WS&background=6366f1&color=fff",
        },
        create: {
          id: "user_minimal",
          email: null,
          firstName: null,
          lastName: null,
          imageUrl:
            "https://ui-avatars.com/api/?name=WS&background=6366f1&color=fff",
        },
      });
    });

    it("14. user.deleted deletes user using deleteMany", async () => {
      const payload = {
        type: "user.deleted",
        data: {
          id: "user_to_delete",
          deleted: true,
        },
      };

      (prisma.user.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });

      const req = createSignedRequest(payload);
      const res = await POST(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.action).toBe("deleted");
      expect(json.userId).toBe("user_to_delete");
      expect(prisma.user.deleteMany).toHaveBeenCalledWith({
        where: { id: "user_to_delete" },
      });
    });

    it("15. repeated deletion is handled idempotently without error", async () => {
      const payload = {
        type: "user.deleted",
        data: {
          id: "user_already_deleted",
          deleted: true,
        },
      };

      // Mock zero rows affected on repeat
      (prisma.user.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });

      const req = createSignedRequest(payload);
      const res = await POST(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.action).toBe("deleted");
      expect(prisma.user.deleteMany).toHaveBeenCalledWith({
        where: { id: "user_already_deleted" },
      });
    });

    it("16. unknown event types are handled safely without database operations", async () => {
      const payload = {
        type: "organization.created",
        data: {
          id: "org_123",
          name: "Acme Corp",
        },
      };

      const req = createSignedRequest(payload);
      const res = await POST(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.action).toBe("ignored");
      expect(json.eventType).toBe("organization.created");
      expect(prisma.user.upsert).not.toHaveBeenCalled();
      expect(prisma.user.deleteMany).not.toHaveBeenCalled();
    });

    it("17. database errors produce safe error responses without leaking internal details", async () => {
      const payload = {
        type: "user.created",
        data: {
          id: "user_db_fail",
          first_name: "Error",
          email_addresses: [{ id: "e1", email_address: "err@example.com" }],
        },
      };

      (prisma.user.upsert as jest.Mock).mockRejectedValue(
        new Error("Fatal connection failure to Postgres: connection refused at 10.0.0.1"),
      );

      const req = createSignedRequest(payload);
      const res = await POST(req);

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe("Failed to process user synchronization");
      expect(JSON.stringify(json)).not.toContain("Postgres");
      expect(JSON.stringify(json)).not.toContain("10.0.0.1");
    });

    it("18. duplicate deliveries do not create duplicate users (idempotent upsert)", async () => {
      const payload = {
        type: "user.created",
        data: {
          id: "user_duplicate",
          first_name: "Dup",
          last_name: "Licat",
          email_addresses: [{ id: "e1", email_address: "dup@example.com" }],
        },
      };

      (prisma.user.upsert as jest.Mock).mockResolvedValue({
        id: "user_duplicate",
        email: "dup@example.com",
        firstName: "Dup",
        lastName: "Licat",
        imageUrl: "https://ui-avatars.com/api/?name=DL&background=6366f1&color=fff",
      });

      const req1 = createSignedRequest(payload, { id: "msg_dup_1" });
      const res1 = await POST(req1);
      expect(res1.status).toBe(200);

      const req2 = createSignedRequest(payload, { id: "msg_dup_2" });
      const res2 = await POST(req2);
      expect(res2.status).toBe(200);

      expect(prisma.user.upsert).toHaveBeenCalledTimes(2);
      expect(prisma.user.upsert).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ where: { id: "user_duplicate" } }),
      );
      expect(prisma.user.upsert).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ where: { id: "user_duplicate" } }),
      );
    });
  });
});
