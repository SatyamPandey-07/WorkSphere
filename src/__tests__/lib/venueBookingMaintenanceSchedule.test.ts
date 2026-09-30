/**
 * Tests for venue maintenance scheduling and tracking utilities.
 */

type MaintenanceType = "routine" | "preventive" | "emergency" | "renovation";
type MaintenanceStatus = "scheduled" | "in_progress" | "completed" | "overdue" | "cancelled";

interface MaintenanceTask {
  id: string;
  venueId: string;
  type: MaintenanceType;
  status: MaintenanceStatus;
  scheduledAt: number;
  completedAt: number | null;
  estimatedHours: number;
  actualHours: number | null;
  cost: number;
  zone: string;
}

function isOverdue(task: MaintenanceTask, nowMs: number): boolean {
  return task.status !== "completed" && task.status !== "cancelled" && nowMs > task.scheduledAt;
}

function completionRate(tasks: MaintenanceTask[]): number {
  if (tasks.length === 0) return 0;
  const completed = tasks.filter((t) => t.status === "completed").length;
  return Math.round((completed / tasks.length) * 100);
}

function avgActualVsEstimated(tasks: MaintenanceTask[]): number {
  const completed = tasks.filter((t) => t.actualHours !== null && t.estimatedHours > 0);
  if (completed.length === 0) return 1;
  return Math.round(
    completed.reduce((s, t) => s + t.actualHours! / t.estimatedHours, 0) / completed.length * 100
  ) / 100;
}

function totalMaintenanceCost(tasks: MaintenanceTask[], type?: MaintenanceType): number {
  const filtered = type ? tasks.filter((t) => t.type === type) : tasks;
  return Math.round(filtered.reduce((s, t) => s + t.cost, 0) * 100) / 100;
}

function tasksByZone(tasks: MaintenanceTask[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const t of tasks) result[t.zone] = (result[t.zone] ?? 0) + 1;
  return result;
}

function nextScheduled(tasks: MaintenanceTask[], nowMs: number): MaintenanceTask | null {
  const future = tasks.filter((t) => t.status === "scheduled" && t.scheduledAt > nowMs);
  if (future.length === 0) return null;
  return future.reduce((min, t) => (t.scheduledAt < min.scheduledAt ? t : min), future[0]);
}

const NOW = 1_700_000_000_000;
const TASKS: MaintenanceTask[] = [
  { id: "m1", venueId: "v1", type: "routine",   status: "completed",   scheduledAt: NOW - 7 * 86_400_000, completedAt: NOW - 6 * 86_400_000, estimatedHours: 3, actualHours: 3.5, cost: 200, zone: "main" },
  { id: "m2", venueId: "v1", type: "emergency",  status: "in_progress", scheduledAt: NOW - 86_400_000,     completedAt: null,                  estimatedHours: 8, actualHours: null, cost: 1500, zone: "kitchen" },
  { id: "m3", venueId: "v1", type: "preventive", status: "scheduled",   scheduledAt: NOW + 3 * 86_400_000, completedAt: null,                  estimatedHours: 4, actualHours: null, cost: 500, zone: "main" },
];

describe("Maintenance scheduling", () => {
  it("isOverdue: in_progress past scheduled → true", () => {
    expect(isOverdue(TASKS[1], NOW)).toBe(true);
  });

  it("isOverdue: future scheduled → false", () => {
    expect(isOverdue(TASKS[2], NOW)).toBe(false);
  });

  it("completionRate: 1 of 3 = 33%", () => {
    expect(completionRate(TASKS)).toBe(33);
  });

  it("avgActualVsEstimated: 3.5/3 ≈ 1.17", () => {
    expect(avgActualVsEstimated(TASKS)).toBe(1.17);
  });

  it("totalMaintenanceCost: all tasks = $2200", () => {
    expect(totalMaintenanceCost(TASKS)).toBe(2200);
  });

  it("nextScheduled: returns m3", () => {
    expect(nextScheduled(TASKS, NOW)?.id).toBe("m3");
  });
});
