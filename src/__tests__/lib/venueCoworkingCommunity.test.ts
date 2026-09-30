/**
 * Tests for coworking community features (groups, announcements).
 */

interface CommunityGroup {
  groupId: string;
  venueId: string;
  name: string;
  description: string;
  memberIds: string[];
  maxMembers: number | null; // null = unlimited
  isPublic: boolean;
  createdBy: string;
  createdAt: number;
}

function canJoinGroup(group: CommunityGroup, userId: string): boolean {
  if (group.memberIds.includes(userId)) return false; // already member
  if (!group.isPublic) return false; // private group
  if (group.maxMembers !== null && group.memberIds.length >= group.maxMembers) return false;
  return true;
}

function joinGroup(group: CommunityGroup, userId: string): CommunityGroup {
  if (!canJoinGroup(group, userId)) throw new Error("Cannot join group");
  return { ...group, memberIds: [...group.memberIds, userId] };
}

function leaveGroup(group: CommunityGroup, userId: string): CommunityGroup {
  if (!group.memberIds.includes(userId)) throw new Error("Not a member");
  if (group.createdBy === userId) throw new Error("Creator cannot leave");
  return { ...group, memberIds: group.memberIds.filter((id) => id !== userId) };
}

function groupsByVenue(groups: CommunityGroup[], venueId: string, isPublic?: boolean): CommunityGroup[] {
  return groups.filter(
    (g) => g.venueId === venueId && (isPublic === undefined || g.isPublic === isPublic)
  );
}

const GROUP: CommunityGroup = {
  groupId: "g1", venueId: "v1", name: "Morning Coffee Crew",
  description: "Daily 9am coffee chat",
  memberIds: ["u1", "u2", "u3"], maxMembers: 10,
  isPublic: true, createdBy: "u1", createdAt: 1_700_000_000_000,
};

describe("Coworking community groups", () => {
  it("canJoinGroup: new user can join public group", () => {
    expect(canJoinGroup(GROUP, "u4")).toBe(true);
  });

  it("canJoinGroup: already member → false", () => {
    expect(canJoinGroup(GROUP, "u1")).toBe(false);
  });

  it("canJoinGroup: private group → false", () => {
    const private_grp = { ...GROUP, isPublic: false };
    expect(canJoinGroup(private_grp, "u4")).toBe(false);
  });

  it("canJoinGroup: at max capacity → false", () => {
    const full = { ...GROUP, maxMembers: 3 };
    expect(canJoinGroup(full, "u4")).toBe(false);
  });

  it("joinGroup: adds member", () => {
    const updated = joinGroup(GROUP, "u4");
    expect(updated.memberIds).toContain("u4");
  });

  it("joinGroup: throws if cannot join", () => {
    expect(() => joinGroup(GROUP, "u1")).toThrow("Cannot join");
  });

  it("leaveGroup: removes member", () => {
    const updated = leaveGroup(GROUP, "u2");
    expect(updated.memberIds).not.toContain("u2");
  });

  it("leaveGroup: creator cannot leave", () => {
    expect(() => leaveGroup(GROUP, "u1")).toThrow("Creator");
  });

  it("groupsByVenue: returns groups for venue", () => {
    const groups = [GROUP, { ...GROUP, groupId: "g2", venueId: "v2" }];
    expect(groupsByVenue(groups, "v1")).toHaveLength(1);
  });
});
