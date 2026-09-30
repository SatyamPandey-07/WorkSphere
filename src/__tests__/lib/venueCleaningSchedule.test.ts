/**
 * Tests for venue cleaning schedule management.
 */

type CleaningType = "quick" | "standard" | "deep";

interface CleaningTask {
  id: string;
  venueId: string;
  type: CleaningType;
  scheduledAt: number;
  completedAt?: number;
  durationMinutes: number;
}

const CLEANING_DURATIONS: Record<CleaningType, number> = {
  quick: 15,
  standard: 45,
  deep: 120,
};

function isCompletedTask(task: CleaningTask): boolean {
  return task.completedAt !== undefined;
}

function pendingTasks(tasks: CleaningTask[], venueId: string): CleaningTask[] {
  return tasks
    .filter((t) => t.venueId === venueId && !isCompletedTask(t))
    .sort((a, b) => a.scheduledAt - b.scheduledAt);
}

function completeTask(task: CleaningTask, nowMs: number): CleaningTask {
  return { ...task, completedAt: nowMs };
}

function estimatedFinishMs(task: CleaningTask): number {
  return task.scheduledAt + task.durationMinutes * 60_000;
}

function totalCleaningMinutes(tasks: CleaningTask[], venueId: string): number {
  return tasks
    .filter((t) => t.venueId === venueId && isCompletedTask(t))
    .reduce((sum, t) => sum + t.durationMinutes, 0);
}

const NOW = 1_700_000_000_000;
const TASKS: CleaningTask[] = [
  { id: "c1", venueId: "v1", type: "quick",    scheduledAt: NOW + 3600_000, durationMinutes: CLEANING_DURATIONS.quick    },
  { id: "c2", venueId: "v1", type: "standard", scheduledAt: NOW + 7200_000, durationMinutes: CLEANING_DURATIONS.standard  },
  { id: "c3", venueId: "v1", type: "deep",     scheduledAt: NOW - 3600_000, durationMinutes: CLEANING_DURATIONS.deep, completedAt: NOW - 1800_000 },
  { id: "c4", venueId: "v2", type: "quick",    scheduledAt: NOW + 1000,     durationMinutes: CLEANING_DURATIONS.quick     },
];

describe("Venue cleaning schedule", () => {
  it("pendingTasks: v1 has 2 pending, sorted by scheduledAt", () => {
    const pending = pendingTasks(TASKS, "v1");
    expect(pending).toHaveLength(2);
    expect(pending[0].id).toBe("c1");
  });

  it("pendingTasks: v2 has 1 pending", () => {
    expect(pendingTasks(TASKS, "v2")).toHaveLength(1);
  });

  it("isCompletedTask: task with completedAt → true", () => {
    expect(isCompletedTask(TASKS[2])).toBe(true);
  });

  it("isCompletedTask: pending task → false", () => {
    expect(isCompletedTask(TASKS[0])).toBe(false);
  });

  it("completeTask sets completedAt", () => {
    const done = completeTask(TASKS[0], NOW);
    expect(done.completedAt).toBe(NOW);
  });

  it("completeTask is immutable", () => {
    completeTask(TASKS[0], NOW);
    expect(TASKS[0].completedAt).toBeUndefined();
  });

  it("estimatedFinishMs: quick 15 min after scheduledAt", () => {
    expect(estimatedFinishMs(TASKS[0])).toBe(NOW + 3600_000 + 15 * 60_000);
  });

  it("totalCleaningMinutes: v1 completed = 120 (deep)", () => {
    expect(totalCleaningMinutes(TASKS, "v1")).toBe(120);
  });
});
