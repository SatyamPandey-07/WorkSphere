/**
 * Tests for document comment thread management.
 */

interface Comment {
  id: string;
  threadId: string;
  authorId: string;
  content: string;
  createdAt: number;
  resolvedAt?: number;
  parentId?: string;
}

function threadReplies(comments: Comment[], threadId: string): Comment[] {
  return comments
    .filter((c) => c.threadId === threadId && c.parentId !== undefined)
    .sort((a, b) => a.createdAt - b.createdAt);
}

function isThreadResolved(comments: Comment[], threadId: string): boolean {
  return comments
    .filter((c) => c.threadId === threadId)
    .some((c) => c.resolvedAt !== undefined);
}

function resolveThread(comments: Comment[], threadId: string, nowMs: number): Comment[] {
  return comments.map((c) =>
    c.threadId === threadId && !c.resolvedAt
      ? { ...c, resolvedAt: nowMs }
      : c
  );
}

function commentCount(comments: Comment[], threadId: string): number {
  return comments.filter((c) => c.threadId === threadId).length;
}

const NOW = 1_700_000_000_000;
const COMMENTS: Comment[] = [
  { id: "c1", threadId: "t1", authorId: "u1", content: "Root",    createdAt: NOW - 3000 },
  { id: "c2", threadId: "t1", authorId: "u2", content: "Reply1",  createdAt: NOW - 2000, parentId: "c1" },
  { id: "c3", threadId: "t1", authorId: "u1", content: "Reply2",  createdAt: NOW - 1000, parentId: "c1" },
  { id: "c4", threadId: "t2", authorId: "u3", content: "Other",   createdAt: NOW - 500,  resolvedAt: NOW - 100 },
];

describe("Document comment thread", () => {
  it("threadReplies returns only replies in order", () => {
    const replies = threadReplies(COMMENTS, "t1");
    expect(replies).toHaveLength(2);
    expect(replies[0].id).toBe("c2");
  });

  it("threadReplies: no replies → empty", () => {
    expect(threadReplies(COMMENTS, "t2")).toHaveLength(0);
  });

  it("isThreadResolved: t2 is resolved", () => {
    expect(isThreadResolved(COMMENTS, "t2")).toBe(true);
  });

  it("isThreadResolved: t1 is not resolved", () => {
    expect(isThreadResolved(COMMENTS, "t1")).toBe(false);
  });

  it("resolveThread marks all t1 comments", () => {
    const resolved = resolveThread(COMMENTS, "t1", NOW);
    const t1 = resolved.filter((c) => c.threadId === "t1");
    expect(t1.every((c) => c.resolvedAt !== undefined)).toBe(true);
  });

  it("resolveThread does not affect t2", () => {
    const resolved = resolveThread(COMMENTS, "t1", NOW);
    const t2 = resolved.filter((c) => c.threadId === "t2");
    expect(t2[0].resolvedAt).toBe(NOW - 100); // unchanged
  });

  it("commentCount: t1 has 3", () => {
    expect(commentCount(COMMENTS, "t1")).toBe(3);
  });

  it("commentCount: unknown thread → 0", () => {
    expect(commentCount(COMMENTS, "t99")).toBe(0);
  });
});
