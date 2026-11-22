/**
 * @file AgentTaskPlanner.ts
 * @description Autonomous goal decomposition, multi-agent capability matching,
 * topological dependency DAG analysis, and dynamic replanning engine for WorkSphere.
 */

import { randomUUID } from 'node:crypto';

export const TaskStatus = {
  PENDING: 'PENDING',
  SCHEDULED: 'SCHEDULED',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
} as const;

export type TaskStatusType = typeof TaskStatus[keyof typeof TaskStatus];

export const AgentCapability = {
  RESEARCH: 'RESEARCH',
  CODE_SYNTHESIS: 'CODE_SYNTHESIS',
  DATA_ANALYSIS: 'DATA_ANALYSIS',
  REASONING: 'REASONING',
  VERIFICATION: 'VERIFICATION',
  TOOL_EXECUTION: 'TOOL_EXECUTION',
} as const;

export type AgentCapabilityType = typeof AgentCapability[keyof typeof AgentCapability];

export interface AgentProfile {
  id: string;
  name: string;
  capabilities: AgentCapabilityType[];
  costPer1kTokens: number;
  averageLatencyMs: number;
  maxConcurrentTasks: number;
  activeTaskCount: number;
}

export interface TaskNode {
  id: string;
  title: string;
  description: string;
  requiredCapabilities: AgentCapabilityType[];
  estimatedTokens: number;
  estimatedDurationMs: number;
  dependencies: string[]; // List of task IDs that must complete first
  status: TaskStatusType;
  assignedAgentId?: string;
  result?: unknown;
  error?: string;
  earlyStart: number;
  earlyFinish: number;
  lateStart: number;
  lateFinish: number;
  slack: number;
  isCritical: boolean;
  retryCount: number;
  maxRetries: number;
}

export interface TaskDependencyEdge {
  from: string;
  to: string;
}

export interface ExecutionMetrics {
  totalEstimatedDurationMs: number;
  criticalPathDurationMs: number;
  totalEstimatedTokens: number;
  totalEstimatedCost: number;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  skippedTasks: number;
}

export interface ReplanResult {
  modified: boolean;
  replannedTaskId?: string;
  replacementTaskIds: string[];
  skippedDependentTaskIds: string[];
  message: string;
}

export class AgentTaskPlanner {
  private _goalId: string;
  private _goalDescription: string;
  private _nodes: Map<string, TaskNode>;
  private _agents: Map<string, AgentProfile>;

  constructor(goalDescription: string, goalId?: string) {
    this._goalId = goalId || `goal_${randomUUID().slice(0, 8)}`;
    this._goalDescription = goalDescription;
    this._nodes = new Map();
    this._agents = new Map();
  }

  public get goalId(): string {
    return this._goalId;
  }

  public get goalDescription(): string {
    return this._goalDescription;
  }

  /**
   * Registers an agent profile capable of taking on subtasks.
   */
  public registerAgent(agent: AgentProfile): void {
    this._agents.set(agent.id, {
      ...agent,
      capabilities: [...agent.capabilities],
      activeTaskCount: agent.activeTaskCount || 0,
    });
  }

  /**
   * Retrieves registered agents.
   */
  public getAgents(): AgentProfile[] {
    return Array.from(this._agents.values());
  }

  /**
   * Adds an explicit subtask node to the goal execution graph.
   */
  public addTask(task: Omit<TaskNode, 'earlyStart' | 'earlyFinish' | 'lateStart' | 'lateFinish' | 'slack' | 'isCritical' | 'retryCount'> & {
    maxRetries?: number;
  }): TaskNode {
    if (this._nodes.has(task.id)) {
      throw new Error(`Task with id '${task.id}' already exists in plan.`);
    }

    const node: TaskNode = {
      ...task,
      dependencies: [...task.dependencies],
      requiredCapabilities: [...task.requiredCapabilities],
      earlyStart: 0,
      earlyFinish: task.estimatedDurationMs,
      lateStart: 0,
      lateFinish: task.estimatedDurationMs,
      slack: 0,
      isCritical: false,
      retryCount: 0,
      maxRetries: task.maxRetries ?? 2,
    };

    this._nodes.set(task.id, node);
    return node;
  }

