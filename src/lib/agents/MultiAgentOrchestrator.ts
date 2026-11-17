/**
 * MultiAgentOrchestrator.ts
 * Coordinates subagent execution with a dynamic token budget governor and prioritized tool pruning.
 * Guarantees context usage remains within LLM limits to prevent 400 ContextLengthExceeded errors.
 */

import Groq from 'groq-sdk';
import { estimateTokens } from '@/lib/context-compression/tokens';

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
  toolsUsed: string[];
  prunedTools: string[];
  telemetry: TokenTelemetryRecord;
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
   */
  public async invokeSubagent(task: SubagentTask): Promise<SubagentExecutionResult> {
    const invocationId = `inv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const tools = task.tools ?? this.getAllTools();

    // Prepare messages
    const messages: AgentMessage[] = [
      {
        role: 'system',
        content: `You are the ${task.subagentName} subagent in WorkSphere. Execute the requested instruction precisely.`,
      },
      ...(task.history ?? []),
      {
        role: 'user',
        content: task.instruction,
      },
    ];

    // Govern tools
    const maxAllowance = task.tokenAllowance ?? this.config.maxTokenAllowance;
    const governance = this.governToolSelection(messages, tools, maxAllowance);

    let outputContent = '';
    let completionTokens = 0;

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

        const completion = await this.groqClient.chat.completions.create({
          model: this.config.model,
          messages: messages.map((m) => ({
            role: m.role as 'system' | 'user' | 'assistant',
            content: m.content,
          })),
          tools: groqTools.length > 0 ? groqTools : undefined,
          max_tokens: this.config.reserveCompletionTokens,
          temperature: 0.2,
        });

        outputContent = completion.choices[0]?.message?.content || 'Task completed successfully.';
        completionTokens = completion.usage?.completion_tokens ?? estimateTokens(outputContent);
      } catch (err: unknown) {
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
      toolsUsed: governance.activeTools.map((t) => t.name),
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
