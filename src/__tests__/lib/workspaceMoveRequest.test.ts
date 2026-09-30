/**
 * Tests for workspace desk/seat move request management.
 */

type MoveRequestStatus = "pending" | "approved" | "rejected" | "completed";

interface MoveRequest {
  requestId: string;
  userId: string;
  fromSeatId: string;
  toSeatId: string;
  reason: string;
  status: MoveRequestStatus;
  requestedAt: number;
  processedAt: number | null;
  effectiveDate: string; // YYYY-MM-DD
}

function isPendingRequest(req: MoveRequest): boolean {
  return req.status === "pending";
}

function approveRequest(req: MoveRequest, nowMs: number): MoveRequest {
  if (req.status !== "pending") throw new Error("Can only approve pending requests");
  return { ...req, status: "approved", processedAt: nowMs };
}

function rejectRequest(req: MoveRequest, nowMs: number): MoveRequest {
  if (req.status !== "pending") throw new Error("Can only reject pending requests");
  return { ...req, status: "rejected", processedAt: nowMs };
}

function completeMove(req: MoveRequest, nowMs: number): MoveRequest {
  if (req.status !== "approved") throw new Error("Request must be approved before completing");
  return { ...req, status: "completed", processedAt: nowMs };
}

function pendingRequestsForUser(requests: MoveRequest[], userId: string): MoveRequest[] {
  return requests.filter((r) => r.userId === userId && isPendingRequest(r));
}

const NOW = 1_700_000_000_000;
const REQUEST: MoveRequest = {
  requestId: "mr1", userId: "u1",
  fromSeatId: "s1", toSeatId: "s5",
  reason: "Closer to team", status: "pending",
  requestedAt: NOW - 86_400_000, processedAt: null,
  effectiveDate: "2026-10-15",
};

describe("Workspace move request management", () => {
  it("isPendingRequest: pending → true", () => {
    expect(isPendingRequest(REQUEST)).toBe(true);
  });

  it("isPendingRequest: approved → false", () => {
    expect(isPendingRequest({ ...REQUEST, status: "approved" })).toBe(false);
  });

  it("approveRequest: pending → approved", () => {
    const approved = approveRequest(REQUEST, NOW);
    expect(approved.status).toBe("approved");
    expect(approved.processedAt).toBe(NOW);
  });

  it("approveRequest: throws on non-pending", () => {
    const approved = { ...REQUEST, status: "approved" as MoveRequestStatus };
    expect(() => approveRequest(approved, NOW)).toThrow();
  });

  it("rejectRequest: pending → rejected", () => {
    expect(rejectRequest(REQUEST, NOW).status).toBe("rejected");
  });

  it("completeMove: approved → completed", () => {
    const approved = approveRequest(REQUEST, NOW - 100);
    expect(completeMove(approved, NOW).status).toBe("completed");
  });

  it("completeMove: throws on pending", () => {
    expect(() => completeMove(REQUEST, NOW)).toThrow("must be approved");
  });

  it("pendingRequestsForUser: returns only pending", () => {
    const requests = [REQUEST, { ...REQUEST, requestId: "mr2", status: "approved" as MoveRequestStatus }];
    expect(pendingRequestsForUser(requests, "u1")).toHaveLength(1);
  });
});