  /**
   * Automatically decomposes high-level workspace goals into structured DAG plans.
   */
  public decomposeGoal(templateType: 'WORKSPACE_AUDIT' | 'CODE_MIGRATION' | 'INCIDENT_RESPONSE' | 'CUSTOM', customTasks?: Array<Omit<TaskNode, 'earlyStart' | 'earlyFinish' | 'lateStart' | 'lateFinish' | 'slack' | 'isCritical' | 'retryCount'>>): void {
    this._nodes.clear();

    if (templateType === 'WORKSPACE_AUDIT') {
      this.addTask({
        id: 'task_audit_discovery',
        title: 'Discover Workspace Resources & Endpoints',
        description: 'Scan active microservices, DB connections, and telemetry hooks.',
        requiredCapabilities: [AgentCapability.RESEARCH, AgentCapability.DATA_ANALYSIS],
        estimatedTokens: 1200,
        estimatedDurationMs: 300,
        dependencies: [],
        status: TaskStatus.PENDING,
      });

      this.addTask({
        id: 'task_compliance_analysis',
        title: 'Analyze Policy & Security Compliance',
        description: 'Check access tokens, encryption status, and role configurations.',
        requiredCapabilities: [AgentCapability.REASONING, AgentCapability.VERIFICATION],
        estimatedTokens: 2500,
        estimatedDurationMs: 600,
        dependencies: ['task_audit_discovery'],
        status: TaskStatus.PENDING,
      });

      this.addTask({
        id: 'task_telemetry_synthesis',
        title: 'Synthesize Telemetry & Latency Baselines',
        description: 'Aggregate historical p95 and error budget telemetry logs.',
        requiredCapabilities: [AgentCapability.DATA_ANALYSIS],
        estimatedTokens: 1800,
        estimatedDurationMs: 400,
        dependencies: ['task_audit_discovery'],
        status: TaskStatus.PENDING,
      });

      this.addTask({
        id: 'task_audit_report',
        title: 'Generate Consolidated Workspace Audit Report',
        description: 'Merge compliance findings and telemetry metrics into markdown summary.',
        requiredCapabilities: [AgentCapability.CODE_SYNTHESIS, AgentCapability.REASONING],
        estimatedTokens: 3200,
        estimatedDurationMs: 500,
        dependencies: ['task_compliance_analysis', 'task_telemetry_synthesis'],
        status: TaskStatus.PENDING,
      });
    } else if (templateType === 'CODE_MIGRATION') {
      this.addTask({
        id: 'task_ast_analysis',
        title: 'AST Dependency Scan',
        description: 'Parse codebase AST to detect deprecated API usages and symbol bindings.',
        requiredCapabilities: [AgentCapability.RESEARCH, AgentCapability.DATA_ANALYSIS],
        estimatedTokens: 2000,
        estimatedDurationMs: 450,
        dependencies: [],
        status: TaskStatus.PENDING,
      });

      this.addTask({
        id: 'task_codemod_generation',
        title: 'Generate Automated Codemods',
        description: 'Synthesize TypeScript AST codemod scripts for syntax modernization.',
        requiredCapabilities: [AgentCapability.CODE_SYNTHESIS],
        estimatedTokens: 4000,
        estimatedDurationMs: 900,
        dependencies: ['task_ast_analysis'],
        status: TaskStatus.PENDING,
      });

      this.addTask({
        id: 'task_unit_test_verification',
        title: 'Execute Verification Suite',
        description: 'Run targeted test harnesses and compile time assertion verification.',
        requiredCapabilities: [AgentCapability.VERIFICATION, AgentCapability.TOOL_EXECUTION],
        estimatedTokens: 1500,
        estimatedDurationMs: 700,
        dependencies: ['task_codemod_generation'],
        status: TaskStatus.PENDING,
      });
    } else if (templateType === 'INCIDENT_RESPONSE') {
      this.addTask({
        id: 'task_log_triage',
        title: 'Triage Stack Traces & Error Logs',
        description: 'Correlate recent error spikes with deployment timelines.',
        requiredCapabilities: [AgentCapability.DATA_ANALYSIS, AgentCapability.RESEARCH],
        estimatedTokens: 1500,
        estimatedDurationMs: 250,
        dependencies: [],
        status: TaskStatus.PENDING,
      });

      this.addTask({
        id: 'task_root_cause_isolation',
        title: 'Isolate Root Cause Component',
        description: 'Run causal inference on error rate versus service version.',
        requiredCapabilities: [AgentCapability.REASONING],
        estimatedTokens: 2200,
        estimatedDurationMs: 500,
        dependencies: ['task_log_triage'],
        status: TaskStatus.PENDING,
      });

      this.addTask({
        id: 'task_mitigation_patch',
        title: 'Produce Remediation Patch',
        description: 'Synthesize configuration rollback or hotfix PR.',
        requiredCapabilities: [AgentCapability.CODE_SYNTHESIS, AgentCapability.TOOL_EXECUTION],
        estimatedTokens: 3000,
        estimatedDurationMs: 650,
        dependencies: ['task_root_cause_isolation'],
        status: TaskStatus.PENDING,
      });
    } else if (customTasks && customTasks.length > 0) {
      for (const t of customTasks) {
        this.addTask(t);
      }
    }
  }

