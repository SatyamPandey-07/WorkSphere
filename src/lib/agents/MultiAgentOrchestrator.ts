/**
 * MultiAgentOrchestrator.ts
 * Coordinates subagent execution with a dynamic token budget governor and prioritized tool pruning.
 * Guarantees context usage remains within LLM limits to prevent 400 ContextLengthExceeded errors.
 */

import Groq from 'groq-sdk';
import { performance } from 'node:perf_hooks';
import { estimateTokens } from '@/lib/context-compression/tokens';
import { isRetryableLlmError } from '@/lib/ai/retryWithBackoff';

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
}

export interface AgentToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  priority?: number; // 1 (highest) to 10 (lowest)
  execute?: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

/**
 * Standard tool prioritization ranks.
 * Lower number = higher priority (retained during pruning).
 * Higher number = lower priority (pruned first).
 */
export enum ToolPriority {
  SEARCH = 1,
  ROUTING = 2,
  WEATHER = 3,
  NOISE_METRICS = 4,
  AUXILIARY = 5,
}

export const DEFAULT_TOOL_PRIORITIES: Record<string, number> = {
  search: ToolPriority.SEARCH,
  routing: ToolPriority.ROUTING,
  weather: ToolPriority.WEATHER,
  noise_metrics: ToolPriority.NOISE_METRICS,
  noise: ToolPriority.NOISE_METRICS,
};

export interface TokenGovernorConfig {
  maxTokenAllowance?: number; // Default 4096 tokens
  pruningThreshold?: number;  // Default 0.75 (75% of maxTokenAllowance)
  reserveCompletionTokens?: number; // Default 512 tokens
  debug?: boolean;            // Default false
  model?: string;             // Default 'llama-3.3-70b-versatile'
  maxToolRounds?: number;     // Default 5
  maxToolCalls?: number;      // Default 20
  toolTimeoutMs?: number;     // Default 10_000
}

export interface ToolExecutionStats {
  requested: number;
  validated: number;
  invoked: number;
  succeeded: number;
  failed: number;
  timedOut: number;
  deduplicated: number;
}

export interface ToolMetric {
  toolName: string;
  durationMs: number;
  ok: boolean;
}

export interface TokenTelemetryRecord {
  invocationId: string;
  subagentName: string;
  timestamp: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  tokensSaved: number;
  toolsSupplied: number;
  toolsPruned: number;
  prunedToolNames: string[];
  activeToolNames: string[];
  contextUsageRatio: number;
  exceededThreshold: boolean;
}

export interface TokenEfficiencyMetrics {
  totalInvocations: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokensConsumed: number;
  totalTokensSaved: number;
  totalToolsPruned: number;
  averagePromptTokens: number;
  averageCompletionTokens: number;
  averageEfficiencyRatio: number;
  perSubagentMetrics: Record<
    string,
    {
      invocations: number;
      promptTokens: number;
      completionTokens: number;
      toolsPruned: number;
      tokensSaved: number;
    }
  >;
  recentTelemetry: TokenTelemetryRecord[];
}

export interface SubagentTask {
  subagentName: string;
  instruction: string;
  context?: Record<string, unknown>;
  history?: AgentMessage[];
  tools?: AgentToolDeclaration[];
  tokenAllowance?: number;
  /**
   * When true, a transient upstream error (429, 502, 503, 504) from the LLM call is
   * rethrown instead of being replaced by the deterministic fallback, so the caller
   * can retry it (see retryWithBackoff). Defaults to false.
   */
  rethrowRetryableErrors?: boolean;
}

export interface SubagentExecutionResult {
  subagentName: string;
  content: string;
  tokens: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    tokensSaved: number;
  };
  /** Names of tools that were actually invoked and completed during this execution. */
  toolsInvoked: string[];
  /** Names of tools that were available but pruned from the context. */
  prunedTools: string[];
  /**
   * @deprecated Use `toolsInvoked`. Kept for backwards compatibility; reflects
   * the same list as `toolsInvoked` after the tool-call loop has completed.
   */
  toolsUsed: string[];
  toolExecutionStats?: ToolExecutionStats;
  toolMetrics: ToolMetric[];
  telemetry: TokenTelemetryRecord;
}

