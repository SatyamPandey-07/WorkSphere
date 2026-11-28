import { MultiAgentOrchestrator } from '@/lib/agents/MultiAgentOrchestrator';

const mockCreate = jest.fn();

jest.mock('groq-sdk', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: (...args: unknown[]) => mockCreate(...args),
      },
    },
  }));
});

describe('MultiAgentOrchestrator bounded schema-validated tool execution loop (#10692)', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('validates arguments, invokes allowlisted handler, and feeds tool results back to the model', async () => {
    const orchestrator = new MultiAgentOrchestrator({ maxTokenAllowance: 4096 }, 'test-key');
    const handler = jest.fn().mockResolvedValue({ venues: ['Cafe Alpha'] });

    orchestrator.registerTool({
      name: 'find_venues',
      description: 'Find venues by city',
      parameters: {
        type: 'object',
        required: ['city'],
        additionalProperties: false,
        properties: {
          city: { type: 'string' },
        },
      },
      execute: handler,
    });

    mockCreate
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'find_venues', arguments: JSON.stringify({ city: 'Austin' }) },
                },
              ],
            },
          },
        ],
        usage: { completion_tokens: 20 },
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'Found Cafe Alpha in Austin.' } }],
        usage: { completion_tokens: 15 },
      });

    const result = await orchestrator.invokeSubagent({
      subagentName: 'VenueAgent',
      instruction: 'Find venues in Austin',
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ city: 'Austin' });
    expect(result.content).toBe('Found Cafe Alpha in Austin.');
    expect(result.toolsInvoked).toEqual(['find_venues']);
    expect(result.toolMetrics).toEqual([
      expect.objectContaining({ toolName: 'find_venues', ok: true }),
    ]);
    for (const metric of result.toolMetrics) {
      expect(metric.durationMs).toBeGreaterThanOrEqual(0);
    }
    expect(result.toolExecutionStats).toEqual({
      requested: 1,
      validated: 1,
      invoked: 1,
      succeeded: 1,
      failed: 0,
      timedOut: 0,
      deduplicated: 0,
    });
  });

  it('records a separate latency metric for every successful and failed invocation', async () => {
    const orchestrator = new MultiAgentOrchestrator(
      { maxTokenAllowance: 4096 },
      'test-key',
    );
    const successfulHandler = jest.fn().mockResolvedValue({ result: 'ok' });
    const failedHandler = jest.fn().mockRejectedValue(new Error('tool failed'));

    orchestrator.registerTool({
      name: 'lookup',
      description: 'Lookup a value',
      parameters: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      execute: successfulHandler,
    });
    orchestrator.registerTool({
      name: 'update',
      description: 'Update a value',
      parameters: { type: 'object', properties: {} },
      execute: failedHandler,
    });

    mockCreate
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                {
                  id: 'lookup_1',
                  type: 'function',
                  function: { name: 'lookup', arguments: JSON.stringify({ id: 'a' }) },
                },
                {
                  id: 'update_1',
                  type: 'function',
                  function: { name: 'update', arguments: '{}' },
                },
                {
                  id: 'lookup_2',
                  type: 'function',
                  function: { name: 'lookup', arguments: JSON.stringify({ id: 'b' }) },
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'Tool calls completed.' } }],
      });

    const result = await orchestrator.invokeSubagent({
      subagentName: 'MetricsAgent',
      instruction: 'Run tools and report the outcome',
    });

    expect(result.toolMetrics).toHaveLength(3);
    expect(
      result.toolMetrics.map(({ toolName, ok }) => ({ toolName, ok })),
    ).toEqual([
      { toolName: 'lookup', ok: true },
      { toolName: 'update', ok: false },
      { toolName: 'lookup', ok: true },
    ]);
    for (const metric of result.toolMetrics) {
      expect(metric.durationMs).toBeGreaterThanOrEqual(0);
      expect(Object.keys(metric).sort()).toEqual([
        'durationMs',
        'ok',
        'toolName',
      ]);
    }
    expect(successfulHandler).toHaveBeenCalledTimes(2);
    expect(failedHandler).toHaveBeenCalledTimes(1);
    expect(result.content).toBe('Tool calls completed.');
    expect(result.toolExecutionStats).toMatchObject({
      invoked: 3,
      succeeded: 2,
      failed: 1,
    });
  });

  it('rejects unknown tools, malformed JSON, and schema violations without invoking handlers', async () => {
    const orchestrator = new MultiAgentOrchestrator({ maxTokenAllowance: 4096 }, 'test-key');
    const handler = jest.fn().mockResolvedValue({ ok: true });

    orchestrator.registerTool({
      name: 'strict_tool',
      description: 'Strict schema tool',
      parameters: {
        type: 'object',
        required: ['count'],
        additionalProperties: false,
        properties: {
          count: { type: 'integer' },
        },
      },
      execute: handler,
    });

    mockCreate
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                {
                  id: 'c_unknown',
                  type: 'function',
                  function: { name: 'unregistered_exec', arguments: '{}' },
                },
                {
                  id: 'c_bad_json',
                  type: 'function',
                  function: { name: 'strict_tool', arguments: '{not valid json' },
                },
                {
                  id: 'c_missing_req',
                  type: 'function',
                  function: { name: 'strict_tool', arguments: '{}' },
                },
                {
                  id: 'c_bad_type',
                  type: 'function',
                  function: { name: 'strict_tool', arguments: JSON.stringify({ count: 'two' }) },
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'Handled invalid tool calls safely.' } }],
      });

    const result = await orchestrator.invokeSubagent({
      subagentName: 'StrictAgent',
      instruction: 'Test invalid calls',
    });

    expect(handler).not.toHaveBeenCalled();
    expect(result.toolsInvoked).toEqual([]);
    expect(result.toolExecutionStats?.requested).toBe(4);
    expect(result.toolExecutionStats?.validated).toBe(0);
    expect(result.toolExecutionStats?.failed).toBe(4);
  });

  it('deduplicates repeated identical calls and enforces tool timeout & max rounds', async () => {
    const orchestrator = new MultiAgentOrchestrator(
      { maxTokenAllowance: 4096, maxToolRounds: 2, toolTimeoutMs: 25 },
      'test-key',
    );
    const idempotentHandler = jest.fn().mockResolvedValue({ cached: true });
    const slowHandler = jest.fn(
      () => new Promise((resolve) => setTimeout(() => resolve({ late: true }), 150)),
    );

    orchestrator.registerTool({
      name: 'fast_lookup',
      description: 'Lookup',
      parameters: { type: 'object', properties: { key: { type: 'string' } } },
      execute: idempotentHandler,
    });
    orchestrator.registerTool({
      name: 'slow_op',
      description: 'Slow operation',
      parameters: { type: 'object', properties: {} },
      execute: slowHandler,
    });

    mockCreate
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                {
                  id: 'c1',
                  type: 'function',
                  function: { name: 'fast_lookup', arguments: JSON.stringify({ key: 'a' }) },
                },
                {
                  id: 'c2',
                  type: 'function',
                  function: { name: 'fast_lookup', arguments: JSON.stringify({ key: 'a' }) },
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                {
                  id: 'c3',
                  type: 'function',
                  function: { name: 'slow_op', arguments: '{}' },
                },
              ],
            },
          },
        ],
      });

    const result = await orchestrator.invokeSubagent({
      subagentName: 'BoundedAgent',
      instruction: 'Run bounded loop',
    });

    expect(idempotentHandler).toHaveBeenCalledTimes(1);
    expect(slowHandler).toHaveBeenCalledTimes(1);
    expect(result.toolsInvoked).toEqual(['fast_lookup']);
    expect(result.toolExecutionStats).toEqual({
      requested: 3,
      validated: 3,
      invoked: 2,
      succeeded: 1,
      failed: 0,
      timedOut: 1,
      deduplicated: 1,
    });

    expect(result.toolMetrics).toHaveLength(2);
    expect(
      result.toolMetrics.map(({ toolName, ok }) => ({ toolName, ok })),
    ).toEqual([
      { toolName: 'fast_lookup', ok: true },
      { toolName: 'slow_op', ok: false },
    ]);
  });

  it('stops after the cumulative tool duration budget and retains completed tool results', async () => {
    const orchestrator = new MultiAgentOrchestrator(
      { maxTokenAllowance: 4096, maxTotalToolDurationMs: 100 },
      'test-key',
    );
    const firstHandler = jest.fn().mockResolvedValue({ result: 'partial result' });
    const slowHandler = jest.fn(
      () => new Promise((resolve) => setTimeout(() => resolve({ result: 'slow result' }), 150)),
    );
    const blockedHandler = jest.fn().mockResolvedValue({ result: 'should not run' });

    for (const [name, execute] of [
      ['first_tool', firstHandler],
      ['slow_tool', slowHandler],
      ['blocked_tool', blockedHandler],
    ] as const) {
      orchestrator.registerTool({
        name,
        description: name,
        parameters: { type: 'object', properties: {} },
        execute,
      });
    }

    mockCreate
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                { id: 'first', type: 'function', function: { name: 'first_tool', arguments: '{}' } },
                { id: 'slow', type: 'function', function: { name: 'slow_tool', arguments: '{}' } },
                { id: 'blocked', type: 'function', function: { name: 'blocked_tool', arguments: '{}' } },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'Completed with the partial results.' } }],
      });

    const result = await orchestrator.invokeSubagent({
      subagentName: 'BudgetedAgent',
      instruction: 'Run tools within the cumulative duration budget',
    });

    expect(firstHandler).toHaveBeenCalledTimes(1);
    expect(slowHandler).toHaveBeenCalledTimes(1);
    expect(blockedHandler).not.toHaveBeenCalled();
    expect(result.toolsInvoked).toEqual(['first_tool', 'slow_tool']);
    expect(result.content).toBe('Completed with the partial results.');
    const followupMessages = mockCreate.mock.calls[1][0].messages;
    expect(followupMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'tool', content: expect.stringContaining('partial result') }),
      ]),
    );
  });

  it('keeps executing tools when no cumulative duration budget is configured', async () => {
    const orchestrator = new MultiAgentOrchestrator({ maxTokenAllowance: 4096 }, 'test-key');
    const firstHandler = jest.fn().mockResolvedValue({ result: 'first' });
    const secondHandler = jest.fn().mockResolvedValue({ result: 'second' });

    for (const [name, execute] of [
      ['first_tool', firstHandler],
      ['second_tool', secondHandler],
    ] as const) {
      orchestrator.registerTool({
        name,
        description: name,
        parameters: { type: 'object', properties: {} },
        execute,
      });
    }

    mockCreate
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                { id: 'first', type: 'function', function: { name: 'first_tool', arguments: '{}' } },
                { id: 'second', type: 'function', function: { name: 'second_tool', arguments: '{}' } },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'Both tools completed.' } }],
      });

    const result = await orchestrator.invokeSubagent({
      subagentName: 'UnbudgetedAgent',
      instruction: 'Run both tools',
    });

    expect(firstHandler).toHaveBeenCalledTimes(1);
    expect(secondHandler).toHaveBeenCalledTimes(1);
    expect(result.toolsInvoked).toEqual(['first_tool', 'second_tool']);
    expect(result.content).toBe('Both tools completed.');
  });
});