  /**
   * Validates DAG properties and returns topologically sorted task IDs.
   * Throws Error if a cyclic dependency is detected (Kahn's Algorithm).
   */
  public computeTopologicalOrder(): string[] {
    const inDegree = new Map<string, number>();
    const adjList = new Map<string, string[]>();

    for (const [id] of this._nodes) {
      inDegree.set(id, 0);
      adjList.set(id, []);
    }

    for (const [id, node] of this._nodes) {
      for (const depId of node.dependencies) {
        if (!this._nodes.has(depId)) {
          throw new Error(`Task '${id}' depends on non-existent task '${depId}'.`);
        }
        adjList.get(depId)!.push(id);
        inDegree.set(id, (inDegree.get(id) || 0) + 1);
      }
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree.entries()) {
      if (deg === 0) {
        queue.push(id);
      }
    }

    const sorted: string[] = [];
    while (queue.length > 0) {
      const u = queue.shift()!;
      sorted.push(u);

      for (const v of adjList.get(u) || []) {
        const nextDeg = inDegree.get(v)! - 1;
        inDegree.set(v, nextDeg);
        if (nextDeg === 0) {
          queue.push(v);
        }
      }
    }

    if (sorted.length !== this._nodes.size) {
      const cycleNodes = Array.from(this._nodes.keys()).filter((id) => !sorted.includes(id));
      throw new Error(`Cycle detected in task dependency graph involving nodes: ${cycleNodes.join(', ')}`);
    }

    return sorted;
  }

  /**
   * Performs Critical Path Method (CPM) forward and backward passes.
   * Populates earlyStart, earlyFinish, lateStart, lateFinish, slack, and isCritical.
   */
  public computeCriticalPath(): { criticalPath: string[]; totalDurationMs: number } {
    const sorted = this.computeTopologicalOrder();
    if (sorted.length === 0) {
      return { criticalPath: [], totalDurationMs: 0 };
    }

    // Forward Pass
    for (const id of sorted) {
      const node = this._nodes.get(id)!;
      let maxPredFinish = 0;
      for (const depId of node.dependencies) {
        const pred = this._nodes.get(depId)!;
        if (pred.earlyFinish > maxPredFinish) {
          maxPredFinish = pred.earlyFinish;
        }
      }
      node.earlyStart = maxPredFinish;
      node.earlyFinish = node.earlyStart + node.estimatedDurationMs;
    }

    // Project Total Duration is the maximum earlyFinish across all nodes
    let totalDurationMs = 0;
    for (const node of this._nodes.values()) {
      if (node.earlyFinish > totalDurationMs) {
        totalDurationMs = node.earlyFinish;
      }
    }

    // Backward Pass
    const reversed = [...sorted].reverse();
    // Build child adjacency map
    const successors = new Map<string, string[]>();
    for (const id of sorted) {
      successors.set(id, []);
    }
    for (const [id, node] of this._nodes) {
      for (const depId of node.dependencies) {
        successors.get(depId)!.push(id);
      }
    }

    for (const id of reversed) {
      const node = this._nodes.get(id)!;
      const succList = successors.get(id) || [];
      if (succList.length === 0) {
        node.lateFinish = totalDurationMs;
      } else {
        let minSuccStart = Number.POSITIVE_INFINITY;
        for (const succId of succList) {
          const succNode = this._nodes.get(succId)!;
          if (succNode.lateStart < minSuccStart) {
            minSuccStart = succNode.lateStart;
          }
        }
        node.lateFinish = minSuccStart;
      }
      node.lateStart = node.lateFinish - node.estimatedDurationMs;
      node.slack = Math.max(0, node.lateStart - node.earlyStart);
      node.isCritical = Math.abs(node.slack) < 1e-6;
    }

    const criticalPath = sorted.filter((id) => this._nodes.get(id)!.isCritical);
    return { criticalPath, totalDurationMs };
  }