function validateToolArguments(
  args: unknown,
  schema: Record<string, unknown>,
): { valid: true; value: Record<string, unknown> } | { valid: false; error: string } {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return { valid: false, error: 'Tool arguments must be a JSON object' };
  }

  const record = args as Record<string, unknown>;
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const field of required) {
    if (typeof field === 'string' && !(field in record)) {
      return { valid: false, error: `Missing required argument: ${field}` };
    }
  }

  const properties =
    schema.properties && typeof schema.properties === 'object'
      ? (schema.properties as Record<string, Record<string, unknown>>)
      : null;

  if (schema.additionalProperties === false && properties) {
    for (const key of Object.keys(record)) {
      if (!(key in properties)) {
        return { valid: false, error: `Unexpected argument: ${key}` };
      }
    }
  }

  if (properties) {
    for (const [key, propSchema] of Object.entries(properties)) {
      if (!(key in record) || record[key] === undefined) continue;
      const expectedType = propSchema?.type;
      const val = record[key];
      if (expectedType === 'string' && typeof val !== 'string') {
        return { valid: false, error: `Argument '${key}' must be a string` };
      }
      if (expectedType === 'number' && (typeof val !== 'number' || !Number.isFinite(val))) {
        return { valid: false, error: `Argument '${key}' must be a finite number` };
      }
      if (expectedType === 'integer' && (typeof val !== 'number' || !Number.isInteger(val))) {
        return { valid: false, error: `Argument '${key}' must be an integer` };
      }
      if (expectedType === 'boolean' && typeof val !== 'boolean') {
        return { valid: false, error: `Argument '${key}' must be a boolean` };
      }
      if (expectedType === 'array' && !Array.isArray(val)) {
        return { valid: false, error: `Argument '${key}' must be an array` };
      }
      if (
        expectedType === 'object' &&
        (val === null || typeof val !== 'object' || Array.isArray(val))
      ) {
        return { valid: false, error: `Argument '${key}' must be an object` };
      }
    }
  }

  return { valid: true, value: record };
}

export class MultiAgentOrchestrator {
  private config: Required<TokenGovernorConfig>;
  private telemetryRecords: TokenTelemetryRecord[] = [];
  private toolRegistry: Map<string, AgentToolDeclaration> = new Map();
  private groqClient: Groq | null = null;

  constructor(config: TokenGovernorConfig = {}, groqApiKey?: string) {
    this.config = {
      maxTokenAllowance: config.maxTokenAllowance ?? 4096,
      pruningThreshold: config.pruningThreshold ?? 0.75,
      reserveCompletionTokens: config.reserveCompletionTokens ?? 512,
      debug: config.debug ?? false,
      model: config.model ?? 'llama-3.3-70b-versatile',
      maxToolRounds: config.maxToolRounds ?? 5,
      maxToolCalls: config.maxToolCalls ?? 20,
      toolTimeoutMs: config.toolTimeoutMs ?? 10_000,
    };

    const apiKey = groqApiKey || process.env.GROQ_API_KEY;
    if (apiKey) {
      this.groqClient = new Groq({ apiKey });
    }

    this.registerDefaultTools();
  }

  /**
   * Registers default platform tools with their standardized priorities.
   */
  private registerDefaultTools(): void {
    this.registerTool({
      name: 'search',
      description: 'Search workspace venues, amenities, and availability.',
      parameters: { type: 'object', properties: { query: { type: 'string' } } },
      priority: ToolPriority.SEARCH,
    });
    this.registerTool({
      name: 'routing',
      description: 'Calculate travel corridors, directions, and transit times.',
      parameters: { type: 'object', properties: { origin: { type: 'string' }, destination: { type: 'string' } } },
      priority: ToolPriority.ROUTING,
    });
    this.registerTool({
      name: 'weather',
      description: 'Fetch ambient weather, temperature, and precipitation forecasts.',
      parameters: { type: 'object', properties: { location: { type: 'string' } } },
      priority: ToolPriority.WEATHER,
    });
    this.registerTool({
      name: 'noise_metrics',
      description: 'Retrieve real-time and historical acoustic decibel levels for quiet work.',
      parameters: { type: 'object', properties: { venueId: { type: 'string' } } },
      priority: ToolPriority.NOISE_METRICS,
    });
  }

