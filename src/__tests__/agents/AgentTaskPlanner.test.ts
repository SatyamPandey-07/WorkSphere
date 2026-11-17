import { describe, it, expect, beforeEach } from 'vitest';
import {
  AgentTaskPlanner,
  TaskStatus,
  AgentCapability,
  type AgentProfile,
} from '../../core/agents/AgentTaskPlanner';

describe('AgentTaskPlanner - Multi-Agent Task Orchestration & Critical Path DAG Engine', () => {
  let planner: AgentTaskPlanner;

  const mockAgents: AgentProfile[] = [
    {
      id: 'agent_researcher',
      name: 'Atlas Researcher',
      capabilities: [AgentCapability.RESEARCH, AgentCapability.DATA_ANALYSIS],
      costPer1kTokens: 0.002,
      averageLatencyMs: 150,
      maxConcurrentTasks: 3,
      activeTaskCount: 0,
    },
    {
      id: 'agent_coder',
      name: 'Hephaestus Synthesizer',
      capabilities: [AgentCapability.CODE_SYNTHESIS, AgentCapability.TOOL_EXECUTION],
      costPer1kTokens: 0.005,
      averageLatencyMs: 300,
      maxConcurrentTasks: 2,
      activeTaskCount: 0,
    },
    {
      id: 'agent_verifier',
      name: 'Themis Verifier',
      capabilities: [AgentCapability.REASONING, AgentCapability.VERIFICATION],
      costPer1kTokens: 0.003,
      averageLatencyMs: 200,
      maxConcurrentTasks: 4,
      activeTaskCount: 0,
    },
  ];

  beforeEach(() => {
    planner = new AgentTaskPlanner('Audit and harden WorkSphere production microservices', 'goal_prod_audit');
    for (const a of mockAgents) {
      planner.registerAgent(a);
    }
  });

  describe('Goal Decomposition Templates', () => {
    it('decomposes WORKSPACE_AUDIT into 4 structured DAG tasks', () => {
      planner.decomposeGoal('WORKSPACE_AUDIT');
      const tasks = planner.getTasks();
      expect(tasks.length).toBe(4);

      const discovery = planner.getTask('task_audit_discovery')!;
      expect(discovery.dependencies).toHaveLength(0);

      const compliance = planner.getTask('task_compliance_analysis')!;
      expect(compliance.dependencies).toContain('task_audit_discovery');

      const telemetry = planner.getTask('task_telemetry_synthesis')!;
      expect(telemetry.dependencies).toContain('task_audit_discovery');

      const report = planner.getTask('task_audit_report')!;
      expect(report.dependencies).toEqual(
        expect.arrayContaining(['task_compliance_analysis', 'task_telemetry_synthesis'])
      );
    });

    it('decomposes CODE_MIGRATION into linear verification pipeline', () => {
      planner.decomposeGoal('CODE_MIGRATION');
      const tasks = planner.getTasks();
      expect(tasks.length).toBe(3);

      const codemod = planner.getTask('task_codemod_generation')!;
      expect(codemod.dependencies).toContain('task_ast_analysis');

      const verify = planner.getTask('task_unit_test_verification')!;
      expect(verify.dependencies).toContain('task_codemod_generation');
    });

    it('decomposes INCIDENT_RESPONSE into triage, root cause, and patch steps', () => {
      planner.decomposeGoal('INCIDENT_RESPONSE');
      const tasks = planner.getTasks();
      expect(tasks.length).toBe(3);

      const triage = planner.getTask('task_log_triage')!;
      const rootCause = planner.getTask('task_root_cause_isolation')!;
      const patch = planner.getTask('task_mitigation_patch')!;

      expect(triage.dependencies).toHaveLength(0);
      expect(rootCause.dependencies).toContain('task_log_triage');
      expect(patch.dependencies).toContain('task_root_cause_isolation');
    });
  });

  describe('Topological Sorting & Cycle Detection', () => {
    it('computes topological order respecting all parent prerequisites', () => {
      planner.decomposeGoal('WORKSPACE_AUDIT');
      const order = planner.computeTopologicalOrder();

      const discoveryIdx = order.indexOf('task_audit_discovery');
      const complianceIdx = order.indexOf('task_compliance_analysis');
      const telemetryIdx = order.indexOf('task_telemetry_synthesis');
      const reportIdx = order.indexOf('task_audit_report');

      expect(discoveryIdx).toBeLessThan(complianceIdx);
      expect(discoveryIdx).toBeLessThan(telemetryIdx);
      expect(complianceIdx).toBeLessThan(reportIdx);
      expect(telemetryIdx).toBeLessThan(reportIdx);
    });

    it('detects circular dependency and throws an error', () => {
      planner.decomposeGoal('CUSTOM');
      planner.addTask({
        id: 'node_a',
        title: 'Task A',
        description: 'desc',
        requiredCapabilities: [],
        estimatedTokens: 100,
        estimatedDurationMs: 100,
        dependencies: ['node_b'],
        status: TaskStatus.PENDING,
      });
      planner.addTask({
        id: 'node_b',
        title: 'Task B',
        description: 'desc',
        requiredCapabilities: [],
        estimatedTokens: 100,
        estimatedDurationMs: 100,
        dependencies: ['node_a'],
        status: TaskStatus.PENDING,
      });

      expect(() => planner.computeTopologicalOrder()).toThrowError(/Cycle detected/i);
    });
  });

  describe('Critical Path Method (CPM)', () => {
    it('calculates early/late dates, slack, and critical path for diamond DAG', () => {
      planner.decomposeGoal('WORKSPACE_AUDIT');
      // task_audit_discovery: 300ms
      // task_compliance_analysis: 600ms (path duration = 300 + 600 = 900)
      // task_telemetry_synthesis: 400ms (path duration = 300 + 400 = 700)
      // task_audit_report: 500ms (depends on both)
      // Critical path is discovery (300) -> compliance (600) -> report (500) = 1400ms

      const { criticalPath, totalDurationMs } = planner.computeCriticalPath();

      expect(totalDurationMs).toBe(1400);
      expect(criticalPath).toContain('task_audit_discovery');
      expect(criticalPath).toContain('task_compliance_analysis');
      expect(criticalPath).toContain('task_audit_report');

      const telemetryNode = planner.getTask('task_telemetry_synthesis')!;
      expect(telemetryNode.isCritical).toBe(false);
      expect(telemetryNode.slack).toBe(200); // 900 - 700 = 200ms slack
    });
  });

  describe('Agent Capability Matching & Task Routing', () => {
    it('matches tasks to the most suitable agent based on capability affinities', () => {
      planner.decomposeGoal('WORKSPACE_AUDIT');
      const assignments = planner.matchAndAssignAgents();

      expect(assignments.get('task_audit_discovery')).toBe('agent_researcher');
      expect(assignments.get('task_compliance_analysis')).toBe('agent_verifier');
      expect(assignments.get('task_telemetry_synthesis')).toBe('agent_researcher');
    });

    it('manages agent active load capacity', () => {
      planner.decomposeGoal('CODE_MIGRATION');
      planner.matchAndAssignAgents();

      const coder = planner.getAgents().find((a) => a.id === 'agent_coder')!;
      expect(coder.activeTaskCount).toBeGreaterThan(0);

      // Complete the task and verify activeTaskCount decrements
      planner.updateTaskStatus('task_codemod_generation', TaskStatus.COMPLETED, { linesWritten: 50 });
      expect(coder.activeTaskCount).toBe(0);
    });
  });

  describe('Execution Flow & Dynamic Replanning', () => {
    it('returns ready tasks whose dependencies are satisfied', () => {
      planner.decomposeGoal('WORKSPACE_AUDIT');
      const initialReady = planner.getReadyTasks();
      expect(initialReady.map((t) => t.id)).toEqual(['task_audit_discovery']);

      planner.updateTaskStatus('task_audit_discovery', TaskStatus.COMPLETED, { found: 12 });

      const nextReady = planner.getReadyTasks();
      const readyIds = nextReady.map((t) => t.id).sort();
      expect(readyIds).toEqual(['task_compliance_analysis', 'task_telemetry_synthesis']);
    });

    it('retries failed task within retry limits', () => {
      planner.decomposeGoal('WORKSPACE_AUDIT');
      const replan1 = planner.handleTaskFailure('task_audit_discovery', 'Network timeout');
      expect(replan1.message).toMatch(/retrying \(1\/2\)/);

      const node = planner.getTask('task_audit_discovery')!;
      expect(node.retryCount).toBe(1);
      expect(node.status).toBe(TaskStatus.PENDING);
    });

    it('cascades SKIPPED to downstream dependents when task exhausts retries', () => {
      planner.decomposeGoal('WORKSPACE_AUDIT');
      planner.handleTaskFailure('task_audit_discovery', 'err'); // retry 1
      planner.handleTaskFailure('task_audit_discovery', 'err'); // retry 2
      const finalReplan = planner.handleTaskFailure('task_audit_discovery', 'Permanent failure'); // exhausted

      expect(finalReplan.skippedDependentTaskIds).toEqual(
        expect.arrayContaining(['task_compliance_analysis', 'task_telemetry_synthesis', 'task_audit_report'])
      );

      expect(planner.getTask('task_audit_discovery')!.status).toBe(TaskStatus.FAILED);
      expect(planner.getTask('task_compliance_analysis')!.status).toBe(TaskStatus.SKIPPED);
      expect(planner.getTask('task_audit_report')!.status).toBe(TaskStatus.SKIPPED);
    });

    it('aggregates complete execution metrics', () => {
      planner.decomposeGoal('WORKSPACE_AUDIT');
      planner.matchAndAssignAgents();

      const metrics = planner.getExecutionMetrics();
      expect(metrics.totalTasks).toBe(4);
      expect(metrics.criticalPathDurationMs).toBe(1400);
      expect(metrics.totalEstimatedTokens).toBe(8700);
      expect(metrics.totalEstimatedCost).toBeGreaterThan(0);
    });
  });
});