  /**
   * Matches and assigns optimal available agents to each task in the plan.
   * Considers capability match, current capacity, cost, and latency.
   */
  public matchAndAssignAgents(): Map<string, string> {
    const assignments = new Map<string, string>();
    const sorted = this.computeTopologicalOrder();

    for (const taskId of sorted) {
      const task = this._nodes.get(taskId)!;
      let bestAgentId: string | undefined;
      let highestScore = -1;

      for (const agent of this._agents.values()) {
        if (agent.activeTaskCount >= agent.maxConcurrentTasks) {
          continue; // Agent at full capacity
        }

        // Capability Overlap
        const matchedCaps = task.requiredCapabilities.filter((c) =>
          agent.capabilities.includes(c)
        ).length;

        if (matchedCaps === 0 && task.requiredCapabilities.length > 0) {
          continue; // Missing core requirement
        }

        const capScore = matchedCaps / Math.max(1, task.requiredCapabilities.length);
        const costPenalty = (agent.costPer1kTokens * task.estimatedTokens) / 10000;
        const latencyPenalty = agent.averageLatencyMs / 2000;
        const loadPenalty = agent.activeTaskCount / Math.max(1, agent.maxConcurrentTasks);

        const score = capScore * 10 - costPenalty - latencyPenalty - loadPenalty * 2;

        if (score > highestScore) {
          highestScore = score;
          bestAgentId = agent.id;
        }
      }

      if (bestAgentId) {
        task.assignedAgentId = bestAgentId;
        assignments.set(taskId, bestAgentId);
        const agent = this._agents.get(bestAgentId)!;
        agent.activeTaskCount += 1;
      }
    }

    return assignments;
  }

  /**
   * Identifies all tasks currently ready to execute:
   * dependencies must all be COMPLETED, and current task is PENDING.
   */
  public getReadyTasks(): TaskNode[] {
    const ready: TaskNode[] = [];
    for (const node of this._nodes.values()) {
      if (node.status !== TaskStatus.PENDING) {
        continue;
      }

      const allDepsDone = node.dependencies.every((depId) => {
        const dep = this._nodes.get(depId);
        return dep && dep.status === TaskStatus.COMPLETED;
      });

      if (allDepsDone) {
        ready.push(node);
      }
    }
    return ready;
  }

  /**
   * Updates task status and executes state transitions.
   */
  public updateTaskStatus(taskId: string, newStatus: TaskStatusType, resultOrError?: unknown): void {
    const node = this._nodes.get(taskId);
    if (!node) {
      throw new Error(`Task '${taskId}' not found.`);
    }

    node.status = newStatus;
    if (newStatus === TaskStatus.COMPLETED) {
      node.result = resultOrError;
      if (node.assignedAgentId) {
        const agent = this._agents.get(node.assignedAgentId);
        if (agent && agent.activeTaskCount > 0) {
          agent.activeTaskCount -= 1;
        }
      }
    } else if (newStatus === TaskStatus.FAILED) {
      node.error = typeof resultOrError === 'string' ? resultOrError : JSON.stringify(resultOrError);
      if (node.assignedAgentId) {
        const agent = this._agents.get(node.assignedAgentId);
        if (agent && agent.activeTaskCount > 0) {
          agent.activeTaskCount -= 1;
        }
      }
    }
  }

