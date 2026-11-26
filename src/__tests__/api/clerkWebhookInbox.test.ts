import { POST } from "@/app/api/webhooks/clerk/route";
import { prisma } from "@/lib/prisma";
import {
  ClerkWebhookInbox,
  defaultClerkWebhookInbox,
  hashWebhookPayload,
} from "@/lib/auth/clerkWebhookInbox";
import { Webhook as StandardWebhook } from "standardwebhooks";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

describe("ClerkWebhookInbox & lifecycle ordering (#10689)", () => {
  const TEST_SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    defaultClerkWebhookInbox.clear();
    process.env = {
      ...ORIGINAL_ENV,
      CLERK_WEBHOOK_SIGNING_SECRET: TEST_SECRET,
    };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  function createSignedReq(payloadObj: Record<string, unknown>, id: string) {
    const rawBody = JSON.stringify(payloadObj);
    const ts = new Date();
    const wh = new StandardWebhook(TEST_SECRET);
    const sig = wh.sign(id, ts, rawBody);
    return new Request("http://localhost:3000/api/webhooks/clerk", {
      method: "POST",
      headers: {
        "svix-id": id,
        "svix-timestamp": String(Math.floor(ts.getTime() / 1000)),
        "svix-signature": sig,
      },
      body: rawBody,
    });
  }

  it("deduplicates replayed Svix message IDs without repeating DB mutations", async () => {
    const payload = {
      type: "user.created",
      data: {
        id: "user_replay_1",
        first_name: "Alice",
        email_addresses: [{ id: "e1", email_address: "alice@example.com" }],
        created_at: 1_700_000_000_000,
      },
    };
    (prisma.user.upsert as jest.Mock).mockResolvedValue({ id: "user_replay_1" });

    const res1 = await POST(createSignedReq(payload, "msg_replay_1"));
    expect(res1.status).toBe(200);

    const res2 = await POST(createSignedReq(payload, "msg_replay_1"));
    expect(res2.status).toBe(200);
    const json2 = await res2.json();
    expect(json2.idempotent).toBe(true);
    expect(prisma.user.upsert).toHaveBeenCalledTimes(1);
  });

  it("prevents stale user.updated / user.created from resurrecting a deleted user", async () => {
    (prisma.user.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });

    const delRes = await POST(
      createSignedReq(
        {
          type: "user.deleted",
          data: { id: "user_tomb_1", updated_at: 2_000_000 },
        },
        "msg_del_1",
      ),
    );
    expect(delRes.status).toBe(200);

    const staleUpdateRes = await POST(
      createSignedReq(
        {
          type: "user.updated",
          data: {
            id: "user_tomb_1",
            first_name: "Ghost",
            updated_at: 1_999_000,
          },
        },
        "msg_stale_upd_1",
      ),
    );
    const staleJson = await staleUpdateRes.json();
    expect(staleJson.action).toBe("ignored");
    expect(staleJson.reason).toBe("user_tombstoned");
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });

  it("ignores older user.updated events arriving after a newer update", async () => {
    (prisma.user.upsert as jest.Mock).mockResolvedValue({ id: "user_ord_1" });

    await POST(
      createSignedReq(
        {
          type: "user.updated",
          data: { id: "user_ord_1", first_name: "New", updated_at: 5_000 },
        },
        "msg_ord_new",
      ),
    );

    const olderRes = await POST(
      createSignedReq(
        {
          type: "user.updated",
          data: { id: "user_ord_1", first_name: "Old", updated_at: 4_000 },
        },
        "msg_ord_old",
      ),
    );
    const olderJson = await olderRes.json();
    expect(olderJson.action).toBe("ignored");
    expect(olderJson.reason).toBe("stale_event");
    expect(prisma.user.upsert).toHaveBeenCalledTimes(1);
  });

  it("allows safe retry on transient failure and quarantines after max attempts", async () => {
    const payload = {
      type: "user.created",
      data: { id: "user_retry_1", first_name: "Retry", created_at: 1000 },
    };

    (prisma.user.upsert as jest.Mock)
      .mockRejectedValueOnce(new Error("transient db error"))
      .mockResolvedValueOnce({ id: "user_retry_1" });

    const r1 = await POST(createSignedReq(payload, "msg_retry_1"));
    expect(r1.status).toBe(500);

    const r2 = await POST(createSignedReq(payload, "msg_retry_1"));
    expect(r2.status).toBe(200);
    const j2 = await r2.json();
    expect(j2.action).toBe("created");
    expect(prisma.user.upsert).toHaveBeenCalledTimes(2);
  });

  it("reconciles stuck PROCESSING inbox records and enforces quarantine limit", () => {
    let now = 10_000;
    const inbox = new ClerkWebhookInbox({
      maxAttempts: 2,
      processingLeaseMs: 5_000,
      nowFn: () => now,
    });
    const hash = hashWebhookPayload("{}");

    const c1 = inbox.claim({
      svixId: "svix_1",
      eventType: "user.updated",
      subjectId: "u1",
      eventTimestampMs: 100,
      payloadHash: hash,
    });
    expect(c1.kind).toBe("CLAIMED");

    // Concurrent claim while lease is active
    const concurrent = inbox.claim({
      svixId: "svix_1",
      eventType: "user.updated",
      subjectId: "u1",
      eventTimestampMs: 100,
      payloadHash: hash,
    });
    expect(concurrent.kind).toBe("IN_FLIGHT");

    // Advance past lease duration and reconcile
    now += 6_000;
    const stuck = inbox.reconcileStuckRecords();
    expect(stuck).toHaveLength(1);
    expect(stuck[0].status).toBe("FAILED");

    // Second attempt fails permanently -> quarantined
    const c2 = inbox.claim({
      svixId: "svix_1",
      eventType: "user.updated",
      subjectId: "u1",
      eventTimestampMs: 100,
      payloadHash: hash,
    });
    expect(c2.kind).toBe("CLAIMED");
    inbox.markFailed("svix_1", "bad payload", false);
    expect(inbox.getQuarantinedRecords()).toHaveLength(1);
  });
});
