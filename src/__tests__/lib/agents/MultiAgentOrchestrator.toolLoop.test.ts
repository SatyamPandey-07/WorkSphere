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
  });
});
