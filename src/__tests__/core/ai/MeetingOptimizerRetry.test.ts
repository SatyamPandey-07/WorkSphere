import {
  MeetingOptimizer,
  type MeetingContext,
} from "@/core/ai/MeetingOptimizer";
import type { OverlapSlot } from "@/core/scheduling/TimezoneOverlapMatrix";
import {
  MultiAgentOrchestrator,
  type SubagentExecutionResult,
  type SubagentTask,
} from "@/lib/agents/MultiAgentOrchestrator";

function httpError(status: number): Error & { status: number } {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

const context: MeetingContext = {
  title: "Sprint Planning",
  participants: ["Alice", "Bob"],
  durationMinutes: 30,
  urgency: "high",
  preferredTimeOfDay: "afternoon",
};

const overlaps: OverlapSlot[] = [
  {
    startUTC: Date.UTC(2026, 10, 18, 14, 0),
    endUTC: Date.UTC(2026, 10, 18, 15, 0),
    durationMinutes: 60,
    participantCount: 2,
    participants: ["Alice", "Bob"],
  },
  {
    startUTC: Date.UTC(2026, 10, 18, 16, 0),
    endUTC: Date.UTC(2026, 10, 18, 16, 45),
    durationMinutes: 45,
    participantCount: 1,
    participants: ["Alice"],
  },
];

function successResult(content: string): SubagentExecutionResult {
  return {
    subagentName: "MeetingSchedulingAgent",
    content,
    tokens: {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      tokensSaved: 0,
    },
    toolsUsed: [],
    prunedTools: [],
    telemetry: {
      invocationId: "inv_test",
      subagentName: "MeetingSchedulingAgent",
      timestamp: 0,
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      tokensSaved: 0,
      prunedTools: [],
      activeTools: [],
    } as SubagentExecutionResult["telemetry"],
  };
}

function makeOptimizer(
  invokeSubagent: jest.Mock,
  retry: Record<string, unknown> = { baseDelayMs: 500, jitterRatio: 0 },
) {
  const orchestrator = { invokeSubagent } as unknown as MultiAgentOrchestrator;
  return new MeetingOptimizer("test-key", orchestrator, { retry });
}

describe("MeetingOptimizer LLM retry with exponential backoff (#7945)", () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("recovers from transient rate limits without failing the session", async () => {
    const invokeSubagent = jest
      .fn()
      .mockRejectedValueOnce(httpError(429))
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValue(successResult("Slot 0 is best."));
    const optimizer = makeOptimizer(invokeSubagent);

    const promise = optimizer.optimizeMeetingWithGovernor(context, overlaps);

    await jest.advanceTimersByTimeAsync(0);
    expect(invokeSubagent).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(500);
    expect(invokeSubagent).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1000);
    expect(invokeSubagent).toHaveBeenCalledTimes(3);

    const result = await promise;
    expect(result.rationale).toBe("Slot 0 is best.");
    expect(result.telemetry).not.toBeNull();
    expect(result.selectedSlot?.participantCount).toBe(2);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("asks the orchestrator to rethrow retryable errors", async () => {
    const invokeSubagent = jest.fn().mockResolvedValue(successResult("ok"));
    const optimizer = makeOptimizer(invokeSubagent);

    await optimizer.optimizeMeetingWithGovernor(context, overlaps);

    expect(invokeSubagent).toHaveBeenCalledTimes(1);
    const task = invokeSubagent.mock.calls[0][0] as SubagentTask;
    expect(task.subagentName).toBe("MeetingSchedulingAgent");
    expect(task.rethrowRetryableErrors).toBe(true);
  });

  it("does not wait or retry when the first call succeeds", async () => {
    const invokeSubagent = jest.fn().mockResolvedValue(successResult("fine"));
    const optimizer = makeOptimizer(invokeSubagent);

    const result = await optimizer.optimizeMeetingWithGovernor(
      context,
      overlaps,
    );

    expect(invokeSubagent).toHaveBeenCalledTimes(1);
    expect(result.rationale).toBe("fine");
    expect(jest.getTimerCount()).toBe(0);
  });

  it("returns the deterministic ranking after 3 failed attempts instead of throwing", async () => {
    const invokeSubagent = jest.fn().mockRejectedValue(httpError(429));
    const optimizer = makeOptimizer(invokeSubagent);

    const promise = optimizer.optimizeMeetingWithGovernor(context, overlaps);
    await jest.advanceTimersByTimeAsync(60_000);
    const result = await promise;

    expect(invokeSubagent).toHaveBeenCalledTimes(3);
    expect(result.telemetry).toBeNull();
    expect(result.rationale).toContain("temporarily unavailable");
    expect(result.slots).toHaveLength(2);
    expect(result.selectedSlot).toBe(result.slots[0]);
    expect(result.selectedSlot?.participantCount).toBe(2);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("status 429");
  });

  it.each([502, 503, 504])("retries a %i response", async (status) => {
    const invokeSubagent = jest
      .fn()
      .mockRejectedValueOnce(httpError(status))
      .mockResolvedValue(successResult("back"));
    const optimizer = makeOptimizer(invokeSubagent);

    const promise = optimizer.optimizeMeetingWithGovernor(context, overlaps);
    await jest.advanceTimersByTimeAsync(500);

    await expect(promise).resolves.toMatchObject({ rationale: "back" });
    expect(invokeSubagent).toHaveBeenCalledTimes(2);
  });

  it.each([400, 401, 404])(
    "does not retry a %i and rethrows it",
    async (status) => {
      const invokeSubagent = jest.fn().mockRejectedValue(httpError(status));
      const optimizer = makeOptimizer(invokeSubagent);

      await expect(
        optimizer.optimizeMeetingWithGovernor(context, overlaps),
      ).rejects.toMatchObject({
        status,
      });
      expect(invokeSubagent).toHaveBeenCalledTimes(1);
    },
  );

  it("honors a custom retry policy from the constructor options", async () => {
    const invokeSubagent = jest.fn().mockRejectedValue(httpError(503));
    const optimizer = makeOptimizer(invokeSubagent, {
      maxAttempts: 5,
      baseDelayMs: 10,
      jitterRatio: 0,
    });

    const promise = optimizer.optimizeMeetingWithGovernor(context, overlaps);
    await jest.advanceTimersByTimeAsync(60_000);
    await promise;

    expect(invokeSubagent).toHaveBeenCalledTimes(5);
  });

  it("never calls the LLM when there are no viable slots", async () => {
    const invokeSubagent = jest.fn();
    const optimizer = makeOptimizer(invokeSubagent);

    const result = await optimizer.optimizeMeetingWithGovernor(context, []);

    expect(result.selectedSlot).toBeNull();
    expect(invokeSubagent).not.toHaveBeenCalled();
  });

  it("recovers end to end through a real orchestrator whose Groq client is rate limited", async () => {
    const orchestrator = new MultiAgentOrchestrator({ debug: false });
    const create = jest
      .fn()
      .mockRejectedValueOnce(httpError(429))
      .mockRejectedValueOnce(httpError(429))
      .mockResolvedValue({
        choices: [{ message: { content: "Pick the 14:00 slot." } }],
        usage: { completion_tokens: 7 },
      });
    (orchestrator as unknown as { groqClient: unknown }).groqClient = {
      chat: { completions: { create } },
    };
    const optimizer = new MeetingOptimizer("test-key", orchestrator, {
      retry: { baseDelayMs: 500, jitterRatio: 0 },
    });

    const promise = optimizer.optimizeMeetingWithGovernor(context, overlaps);
    await jest.advanceTimersByTimeAsync(1500);
    const result = await promise;

    expect(create).toHaveBeenCalledTimes(3);
    expect(result.rationale).toBe("Pick the 14:00 slot.");
    expect(result.telemetry?.completionTokens).toBe(7);
  });

  it("keeps the previous fallback behavior for non-retryable Groq errors", async () => {
    const orchestrator = new MultiAgentOrchestrator({ debug: false });
    const create = jest.fn().mockRejectedValue(httpError(401));
    (orchestrator as unknown as { groqClient: unknown }).groqClient = {
      chat: { completions: { create } },
    };
    const optimizer = new MeetingOptimizer("test-key", orchestrator);

    const result = await optimizer.optimizeMeetingWithGovernor(
      context,
      overlaps,
    );

    expect(create).toHaveBeenCalledTimes(1);
    expect(result.rationale).toContain(
      "Completed execution for MeetingSchedulingAgent",
    );
  });
});
