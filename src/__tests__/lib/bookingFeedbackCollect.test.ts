/**
 * Tests for post-booking feedback collection management.
 */

interface FeedbackRequest {
  bookingId: string;
  userId: string;
  requestedAt: number;
  completedAt: number | null;
  reminderCount: number;
  rating: number | null;
  categories: string[];
  freeText: string | null;
}

function isFeedbackPending(req: FeedbackRequest): boolean {
  return req.completedAt === null;
}

function shouldSendReminder(
  req: FeedbackRequest,
  nowMs: number,
  maxReminders = 2,
  intervalMs = 86_400_000
): boolean {
  if (!isFeedbackPending(req)) return false;
  if (req.reminderCount >= maxReminders) return false;
  const lastContact = req.reminderCount === 0
    ? req.requestedAt
    : req.requestedAt + req.reminderCount * intervalMs;
  return nowMs - lastContact >= intervalMs;
}

function submitFeedback(
  req: FeedbackRequest,
  rating: number,
  categories: string[],
  freeText: string | null,
  nowMs: number
): FeedbackRequest {
  if (!isFeedbackPending(req)) throw new Error("Feedback already submitted");
  if (rating < 1 || rating > 5) throw new Error("Rating must be 1-5");
  return { ...req, rating, categories, freeText, completedAt: nowMs };
}

function completionRate(requests: FeedbackRequest[]): number {
  if (requests.length === 0) return 0;
  const completed = requests.filter((r) => !isFeedbackPending(r)).length;
  return Math.round((completed / requests.length) * 100);
}

const NOW = 1_700_000_000_000;
const REQUEST: FeedbackRequest = {
  bookingId: "b1", userId: "u1",
  requestedAt: NOW - 2 * 86_400_000, completedAt: null,
  reminderCount: 0, rating: null, categories: [], freeText: null,
};

describe("Booking feedback collection", () => {
  it("isFeedbackPending: not submitted → true", () => {
    expect(isFeedbackPending(REQUEST)).toBe(true);
  });

  it("isFeedbackPending: completed → false", () => {
    expect(isFeedbackPending({ ...REQUEST, completedAt: NOW })).toBe(false);
  });

  it("shouldSendReminder: ready for first reminder", () => {
    expect(shouldSendReminder(REQUEST, NOW)).toBe(true);
  });

  it("shouldSendReminder: too soon → false", () => {
    const fresh = { ...REQUEST, requestedAt: NOW - 1000 };
    expect(shouldSendReminder(fresh, NOW)).toBe(false);
  });

  it("shouldSendReminder: max reminders reached → false", () => {
    const maxed = { ...REQUEST, reminderCount: 2 };
    expect(shouldSendReminder(maxed, NOW)).toBe(false);
  });

  it("submitFeedback: sets rating and completedAt", () => {
    const submitted = submitFeedback(REQUEST, 4, ["wifi", "quiet"], "Great!", NOW);
    expect(submitted.rating).toBe(4);
    expect(submitted.completedAt).toBe(NOW);
  });

  it("submitFeedback: throws if already completed", () => {
    const completed = { ...REQUEST, completedAt: NOW - 1000 };
    expect(() => submitFeedback(completed, 3, [], null, NOW)).toThrow("already submitted");
  });

  it("submitFeedback: throws on invalid rating", () => {
    expect(() => submitFeedback(REQUEST, 6, [], null, NOW)).toThrow("Rating must be 1-5");
  });

  it("completionRate: 1 of 3 completed = 33%", () => {
    const reqs = [REQUEST, REQUEST, { ...REQUEST, completedAt: NOW }];
    expect(completionRate(reqs)).toBe(33);
  });
});
