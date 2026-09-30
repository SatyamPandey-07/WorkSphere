/**
 * Tests for user feedback form validation and submission.
 */

type FeedbackCategory = "bug" | "feature_request" | "general" | "praise" | "complaint";

interface FeedbackSubmission {
  userId: string;
  category: FeedbackCategory;
  subject: string;
  message: string;
  rating?: number; // 1-5, optional
  attachmentCount: number;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function validateFeedback(submission: FeedbackSubmission): ValidationResult {
  const errors: string[] = [];
  if (!submission.subject.trim()) errors.push("Subject is required");
  if (submission.subject.length > 100) errors.push("Subject too long (max 100)");
  if (!submission.message.trim()) errors.push("Message is required");
  if (submission.message.length < 10) errors.push("Message too short (min 10 chars)");
  if (submission.message.length > 2000) errors.push("Message too long (max 2000)");
  if (submission.rating !== undefined && (submission.rating < 1 || submission.rating > 5)) {
    errors.push("Rating must be 1-5");
  }
  if (submission.attachmentCount > 3) errors.push("Max 3 attachments");
  return { valid: errors.length === 0, errors };
}

function sanitizeFeedback(submission: FeedbackSubmission): FeedbackSubmission {
  return {
    ...submission,
    subject: submission.subject.trim().slice(0, 100),
    message: submission.message.trim().slice(0, 2000),
  };
}

const VALID: FeedbackSubmission = {
  userId: "u1", category: "bug",
  subject: "Login button not working",
  message: "When I click the login button, nothing happens.",
  attachmentCount: 0,
};

describe("User feedback form validation", () => {
  it("valid feedback → no errors", () => {
    const result = validateFeedback(VALID);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("missing subject → error", () => {
    const result = validateFeedback({ ...VALID, subject: "" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /subject/i.test(e))).toBe(true);
  });

  it("message too short → error", () => {
    const result = validateFeedback({ ...VALID, message: "short" });
    expect(result.errors.some((e) => /too short/i.test(e))).toBe(true);
  });

  it("too many attachments → error", () => {
    const result = validateFeedback({ ...VALID, attachmentCount: 4 });
    expect(result.errors.some((e) => /attachments/i.test(e))).toBe(true);
  });

  it("invalid rating → error", () => {
    const result = validateFeedback({ ...VALID, rating: 6 });
    expect(result.errors.some((e) => /rating/i.test(e))).toBe(true);
  });

  it("valid rating 1-5 accepted", () => {
    expect(validateFeedback({ ...VALID, rating: 3 }).valid).toBe(true);
  });

  it("sanitizeFeedback: trims subject and message", () => {
    const s = sanitizeFeedback({ ...VALID, subject: "  Test  ", message: "  message content here  " });
    expect(s.subject).toBe("Test");
    expect(s.message).toBe("message content here");
  });

  it("sanitizeFeedback: truncates to max", () => {
    const longSub = sanitizeFeedback({ ...VALID, subject: "a".repeat(150) });
    expect(longSub.subject.length).toBe(100);
  });
});
