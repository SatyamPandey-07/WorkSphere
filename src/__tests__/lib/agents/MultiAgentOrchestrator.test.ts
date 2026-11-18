import {
  MultiAgentOrchestrator,
  ToolPriority,
  DEFAULT_TOOL_PRIORITIES,
  type AgentToolDeclaration,
  type AgentMessage,
} from '@/lib/agents/MultiAgentOrchestrator';

describe('MultiAgentOrchestrator - Dynamic Tool Selection & Token Budget Governor (#7166)', () => {
  let orchestrator: MultiAgentOrchestrator;

  beforeEach(() => {
    orchestrator = new MultiAgentOrchestrator({
      maxTokenAllowance: 1000,
      pruningThreshold: 0.75, // 75% = 750 tokens
      reserveCompletionTokens: 100,
      debug: false,
    });
  });

  describe('Tool Prioritization Rank', () => {
    it('defines standard priority ranks: search > routing > weather > noise_metrics', () => {
      expect(DEFAULT_TOOL_PRIORITIES.search).toBe(ToolPriority.SEARCH);
      expect(DEFAULT_TOOL_PRIORITIES.routing).toBe(ToolPriority.ROUTING);
      expect(DEFAULT_TOOL_PRIORITIES.weather).toBe(ToolPriority.WEATHER);
      expect(DEFAULT_TOOL_PRIORITIES.noise_metrics).toBe(ToolPriority.NOISE_METRICS);

      expect(DEFAULT_TOOL_PRIORITIES.search).toBeLessThan(DEFAULT_TOOL_PRIORITIES.routing);
      expect(DEFAULT_TOOL_PRIORITIES.routing).toBeLessThan(DEFAULT_TOOL_PRIORITIES.weather);
      expect(DEFAULT_TOOL_PRIORITIES.weather).toBeLessThan(DEFAULT_TOOL_PRIORITIES.noise_metrics);
    });

    it('resolves tool priorities correctly for registered and custom tools', () => {
      const searchTool = orchestrator.getTool('search')!;
      const noiseTool = orchestrator.getTool('noise_metrics')!;

      expect(orchestrator.getToolPriority(searchTool)).toBe(ToolPriority.SEARCH);
      expect(orchestrator.getToolPriority(noiseTool)).toBe(ToolPriority.NOISE_METRICS);

      const customTool: AgentToolDeclaration = {
        name: 'custom_high_prio',
        description: 'Critical custom tool',
        parameters: {},
        priority: 1,
      };
      expect(orchestrator.getToolPriority(customTool)).toBe(1);
    });
  });

  describe('Token Budget Governor and Dynamic Pruning', () => {
    it('retains all tools when context usage is below the 75% threshold', () => {
      const messages: AgentMessage[] = [
        { role: 'system', content: 'Short system prompt.' },
        { role: 'user', content: 'Find a desk.' },
      ];

      const tools = orchestrator.getAllTools();
      const result = orchestrator.governToolSelection(messages, tools, 2000);

      expect(result.exceededThreshold).toBe(false);
      expect(result.activeTools).toHaveLength(tools.length);
      expect(result.prunedTools).toHaveLength(0);
      expect(result.tokensSaved).toBe(0);
      expect(result.usageRatio).toBeLessThanOrEqual(0.75);
    });

    it('automatically prunes low-priority tools when context exceeds 75% threshold', () => {
      // Prompt designed to exceed 75% threshold (750 tokens) when all tools are supplied,
      // but drop below threshold once low priority tools are pruned, keeping high-priority 'search' active.
      const text = 'Workspace search query with detail '.repeat(65); // ~570 tokens
      const messages: AgentMessage[] = [
        { role: 'system', content: 'System instruction.' },
        { role: 'user', content: text },
      ];

      const tools = orchestrator.getAllTools();
      const result = orchestrator.governToolSelection(messages, tools, 1000);

      expect(result.exceededThreshold).toBe(true);
      expect(result.prunedTools.length).toBeGreaterThan(0);
      expect(result.tokensSaved).toBeGreaterThan(0);

      // Verify that lowest priority tools (noise_metrics) are pruned before high priority (search)
      const prunedNames = result.prunedTools.map((t) => t.name);
      expect(prunedNames).toContain('noise_metrics');

      const activeNames = result.activeTools.map((t) => t.name);
      // High priority tool 'search' should be preserved
      expect(activeNames).toContain('search');
    });

    it('prunes multiple tools in priority order until within budget', () => {
      // 2500 chars = ~625 prompt tokens. Tools = ~140 tokens. Reserve = 100 tokens.
      // Total = ~865 / 1000 = 86.5% (>75%).
      // Pruning noise_metrics (-35) -> 830 (83%).
      // Pruning weather (-35) -> 795 (79.5%).
      // Pruning routing (-35) -> 760 (76%).
      // Pruning search (-35) -> 725 (72.5% <= 75%).
      const hugeText = 'Heavy context payload line for analysis. '.repeat(65);
      const messages: AgentMessage[] = [
        { role: 'system', content: 'You are an agent.' },
        { role: 'user', content: hugeText },
      ];

      const tools = orchestrator.getAllTools();
      const result = orchestrator.governToolSelection(messages, tools, 1000);

      expect(result.prunedTools.length).toBeGreaterThanOrEqual(2);
      const prunedNames = result.prunedTools.map((t) => t.name);
      // noise_metrics should be pruned first
      expect(prunedNames[0]).toBe('noise_metrics');
    });

    it('logs pruned tool counts and budget usage in debug mode', () => {
      const debugOrchestrator = new MultiAgentOrchestrator({
        maxTokenAllowance: 1000,
        pruningThreshold: 0.75,
        reserveCompletionTokens: 100,
        debug: true,
      });

      const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});

      const messages: AgentMessage[] = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Workspace detail query analysis '.repeat(65) },
      ];

      debugOrchestrator.governToolSelection(messages, debugOrchestrator.getAllTools(), 1000);

      expect(debugSpy).toHaveBeenCalled();
      const logMessage = debugSpy.mock.calls[0][0];
      expect(logMessage).toContain('[TokenBudgetGovernor]');
      expect(logMessage).toContain('Pruned');
      expect(logMessage).toContain('Budget:');

      debugSpy.mockRestore();
    });
  });

  describe('Subagent Invocations and Telemetry', () => {
    it('tracks prompt and completion token consumption per subagent invocation', async () => {
      const result = await orchestrator.invokeSubagent({
        subagentName: 'VenueSearchAgent',
        instruction: 'Locate top 3 quiet coffee shops in Manhattan with high-speed Wi-Fi.',
      });

      expect(result.subagentName).toBe('VenueSearchAgent');
      expect(result.tokens.promptTokens).toBeGreaterThan(0);
      expect(result.tokens.completionTokens).toBeGreaterThan(0);
      expect(result.tokens.totalTokens).toBe(
        result.tokens.promptTokens + result.tokens.completionTokens
      );
      expect(result.telemetry).toBeDefined();
      expect(result.telemetry.subagentName).toBe('VenueSearchAgent');
    });

    it('operates strictly within configured token limits without throwing 400 ContextLengthExceeded', async () => {
      // Extremely tight token budget
      const tightOrchestrator = new MultiAgentOrchestrator({
        maxTokenAllowance: 300,
        pruningThreshold: 0.75,
        reserveCompletionTokens: 50,
      });

      const longPrompt = 'Please summarize all cafe amenities: ' + 'amenity '.repeat(100);

      await expect(
        tightOrchestrator.invokeSubagent({
          subagentName: 'HeavyContextAgent',
          instruction: longPrompt,
        })
      ).resolves.not.toThrow();
    });

    it('aggregates token efficiency telemetry metrics across invocations', async () => {
      orchestrator.resetTelemetry();

      await orchestrator.invokeSubagent({
        subagentName: 'SearchAgent',
        instruction: 'Query cafes',
      });

      await orchestrator.invokeSubagent({
        subagentName: 'RoutingAgent',
        instruction: 'Calculate route',
      });

      const metrics = orchestrator.getTelemetryMetrics();

      expect(metrics.totalInvocations).toBe(2);
      expect(metrics.totalPromptTokens).toBeGreaterThan(0);
      expect(metrics.totalCompletionTokens).toBeGreaterThan(0);
      expect(metrics.totalTokensConsumed).toBe(
        metrics.totalPromptTokens + metrics.totalCompletionTokens
      );
      expect(metrics.perSubagentMetrics['SearchAgent']).toBeDefined();
      expect(metrics.perSubagentMetrics['RoutingAgent']).toBeDefined();
      expect(metrics.perSubagentMetrics['SearchAgent'].invocations).toBe(1);
      expect(metrics.recentTelemetry).toHaveLength(2);
    });
  });
});
