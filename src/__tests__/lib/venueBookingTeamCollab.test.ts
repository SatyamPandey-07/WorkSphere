/**
 * Tests for venue booking team collaboration and assignment utilities.
 */

type TeamRole = "owner" | "manager" | "coordinator" | "staff" | "viewer";

interface TeamMember {
  userId: string;
  name: string;
  role: TeamRole;
  venueIds: string[];   // venues they have access to
  isActive: boolean;
  joinedAt: number;
}

interface TaskAssignment {
  taskId: string;
  assigneeId: string;
  venueId: string;
  dueMs: number;
  priority: "low" | "medium" | "high" | "urgent";
  completed: boolean;
}

const ROLE_PERMISSIONS: Record<TeamRole, string[]> = {
  owner:       ["read", "write", "delete", "manage_team", "billing"],
  manager:     ["read", "write", "delete", "manage_team"],
  coordinator: ["read", "write"],
  staff:       ["read"],
  viewer:      ["read"],
};

function hasPermission(member: TeamMember, permission: string): boolean {
  return ROLE_PERMISSIONS[member.role].includes(permission);
}

function canAccessVenue(member: TeamMember, venueId: string): boolean {
  if (!member.isActive) return false;
  if (member.role === "owner" || member.role === "manager") return true;
  return member.venueIds.includes(venueId);
}

function overdueTasks(tasks: TaskAssignment[], nowMs: number): TaskAssignment[] {
  return tasks.filter((t) => !t.completed && nowMs > t.dueMs);
}

function tasksByPriority(tasks: TaskAssignment[]): Record<TaskAssignment["priority"], number> {
  const counts: Partial<Record<TaskAssignment["priority"], number>> = {};
  for (const t of tasks) counts[t.priority] = (counts[t.priority] ?? 0) + 1;
  return counts as Record<TaskAssignment["priority"], number>;
}

function memberWorkload(tasks: TaskAssignment[], userId: string): number {
  return tasks.filter((t) => t.assigneeId === userId && !t.completed).length;
}

function suggestAssignee(
  members: TeamMember[],
  tasks: TaskAssignment[],
  venueId: string
): TeamMember | null {
  const eligible = members.filter((m) => canAccessVenue(m, venueId) && m.isActive);
  if (eligible.length === 0) return null;
  return eligible.reduce((min, m) =>
    memberWorkload(tasks, m.userId) < memberWorkload(tasks, min.userId) ? m : min,
    eligible[0]
  );
}

const NOW = 1_700_000_000_000;
const MEMBERS: TeamMember[] = [
  { userId: "u1", name: "Alice", role: "manager",    venueIds: [],         isActive: true,  joinedAt: NOW - 365 * 86_400_000 },
  { userId: "u2", name: "Bob",   role: "coordinator",venueIds: ["v1","v2"],isActive: true,  joinedAt: NOW - 180 * 86_400_000 },
  { userId: "u3", name: "Carol", role: "staff",       venueIds: ["v1"],    isActive: false, joinedAt: NOW - 90  * 86_400_000 },
];
const TASKS: TaskAssignment[] = [
  { taskId: "t1", assigneeId: "u2", venueId: "v1", dueMs: NOW - 3600_000, priority: "high",   completed: false },
  { taskId: "t2", assigneeId: "u2", venueId: "v1", dueMs: NOW + 3600_000, priority: "medium", completed: false },
  { taskId: "t3", assigneeId: "u1", venueId: "v2", dueMs: NOW + 7200_000, priority: "low",    completed: true },
];

describe("Team collaboration and task management", () => {
  it("hasPermission: manager can manage_team", () => {
    expect(hasPermission(MEMBERS[0], "manage_team")).toBe(true);
  });

  it("hasPermission: staff cannot write", () => {
    expect(hasPermission(MEMBERS[2], "write")).toBe(false);
  });

  it("canAccessVenue: inactive staff → false", () => {
    expect(canAccessVenue(MEMBERS[2], "v1")).toBe(false);
  });

  it("canAccessVenue: manager accesses any venue → true", () => {
    expect(canAccessVenue(MEMBERS[0], "v999")).toBe(true);
  });

  it("overdueTasks: t1 past due", () => {
    expect(overdueTasks(TASKS, NOW).map((t) => t.taskId)).toContain("t1");
  });

  it("memberWorkload: u2 has 2 open tasks", () => {
    expect(memberWorkload(TASKS, "u2")).toBe(2);
  });

  it("suggestAssignee: u1 has less workload → suggested", () => {
    const suggested = suggestAssignee(MEMBERS, TASKS, "v1");
    expect(suggested?.userId).toBe("u1");
  });
});
