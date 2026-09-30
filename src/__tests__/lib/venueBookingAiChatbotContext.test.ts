/**
 * Tests for AI chatbot context management for venue bookings.
 */

interface ChatContext {
  sessionId: string;
  userId: string;
  venueId: string | null;
  lastIntent: string | null;
  collectedSlots: Record<string, string | number | null>;
  conversationHistory: { role: "user" | "assistant"; content: string }[];
  isComplete: boolean;
}

const REQUIRED_SLOTS = ["date", "time", "duration", "seats"];

function isContextComplete(context: ChatContext): boolean {
  return REQUIRED_SLOTS.every(
    (slot) => context.collectedSlots[slot] !== null && context.collectedSlots[slot] !== undefined
  );
}

function missingSlots(context: ChatContext): string[] {
  return REQUIRED_SLOTS.filter(
    (slot) => !context.collectedSlots[slot]
  );
}

function updateSlot(
  context: ChatContext,
  slot: string,
  value: string | number
): ChatContext {
  const updatedSlots = { ...context.collectedSlots, [slot]: value };
  return {
    ...context,
    collectedSlots: updatedSlots,
    isComplete: REQUIRED_SLOTS.every((s) => updatedSlots[s] !== null && updatedSlots[s] !== undefined),
  };
}

function resetContext(sessionId: string, userId: string): ChatContext {
  return {
    sessionId, userId, venueId: null, lastIntent: null,
    collectedSlots: Object.fromEntries(REQUIRED_SLOTS.map((s) => [s, null])),
    conversationHistory: [], isComplete: false,
  };
}

function addToHistory(
  context: ChatContext,
  role: "user" | "assistant",
  content: string
): ChatContext {
  return {
    ...context,
    conversationHistory: [...context.conversationHistory, { role, content }],
  };
}

const PARTIAL_CONTEXT: ChatContext = {
  sessionId: "sess1", userId: "u1", venueId: "v1",
  lastIntent: "book_desk",
  collectedSlots: { date: "2026-10-15", time: "09:00", duration: null, seats: null },
  conversationHistory: [{ role: "user", content: "I want to book a desk" }],
  isComplete: false,
};

describe("AI chatbot context management", () => {
  it("isContextComplete: partial slots → false", () => {
    expect(isContextComplete(PARTIAL_CONTEXT)).toBe(false);
  });

  it("missingSlots: duration and seats missing", () => {
    const missing = missingSlots(PARTIAL_CONTEXT);
    expect(missing).toContain("duration");
    expect(missing).toContain("seats");
    expect(missing).not.toContain("date");
  });

  it("updateSlot: adds duration", () => {
    const updated = updateSlot(PARTIAL_CONTEXT, "duration", 4);
    expect(updated.collectedSlots.duration).toBe(4);
  });

  it("updateSlot: sets isComplete when all slots filled", () => {
    let ctx = PARTIAL_CONTEXT;
    ctx = updateSlot(ctx, "duration", 4);
    ctx = updateSlot(ctx, "seats", 2);
    expect(ctx.isComplete).toBe(true);
  });

  it("resetContext: all slots null", () => {
    const reset = resetContext("new-session", "u2");
    expect(Object.values(reset.collectedSlots).every((v) => v === null)).toBe(true);
    expect(reset.isComplete).toBe(false);
  });

  it("addToHistory: appends message", () => {
    const updated = addToHistory(PARTIAL_CONTEXT, "assistant", "How long will you need?");
    expect(updated.conversationHistory).toHaveLength(2);
    expect(updated.conversationHistory[1].role).toBe("assistant");
  });
});
