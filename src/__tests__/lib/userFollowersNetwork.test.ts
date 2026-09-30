/**
 * Tests for user follow/unfollow and social network queries.
 */

interface FollowRelation {
  followerId: string;
  followingId: string;
  createdAt: number;
}

function isFollowing(relations: FollowRelation[], followerId: string, followingId: string): boolean {
  return relations.some((r) => r.followerId === followerId && r.followingId === followingId);
}

function followUser(
  relations: FollowRelation[],
  followerId: string,
  followingId: string,
  nowMs: number
): FollowRelation[] {
  if (isFollowing(relations, followerId, followingId)) return relations; // no-op
  if (followerId === followingId) throw new Error("Cannot follow yourself");
  return [...relations, { followerId, followingId, createdAt: nowMs }];
}

function unfollowUser(
  relations: FollowRelation[],
  followerId: string,
  followingId: string
): FollowRelation[] {
  return relations.filter(
    (r) => !(r.followerId === followerId && r.followingId === followingId)
  );
}

function followerCount(relations: FollowRelation[], userId: string): number {
  return relations.filter((r) => r.followingId === userId).length;
}

function followingCount(relations: FollowRelation[], userId: string): number {
  return relations.filter((r) => r.followerId === userId).length;
}

function mutualFollowers(relations: FollowRelation[], userA: string, userB: string): string[] {
  const aFollowing = new Set(relations.filter((r) => r.followerId === userA).map((r) => r.followingId));
  const bFollowing = new Set(relations.filter((r) => r.followerId === userB).map((r) => r.followingId));
  return [...aFollowing].filter((id) => bFollowing.has(id));
}

const NOW = 1_700_000_000_000;
const RELATIONS: FollowRelation[] = [
  { followerId: "u1", followingId: "u2", createdAt: NOW - 3000 },
  { followerId: "u1", followingId: "u3", createdAt: NOW - 2000 },
  { followerId: "u2", followingId: "u3", createdAt: NOW - 1000 },
];

describe("User follow network", () => {
  it("isFollowing: u1 follows u2 → true", () => {
    expect(isFollowing(RELATIONS, "u1", "u2")).toBe(true);
  });

  it("isFollowing: u2 not following u1 → false", () => {
    expect(isFollowing(RELATIONS, "u2", "u1")).toBe(false);
  });

  it("followUser: adds new relation", () => {
    const updated = followUser(RELATIONS, "u2", "u1", NOW);
    expect(isFollowing(updated, "u2", "u1")).toBe(true);
  });

  it("followUser: no-op if already following", () => {
    expect(followUser(RELATIONS, "u1", "u2", NOW)).toHaveLength(3);
  });

  it("followUser: self-follow throws", () => {
    expect(() => followUser(RELATIONS, "u1", "u1", NOW)).toThrow();
  });

  it("unfollowUser removes relation", () => {
    const updated = unfollowUser(RELATIONS, "u1", "u2");
    expect(isFollowing(updated, "u1", "u2")).toBe(false);
  });

  it("followerCount: u3 has 2 followers", () => {
    expect(followerCount(RELATIONS, "u3")).toBe(2);
  });

  it("followingCount: u1 follows 2", () => {
    expect(followingCount(RELATIONS, "u1")).toBe(2);
  });

  it("mutualFollowers: u1 and u2 both follow u3", () => {
    const mutual = mutualFollowers(RELATIONS, "u1", "u2");
    expect(mutual).toContain("u3");
  });
});
