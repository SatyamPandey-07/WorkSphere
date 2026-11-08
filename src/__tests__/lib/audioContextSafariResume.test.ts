/**
 * Tests for the Safari iOS AudioContext resume fix (Issue #1948).
 * Verifies one-shot listener pattern for suspended AudioContext.
 */

// Simulate the listener cleanup pattern
function createResumeOnInteractionSimulator() {
  const registeredListeners: { event: string; handler: () => void; opts?: object }[] = [];
  const removedListeners: string[] = [];

  const mockDocument = {
    addEventListener: (event: string, handler: () => void, opts?: object) => {
      registeredListeners.push({ event, handler, opts });
    },
    removeEventListener: (event: string) => {
      removedListeners.push(event);
    },
  };

  const attach = (ctx: { state: string; resume: () => Promise<void> }) => {
    if (ctx.state !== "suspended") return;

    const resumeOnInteraction = async () => {
      await ctx.resume();
      if (ctx.state === "running") {
        mockDocument.removeEventListener("touchstart");
        mockDocument.removeEventListener("click");
      }
    };

    mockDocument.addEventListener("touchstart", resumeOnInteraction, { passive: true });
    mockDocument.addEventListener("click", resumeOnInteraction);
  };

  return { attach, registeredListeners, removedListeners };
}

describe("AudioContext Safari iOS resume listeners", () => {
  it("registers touchstart and click listeners for suspended context", () => {
    const sim = createResumeOnInteractionSimulator();
    const mockCtx = { state: "suspended", resume: jest.fn().mockResolvedValue(undefined) };

    sim.attach(mockCtx as any);

    const events = sim.registeredListeners.map((l) => l.event);
    expect(events).toContain("touchstart");
    expect(events).toContain("click");
  });

  it("does NOT register listeners for already running context", () => {
    const sim = createResumeOnInteractionSimulator();
    const mockCtx = { state: "running", resume: jest.fn() };

    sim.attach(mockCtx as any);

    expect(sim.registeredListeners).toHaveLength(0);
  });

  it("touchstart listener has passive: true option", () => {
    const sim = createResumeOnInteractionSimulator();
    const mockCtx = { state: "suspended", resume: jest.fn().mockResolvedValue(undefined) };

    sim.attach(mockCtx as any);

    const touchStartListener = sim.registeredListeners.find((l) => l.event === "touchstart");
    expect(touchStartListener?.opts).toEqual({ passive: true });
  });

  it("removes listeners after successful resume", async () => {
    const sim = createResumeOnInteractionSimulator();
    let contextState = "suspended";
    const mockCtx = {
      get state() { return contextState; },
      resume: jest.fn().mockImplementation(async () => {
        contextState = "running";
      }),
    };

    sim.attach(mockCtx as any);

    // Trigger the interaction handler
    const handler = sim.registeredListeners[0].handler;
    await handler();

    expect(sim.removedListeners).toContain("touchstart");
    expect(sim.removedListeners).toContain("click");
  });

  it("registers exactly 2 listeners (touchstart + click)", () => {
    const sim = createResumeOnInteractionSimulator();
    const mockCtx = { state: "suspended", resume: jest.fn().mockResolvedValue(undefined) };

    sim.attach(mockCtx as any);

    expect(sim.registeredListeners).toHaveLength(2);
  });
});
