/**
 * Tests for user block/unblock management.
 */

interface BlockRecord {
  blockerId: string;
  blockedId: string;
  createdAt: number;
  reason?: string;
}

function isBlocked(blocks: BlockRecord[], blockerId: string, targetId: string): boolean {
  return blocks.some((b) => b.blockerId === blockerId && b.blockedId === targetId);
}

function blockUser(
  blocks: BlockRecord[],
  blockerId: string,
  blockedId: string,
  nowMs: number,
  reason?: string
): BlockRecord[] {
  if (blockerId === blockedId) throw new Error("Cannot block yourself");
  if (isBlocked(blocks, blockerId, blockedId)) return blocks; // already blocked
  return [...blocks, { blockerId, blockedId, createdAt: nowMs, reason }];
}

function unblockUser(
  blocks: BlockRecord[],
  blockerId: string,
  blockedId: string
): BlockRecord[] {
  return blocks.filter((b) => !(b.blockerId === blockerId && b.blockedId === blockedId));
}

function blockedByUser(blocks: BlockRecord[], blockerId: string): string[] {
  return blocks.filter((b) => b.blockerId === blockerId).map((b) => b.blockedId);
}

function canInteract(
  blocks: BlockRecord[],
  userA: string,
  userB: string
): boolean {
  return !isBlocked(blocks, userA, userB) && !isBlocked(blocks, userB, userA);
}

const NOW = 1_700_000_000_000;
const BLOCKS: BlockRecord[] = [
  { blockerId: "u1", blockedId: "u2", createdAt: NOW - 1000, reason: "spam"      },
  { blockerId: "u3", blockedId: "u1", createdAt: NOW - 2000, reason: "offensive" },
];

describe("User blocked list management", () => {
  it("isBlocked: u1 blocked u2 → true", () => {
    expect(isBlocked(BLOCKS, "u1", "u2")).toBe(true);
  });

  it("isBlocked: u2 did not block u1 → false", () => {
    expect(isBlocked(BLOCKS, "u2", "u1")).toBe(false);
  });

  it("blockUser: adds new block", () => {
    const updated = blockUser(BLOCKS, "u2", "u3", NOW);
    expect(updated).toHaveLength(3);
    expect(isBlocked(updated, "u2", "u3")).toBe(true);
  });

  it("blockUser: self-block throws", () => {
    expect(() => blockUser(BLOCKS, "u1", "u1", NOW)).toThrow("yourself");
  });

  it("blockUser: duplicate → no change", () => {
    expect(blockUser(BLOCKS, "u1", "u2", NOW)).toHaveLength(2);
  });

  it("unblockUser: removes block", () => {
    const updated = unblockUser(BLOCKS, "u1", "u2");
    expect(isBlocked(updated, "u1", "u2")).toBe(false);
  });

  it("blockedByUser: u1 blocks u2", () => {
    expect(blockedByUser(BLOCKS, "u1")).toContain("u2");
  });

  it("canInteract: u1 blocked by u3 → false (u3 blocked u1)", () => {
    expect(canInteract(BLOCKS, "u1", "u3")).toBe(false);
  });

  it("canInteract: u2 and u3 no blocks → true", () => {
    expect(canInteract(BLOCKS, "u2", "u3")).toBe(true);
  });
});