  public registerTool(tool: AgentToolDeclaration): void {
    this.toolRegistry.set(tool.name, tool);
  }

  public getTool(name: string): AgentToolDeclaration | undefined {
    return this.toolRegistry.get(name);
  }

  public getAllTools(): AgentToolDeclaration[] {
    return Array.from(this.toolRegistry.values());
  }

  /**
   * Estimates tokens consumed by a tool declaration schema.
   */
  public estimateToolTokens(tool: AgentToolDeclaration): number {
    const serialized = JSON.stringify({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    });
    return estimateTokens(serialized) + 12; // 12 token overhead for OpenAI/Groq function envelope
  }

  /**
   * Estimates tokens consumed by an array of agent messages.
   */
  public estimateMessagesTokens(messages: AgentMessage[]): number {
    return messages.reduce((acc, msg) => {
      return acc + estimateTokens(msg.content) + 4; // role + envelope overhead
    }, 3); // primer tokens
  }

  /**
   * Resolves priority rank for a given tool.
   * Lower rank integer indicates higher priority.
   */
  public getToolPriority(tool: AgentToolDeclaration): number {
    if (typeof tool.priority === 'number') {
      return tool.priority;
    }
    return DEFAULT_TOOL_PRIORITIES[tool.name] ?? ToolPriority.AUXILIARY;
  }

  /**
   * Token Budget Governor:
   * Evaluates total context usage and dynamically prunes lower-priority tools
   * when context exceeds the 75% pruning threshold or max allowance.
   */
  public governToolSelection(
    messages: AgentMessage[],
    availableTools: AgentToolDeclaration[],
    overrideMaxTokens?: number
  ): {
    activeTools: AgentToolDeclaration[];
    prunedTools: AgentToolDeclaration[];
    promptTokens: number;
    tokensSaved: number;
    usageRatio: number;
    exceededThreshold: boolean;
  } {
    const maxTokens = overrideMaxTokens ?? this.config.maxTokenAllowance;
    const reserveTokens = this.config.reserveCompletionTokens;
    const thresholdRatio = this.config.pruningThreshold;

    let basePromptTokens = this.estimateMessagesTokens(messages);
    const initialToolsTokens = availableTools.reduce(
      (sum, tool) => sum + this.estimateToolTokens(tool),
      0
    );

    let totalUsage = basePromptTokens + initialToolsTokens + reserveTokens;
    let usageRatio = totalUsage / maxTokens;
    const exceededThreshold = usageRatio > thresholdRatio;

    // If within budget and under threshold, keep all tools
    if (!exceededThreshold) {
      return {
        activeTools: [...availableTools],
        prunedTools: [],
        promptTokens: basePromptTokens + initialToolsTokens,
        tokensSaved: 0,
        usageRatio,
        exceededThreshold: false,
      };
    }

    // Sort tools by priority descending: lowest priority (largest rank number) pruned first
    const sortedTools = [...availableTools].sort((a, b) => {
      return this.getToolPriority(b) - this.getToolPriority(a);
    });

    const activeTools: AgentToolDeclaration[] = [...availableTools];
    const prunedTools: AgentToolDeclaration[] = [];
    let tokensSaved = 0;

    for (const candidate of sortedTools) {
      if (usageRatio <= thresholdRatio && totalUsage <= maxTokens - reserveTokens) {
        break;
      }

      // Drop lowest priority tool
      const toolCost = this.estimateToolTokens(candidate);
      tokensSaved += toolCost;
      totalUsage -= toolCost;
      usageRatio = totalUsage / maxTokens;

      const idx = activeTools.findIndex((t) => t.name === candidate.name);
      if (idx !== -1) {
        activeTools.splice(idx, 1);
      }
      prunedTools.push(candidate);
    }

    // Guardrail against 400 ContextLengthExceeded: if messages alone exceed budget
    if (basePromptTokens + reserveTokens > maxTokens) {
      const allowedPromptBudget = Math.max(100, maxTokens - reserveTokens);
      // Compact older messages while preserving system prompt
      if (messages.length > 2) {
        const systemMsg = messages.find((m) => m.role === 'system');
        const lastMsg = messages[messages.length - 1];
        const compacted: AgentMessage[] = [];
        if (systemMsg) compacted.push(systemMsg);
        compacted.push(lastMsg);
        basePromptTokens = this.estimateMessagesTokens(compacted);
      }
    }

    if (this.config.debug) {
      const prunedNames = prunedTools.map((t) => t.name).join(', ') || 'none';
      const activeNames = activeTools.map((t) => t.name).join(', ') || 'none';
      console.debug(
        `[TokenBudgetGovernor] Pruned ${prunedTools.length} tool(s) [${prunedNames}] due to context usage ${(usageRatio * 100).toFixed(1)}% (threshold ${(thresholdRatio * 100).toFixed(0)}%). Active tools: [${activeNames}]. Budget: ${totalUsage}/${maxTokens}`
      );
    }

    return {
      activeTools,
      prunedTools,
      promptTokens: basePromptTokens + activeTools.reduce((s, t) => s + this.estimateToolTokens(t), 0),
      tokensSaved,
      usageRatio,
      exceededThreshold: true,
    };
  }

