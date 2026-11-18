import { MultiAgentOrchestrator } from "@/lib/agents/MultiAgentOrchestrator";

function httpError(status: number): Error & { status: number } {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

function withFailingGroq(orchestrator: MultiAgentOrchestrator, error: unknown) {
  const create = jest.fn().mockRejectedValue(error);
  (orchestrator as unknown as { groqClient: unknown }).groqClient = {
    chat: { completions: { create } },
  };
  return create;
}

describe("MultiAgentOrchestrator rethrowRetryableErrors (#7945)", () => {
  let orchestrator: MultiAgentOrchestrator;

  beforeEach(() => {
    orchestrator = new MultiAgentOrchestrator({ debug: false });
  });

  it("keeps the deterministic fallback for a 429 by default", async () => {
    const create = withFailingGroq(orchestrator, httpError(429));

    const result = await orchestrator.invokeSubagent({
      subagentName: "TestAgent",
      instruction: "Pick a slot",
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(result.content).toContain("Completed execution for TestAgent");
  });

  it.each([429, 502, 503, 504])(
    "rethrows a %i when rethrowRetryableErrors is set",
    async (status) => {
      withFailingGroq(orchestrator, httpError(status));

      await expect(
        orchestrator.invokeSubagent({
          subagentName: "TestAgent",
          instruction: "Pick a slot",
          rethrowRetryableErrors: true,
        }),
      ).rejects.toMatchObject({ status });
    },
  );

  it.each([400, 401, 500])(
    "still falls back for a non-retryable %i even when the flag is set",
    async (status) => {
      withFailingGroq(orchestrator, httpError(status));

      const result = await orchestrator.invokeSubagent({
        subagentName: "TestAgent",
        instruction: "Pick a slot",
        rethrowRetryableErrors: true,
      });

      expect(result.content).toContain("Completed execution for TestAgent");
    },
  );

  it("falls back for errors with no status even when the flag is set", async () => {
    withFailingGroq(orchestrator, new Error("socket hang up"));

    const result = await orchestrator.invokeSubagent({
      subagentName: "TestAgent",
      instruction: "Pick a slot",
      rethrowRetryableErrors: true,
    });

    expect(result.content).toContain("Completed execution for TestAgent");
  });
});
