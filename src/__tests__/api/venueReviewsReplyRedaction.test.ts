import { NextRequest } from "next/server";
import { GET, redactReviewPayload } from "@/app/api/venues/[venueId]/reviews/route";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { swrCache } from "@/lib/cache/swrCache";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn().mockResolvedValue(true),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: {
      findFirst: jest.fn(),
    },
    venueRating: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock("@/lib/cache/swrCache", () => ({
  swrCache: jest.fn().mockImplementation((_key, fetcher) => fetcher()),
  getVenueReviewsCacheKey: jest.fn().mockReturnValue("test-key"),
}));

describe("Review and Reply Nested userId Redaction (#10457)", () => {
  const venueId = "venue-redaction-test";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const sampleReviewWithNestedReplies = {
    id: "review-1",
    userId: "user-top-level-123",
    venueId,
    comment: "Excellent coffee and fast WiFi!",
    rating: 5,
    user: {
      firstName: "John",
      lastName: "Doe",
    },
    replies: [
      {
        id: "reply-1",
        userId: "user-nested-reply-456",
        text: "Thanks for visiting us!",
        authorName: "Venue Manager",
        createdAt: "2026-05-01T10:00:00Z",
        replies: [
          {
            id: "reply-1-sub",
            userId: "user-deep-nested-789",
            text: "Will definitely return next week.",
            authorName: "John Doe",
            createdAt: "2026-05-01T11:00:00Z",
          },
        ],
      },
    ],
  };

  describe("redactReviewPayload recursive helper", () => {
    it("1. removes top-level review userId when redaction is enabled", () => {
      const redacted = redactReviewPayload(sampleReviewWithNestedReplies, true);
      expect((redacted as any).userId).toBeUndefined();
      expect(redacted.id).toBe("review-1");
      expect(redacted.comment).toBe("Excellent coffee and fast WiFi!");
    });

    it("2. removes nested reply userId while preserving reply content", () => {
      const redacted = redactReviewPayload(sampleReviewWithNestedReplies, true);
      const firstReply = redacted.replies[0];
      expect((firstReply as any).userId).toBeUndefined();
      expect(firstReply.id).toBe("reply-1");
      expect(firstReply.text).toBe("Thanks for visiting us!");
      expect(firstReply.authorName).toBe("Venue Manager");
    });

    it("3. recursively removes multiple levels of nested reply userIds", () => {
      const redacted = redactReviewPayload(sampleReviewWithNestedReplies, true);
      const deepNested = redacted.replies[0].replies[0];
      expect((deepNested as any).userId).toBeUndefined();
      expect(deepNested.id).toBe("reply-1-sub");
      expect(deepNested.text).toBe("Will definitely return next week.");
      expect(deepNested.authorName).toBe("John Doe");
    });

    it("4. handles arrays containing multiple nested reply objects", () => {
      const multiReplyData = {
        replies: [
          { id: "r1", userId: "u1", content: "reply 1" },
          { id: "r2", userId: "u2", content: "reply 2" },
        ],
      };
      const redacted = redactReviewPayload(multiReplyData, true);
      expect((redacted.replies[0] as any).userId).toBeUndefined();
      expect((redacted.replies[1] as any).userId).toBeUndefined();
      expect(redacted.replies[0].content).toBe("reply 1");
      expect(redacted.replies[1].content).toBe("reply 2");
    });

    it("5. preserves non-sensitive reply fields and primitive structures", () => {
      const complexObject = {
        id: "1",
        userId: "secret-user",
        meta: {
          views: 42,
          tags: ["coworking", "cafe"],
          reply: {
            text: "Hello",
            userId: "secret-reply-user",
            active: true,
          },
        },
      };
      const redacted = redactReviewPayload(complexObject, true);
      expect((redacted as any).userId).toBeUndefined();
      expect((redacted.meta.reply as any).userId).toBeUndefined();
      expect(redacted.meta.views).toBe(42);
      expect(redacted.meta.tags).toEqual(["coworking", "cafe"]);
      expect(redacted.meta.reply.text).toBe("Hello");
      expect(redacted.meta.reply.active).toBe(true);
    });

    it("6. preserves userId fields when shouldRedact is false (authenticated user)", () => {
      const preserved = redactReviewPayload(sampleReviewWithNestedReplies, false);
      expect((preserved as any).userId).toBe("user-top-level-123");
      expect(preserved.replies[0].userId).toBe("user-nested-reply-456");
      expect(preserved.replies[0].replies[0].userId).toBe("user-deep-nested-789");
    });
  });

  describe("GET /api/venues/[venueId]/reviews route integration", () => {
    it("redacts top-level and nested reply userIds for unauthenticated requests", async () => {
      (auth as jest.Mock).mockResolvedValue({ userId: null });
      (prisma.venue.findFirst as jest.Mock).mockResolvedValue({ id: venueId });
      (prisma.venueRating.findMany as jest.Mock).mockResolvedValue([
        sampleReviewWithNestedReplies,
      ]);

      const req = new NextRequest(`http://localhost:3000/api/venues/${venueId}/reviews`);
      const res = await GET(req, { params: Promise.resolve({ venueId }) });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.reviews).toHaveLength(1);
      const review = json.reviews[0];

      // Top level review userId removed
      expect(review.userId).toBeUndefined();
      expect(review.user).toBeNull();

      // Nested reply userIds removed
      expect(review.replies[0].userId).toBeUndefined();
      expect(review.replies[0].replies[0].userId).toBeUndefined();

      // Non-sensitive fields preserved
      expect(review.replies[0].text).toBe("Thanks for visiting us!");
      expect(review.replies[0].replies[0].text).toBe("Will definitely return next week.");
    });

    it("preserves non-redacted response behavior for authenticated requests", async () => {
      (auth as jest.Mock).mockResolvedValue({ userId: "authenticated-requester-id" });
      (prisma.venue.findFirst as jest.Mock).mockResolvedValue({ id: venueId });
      (prisma.venueRating.findMany as jest.Mock).mockResolvedValue([
        sampleReviewWithNestedReplies,
      ]);

      const req = new NextRequest(`http://localhost:3000/api/venues/${venueId}/reviews`);
      const res = await GET(req, { params: Promise.resolve({ venueId }) });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.reviews).toHaveLength(1);
      const review = json.reviews[0];

      // Top level userId and user profile preserved for authenticated users
      expect(review.userId).toBe("user-top-level-123");
      expect(review.user).toEqual({ firstName: "John", lastName: "Doe" });

      // Nested reply userIds preserved
      expect(review.replies[0].userId).toBe("user-nested-reply-456");
      expect(review.replies[0].replies[0].userId).toBe("user-deep-nested-789");
    });
  });
});