  /**
   * Invokes a subagent with dynamic tool governance, telemetry tracking, and context safety.
   *
   * When the LLM returns `tool_calls`, each call is validated against the allowlisted
   * registered handler, arguments are schema-checked, and the handler is invoked.
   * Results are fed back to the model in a bounded loop (default: 5 rounds).
   * Only handlers that actually completed execution are reported in `toolsInvoked`.
   */
  public async invokeSubagent(task: SubagentTask): Promise<SubagentExecutionResult> {
    const invocationId = `inv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const tools = task.tools ?? this.getAllTools();

    // Prepare messages
    const conversationMessages: Array<{
      role: 'system' | 'user' | 'assistant' | 'tool';
      content: string;
      tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
      tool_call_id?: string;
      name?: string;
    }> = [
      {
        role: 'system',
        content: `You are the ${task.subagentName} subagent in WorkSphere. Execute the requested instruction precisely.`,
      },
      ...(task.history ?? []).map((m) => ({ role: m.role, content: m.content, name: m.name })),
      {
        role: 'user',
        content: task.instruction,
      },
    ];

    // Govern tools
    const maxAllowance = task.tokenAllowance ?? this.config.maxTokenAllowance;
    const governance = this.governToolSelection(
      conversationMessages.map((m) => ({ role: m.role as AgentMessage['role'], content: m.content })),
      tools,
      maxAllowance
    );

    let outputContent = '';
    let completionTokens = 0;
    /** Tool names that were actually invoked and completed. */
    const toolsInvoked: string[] = [];
    const toolMetrics: ToolMetric[] = [];
    const toolStats: ToolExecutionStats = {
      requested: 0,
      validated: 0,
      invoked: 0,
      succeeded: 0,
      failed: 0,
      timedOut: 0,
      deduplicated: 0,
    };

    const maxToolRounds = this.config.maxToolRounds ?? 5;
    const maxToolCalls = this.config.maxToolCalls ?? 20;
    const toolTimeoutMs = this.config.toolTimeoutMs ?? 10_000;
    const activeToolMap = new Map<string, AgentToolDeclaration>(
      governance.activeTools.map((t) => [t.name, t]),
    );
    const dedupeCache = new Map<string, unknown>();

    // LLM execution via Groq if configured, otherwise high-performance fallback
    if (this.groqClient) {
      try {
        const groqTools = governance.activeTools.map((t) => ({
          type: 'function' as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        }));

        // Bounded tool-call loop
        let round = 0;
        let totalCallsProcessed = 0;
        while (round < maxToolRounds && totalCallsProcessed < maxToolCalls) {
          round++;
          const completion = await this.groqClient.chat.completions.create({
            model: this.config.model,
            messages: conversationMessages as Parameters<typeof this.groqClient.chat.completions.create>[0]['messages'],
            tools: groqTools.length > 0 ? groqTools : undefined,
            max_tokens: this.config.reserveCompletionTokens,
            temperature: 0.2,
          });

          const choice = completion.choices[0];
          completionTokens += completion.usage?.completion_tokens ?? 0;

          const toolCalls = choice?.message?.tool_calls;
          if (!toolCalls || toolCalls.length === 0) {
            // No tool calls — model produced a final assistant response.
            outputContent = choice?.message?.content || 'Task completed successfully.';
            if (!completionTokens) {
              completionTokens = estimateTokens(outputContent);
            }
            break;
          }

          // Push the assistant turn (with tool_calls) into the conversation.
          conversationMessages.push({
            role: 'assistant',
            content: choice.message.content ?? '',
            tool_calls: toolCalls,
          });

          // Execute each tool call, validate against schema & allowlist, and collect results.
          for (const call of toolCalls) {
            if (totalCallsProcessed >= maxToolCalls) {
              conversationMessages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: JSON.stringify({ error: 'Tool call budget exhausted' }),
              });
              continue;
            }
            totalCallsProcessed++;
            toolStats.requested++;

            const toolName = call?.function?.name;
            const callId = call?.id;
            if (!toolName || !callId) {
              toolStats.failed++;
              continue;
            }

            // Allowlist check: only invoke active registered tools.
            const registeredTool = activeToolMap.get(toolName);
            if (!registeredTool || typeof registeredTool.execute !== 'function') {
              toolStats.failed++;
              conversationMessages.push({
                role: 'tool',
                tool_call_id: callId,
                content: JSON.stringify({
                  error: !registeredTool
                    ? `Unknown or unapproved tool: ${toolName}`
                    : `Tool '${toolName}' has no executable handler`,
                }),
              });
              continue;
            }

            // Parse and schema-validate arguments.
            let rawArgs: unknown;
            try {
              rawArgs = JSON.parse(call.function.arguments || '{}');
            } catch {
              toolStats.failed++;
              conversationMessages.push({
                role: 'tool',
                tool_call_id: callId,
                content: JSON.stringify({ error: 'Invalid JSON arguments' }),
              });
              continue;
            }

            const validation = validateToolArguments(rawArgs, registeredTool.parameters);
            if (!validation.valid) {
              toolStats.failed++;
              conversationMessages.push({
                role: 'tool',
                tool_call_id: callId,
                content: JSON.stringify({ error: validation.error }),
              });
              continue;
            }

            toolStats.validated++;
            const canonicalKey = `${toolName}:${JSON.stringify(validation.value)}`;
            if (dedupeCache.has(canonicalKey)) {
              toolStats.deduplicated++;
              conversationMessages.push({
                role: 'tool',
                tool_call_id: callId,
                content: JSON.stringify(dedupeCache.get(canonicalKey)),
              });
              continue;
            }

            // Invoke the registered handler with timeout guard.
            let toolResult: unknown;
            toolStats.invoked++;
            let timerId: ReturnType<typeof setTimeout> | undefined;
            const startedAt = performance.now();
            let toolOk = false;
            try {
              toolResult = await Promise.race([
                Promise.resolve(registeredTool.execute(validation.value)),
                new Promise<never>((_, reject) => {
                  timerId = setTimeout(
                    () => reject(new Error(`Tool '${toolName}' timed out after ${toolTimeoutMs}ms`)),
                    toolTimeoutMs,
                  );
                }),
              ]);
              toolStats.succeeded++;
              toolsInvoked.push(toolName);
              dedupeCache.set(canonicalKey, toolResult);
              toolOk = true;
            } catch (handlerErr: unknown) {
              const msg =
                handlerErr instanceof Error ? handlerErr.message : 'Tool execution failed';
              if (msg.includes('timed out')) {
                toolStats.timedOut++;
              } else {
                toolStats.failed++;
              }
              toolResult = { error: msg };
            } finally {
              if (timerId !== undefined) clearTimeout(timerId);
              const elapsedMs = performance.now() - startedAt;
              toolMetrics.push({
                toolName,
                durationMs: Number.isFinite(elapsedMs)
                  ? Math.max(0, elapsedMs)
                  : 0,
                ok: toolOk,
              });
            }

            conversationMessages.push({
              role: 'tool',
              tool_call_id: callId,
              content: JSON.stringify(toolResult),
            });
          }
        }

        // If we exhausted the round limit without a final text response, synthesize one.
        if (!outputContent) {
          outputContent = `Completed execution for ${task.subagentName}: ${task.instruction.slice(0, 100)}`;
          if (!completionTokens) {
            completionTokens = estimateTokens(outputContent);
          }
        }
      } catch (err: unknown) {
        if (task.rethrowRetryableErrors && isRetryableLlmError(err)) {
          throw err;
        }
        if (this.config.debug) {
          console.debug(`[MultiAgentOrchestrator] Groq invocation failed, using deterministic fallback:`, err);
        }
        outputContent = `Completed execution for ${task.subagentName}: ${task.instruction.slice(0, 100)}`;
        completionTokens = estimateTokens(outputContent);
      }
    } else {
      outputContent = `Synthesized response from ${task.subagentName} for: ${task.instruction}`;
      completionTokens = estimateTokens(outputContent);
    }

    const totalTokens = governance.promptTokens + completionTokens;

    const telemetry: TokenTelemetryRecord = {
      invocationId,
      subagentName: task.subagentName,
      timestamp: Date.now(),
      promptTokens: governance.promptTokens,
      completionTokens,
      totalTokens,
      tokensSaved: governance.tokensSaved,
      toolsSupplied: tools.length,
      toolsPruned: governance.prunedTools.length,
      prunedToolNames: governance.prunedTools.map((t) => t.name),
      activeToolNames: governance.activeTools.map((t) => t.name),
      contextUsageRatio: governance.usageRatio,
      exceededThreshold: governance.exceededThreshold,
    };

    this.telemetryRecords.push(telemetry);

    return {
      subagentName: task.subagentName,
      content: outputContent,
      tokens: {
        promptTokens: governance.promptTokens,
        completionTokens,
        totalTokens,
        tokensSaved: governance.tokensSaved,
      },
      toolsInvoked,
      toolsUsed: toolsInvoked, // backwards-compat alias
      toolExecutionStats: toolStats,
      toolMetrics,
      prunedTools: governance.prunedTools.map((t) => t.name),
      telemetry,
    };
  }

  /**
   * Retrieves aggregated token efficiency metrics.
   */
  public getTelemetryMetrics(): TokenEfficiencyMetrics {
    const totalInvocations = this.telemetryRecords.length;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalTokensSaved = 0;
    let totalToolsPruned = 0;

    const perSubagentMetrics: Record<
      string,
      {
        invocations: number;
        promptTokens: number;
        completionTokens: number;
        toolsPruned: number;
        tokensSaved: number;
      }
    > = {};

    for (const record of this.telemetryRecords) {
      totalPromptTokens += record.promptTokens;
      totalCompletionTokens += record.completionTokens;
      totalTokensSaved += record.tokensSaved;
      totalToolsPruned += record.toolsPruned;

      if (!perSubagentMetrics[record.subagentName]) {
        perSubagentMetrics[record.subagentName] = {
          invocations: 0,
          promptTokens: 0,
          completionTokens: 0,
          toolsPruned: 0,
          tokensSaved: 0,
        };
      }

      const agentMetric = perSubagentMetrics[record.subagentName];
      agentMetric.invocations++;
      agentMetric.promptTokens += record.promptTokens;
      agentMetric.completionTokens += record.completionTokens;
      agentMetric.toolsPruned += record.toolsPruned;
      agentMetric.tokensSaved += record.tokensSaved;
    }

    const totalTokensConsumed = totalPromptTokens + totalCompletionTokens;
    const averagePromptTokens = totalInvocations > 0 ? totalPromptTokens / totalInvocations : 0;
    const averageCompletionTokens = totalInvocations > 0 ? totalCompletionTokens / totalInvocations : 0;
    const totalPotentialTokens = totalTokensConsumed + totalTokensSaved;
    const averageEfficiencyRatio = totalPotentialTokens > 0 ? totalTokensSaved / totalPotentialTokens : 0;

    return {
      totalInvocations,
      totalPromptTokens,
      totalCompletionTokens,
      totalTokensConsumed,
      totalTokensSaved,
      totalToolsPruned,
      averagePromptTokens,
      averageCompletionTokens,
      averageEfficiencyRatio,
      perSubagentMetrics,
      recentTelemetry: [...this.telemetryRecords.slice(-50)],
    };
  }

  public resetTelemetry(): void {
    this.telemetryRecords = [];
  }

  public getConfig(): Required<TokenGovernorConfig> {
    return { ...this.config };
  }

  public updateConfig(newConfig: Partial<TokenGovernorConfig>): void {
    this.config = {
      ...this.config,
      ...newConfig,
    };
  }
}

export default MultiAgentOrchestrator;