  /**
   * Handles failure with dynamic replanning:
   * - Retries if retryCount < maxRetries
   * - Injects recovery task if recoverable
   * - Otherwise safely cascades SKIPPED status to downstream dependents while keeping unrelated subgraphs running.
   */
  public handleTaskFailure(failedTaskId: string, errorMessage: string): ReplanResult {
    const node = this._nodes.get(failedTaskId);
    if (!node) {
      throw new Error(`Task '${failedTaskId}' not found.`);
    }

    if (node.retryCount < node.maxRetries) {
      node.retryCount += 1;
      node.status = TaskStatus.PENDING;
      return {
        modified: true,
        replannedTaskId: failedTaskId,
        replacementTaskIds: [],
        skippedDependentTaskIds: [],
        message: `Task '${failedTaskId}' retrying (${node.retryCount}/${node.maxRetries})`,
      };
    }

    // Mark task as permanently failed
    this.updateTaskStatus(failedTaskId, TaskStatus.FAILED, errorMessage);

    // Find all dependent tasks recursively
    const downstream = this.findDownstreamDependents(failedTaskId);
    for (const depId of downstream) {
      const depNode = this._nodes.get(depId)!;
      depNode.status = TaskStatus.SKIPPED;
      depNode.error = `Cascaded skip from failed prerequisite '${failedTaskId}'`;
      if (depNode.assignedAgentId) {
        const agent = this._agents.get(depNode.assignedAgentId);
        if (agent && agent.activeTaskCount > 0) {
          agent.activeTaskCount -= 1;
        }
      }
    }

    return {
      modified: true,
      replannedTaskId: failedTaskId,
      replacementTaskIds: [],
      skippedDependentTaskIds: downstream,
      message: `Task '${failedTaskId}' exhausted retries. Safely skipped ${downstream.length} dependent tasks.`,
    };
  }

  /**
   * Traverses all downstream dependent tasks recursively.
   */
  private findDownstreamDependents(taskId: string): string[] {
    const dependents: Set<string> = new Set();
    const queue = [taskId];

    while (queue.length > 0) {
      const curr = queue.shift()!;
      for (const [id, node] of this._nodes) {
        if (node.dependencies.includes(curr) && !dependents.has(id)) {
          dependents.add(id);
          queue.push(id);
        }
      }
    }

    return Array.from(dependents);
  }

  /**
   * Generates summary execution metrics for the goal plan.
   */
  public getExecutionMetrics(): ExecutionMetrics {
    const { criticalPathDurationMs } = this.computeCriticalPath();
    let totalDuration = 0;
    let totalTokens = 0;
    let totalCost = 0;
    let completed = 0;
    let failed = 0;
    let skipped = 0;

    for (const node of this._nodes.values()) {
      totalDuration += node.estimatedDurationMs;
      totalTokens += node.estimatedTokens;

      if (node.assignedAgentId) {
        const agent = this._agents.get(node.assignedAgentId);
        if (agent) {
          totalCost += (agent.costPer1kTokens * node.estimatedTokens) / 1000;
        }
      }

      if (node.status === TaskStatus.COMPLETED) completed += 1;
      else if (node.status === TaskStatus.FAILED) failed += 1;
      else if (node.status === TaskStatus.SKIPPED) skipped += 1;
    }

    return {
      totalEstimatedDurationMs: totalDuration,
      criticalPathDurationMs,
      totalEstimatedTokens: totalTokens,
      totalEstimatedCost: Number(totalCost.toFixed(4)),
      totalTasks: this._nodes.size,
      completedTasks: completed,
      failedTasks: failed,
      skippedTasks: skipped,
    };
  }

  /**
   * Returns all tasks as a list.
   */
  public getTasks(): TaskNode[] {
    return Array.from(this._nodes.values());
  }

  /**
   * Returns a specific task node.
   */
  public getTask(id: string): TaskNode | undefined {
    return this._nodes.get(id);
  }
}
