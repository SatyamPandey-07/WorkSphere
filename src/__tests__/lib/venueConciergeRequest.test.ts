/**
 * Tests for venue concierge service request management.
 */

type ConciergeRequestType = "catering" | "av_setup" | "room_config" | "printing" | "transport" | "other";
type ConciergeRequestStatus = "submitted" | "assigned" | "in_progress" | "completed" | "cancelled";

interface ConciergeRequest {
  requestId: string;
  bookingId: string;
  userId: string;
  type: ConciergeRequestType;
  description: string;
  status: ConciergeRequestStatus;
  priority: "low" | "normal" | "urgent";
  submittedAt: number;
  completedAt: number | null;
  assignedTo: string | null;
  estimatedMinutes: number;
}

function isRequestActive(req: ConciergeRequest): boolean {
  return req.status !== "completed" && req.status !== "cancelled";
}

function assignRequest(req: ConciergeRequest, staffId: string): ConciergeRequest {
  if (!isRequestActive(req)) throw new Error("Cannot assign inactive request");
  return { ...req, status: "assigned", assignedTo: staffId };
}

function completeRequest(req: ConciergeRequest, nowMs: number): ConciergeRequest {
  if (req.status === "completed") throw new Error("Already completed");
  return { ...req, status: "completed", completedAt: nowMs };
}

function urgentRequests(requests: ConciergeRequest[], venueId?: string): ConciergeRequest[] {
  return requests.filter((r) => r.priority === "urgent" && isRequestActive(r));
}

function requestsForBooking(requests: ConciergeRequest[], bookingId: string): ConciergeRequest[] {
  return requests.filter((r) => r.bookingId === bookingId);
}

function avgCompletionMinutes(requests: ConciergeRequest[]): number {
  const completed = requests.filter((r) => r.status === "completed" && r.completedAt !== null);
  if (completed.length === 0) return 0;
  const avgMs = completed.reduce((s, r) => s + (r.completedAt! - r.submittedAt), 0) / completed.length;
  return Math.round(avgMs / 60_000);
}

const NOW = 1_700_000_000_000;
const REQUESTS: ConciergeRequest[] = [
  { requestId: "r1", bookingId: "b1", userId: "u1", type: "catering",  description: "Coffee for 5", status: "submitted", priority: "normal", submittedAt: NOW - 3600_000, completedAt: null, assignedTo: null, estimatedMinutes: 30 },
  { requestId: "r2", bookingId: "b1", userId: "u1", type: "av_setup",  description: "HDMI needed", status: "assigned",  priority: "urgent", submittedAt: NOW - 1800_000, completedAt: null, assignedTo: "staff1", estimatedMinutes: 15 },
  { requestId: "r3", bookingId: "b2", userId: "u2", type: "printing",  description: "10 pages",    status: "completed", priority: "low",    submittedAt: NOW - 7200_000, completedAt: NOW - 3600_000, assignedTo: "staff2", estimatedMinutes: 5 },
];

describe("Venue concierge requests", () => {
  it("isRequestActive: submitted → true", () => {
    expect(isRequestActive(REQUESTS[0])).toBe(true);
  });

  it("isRequestActive: completed → false", () => {
    expect(isRequestActive(REQUESTS[2])).toBe(false);
  });

  it("assignRequest: sets status and assignedTo", () => {
    const assigned = assignRequest(REQUESTS[0], "staff3");
    expect(assigned.status).toBe("assigned");
    expect(assigned.assignedTo).toBe("staff3");
  });

  it("assignRequest: throws on completed", () => {
    expect(() => assignRequest(REQUESTS[2], "staff1")).toThrow("inactive");
  });

  it("completeRequest: sets completedAt", () => {
    const done = completeRequest(REQUESTS[1], NOW);
    expect(done.status).toBe("completed");
    expect(done.completedAt).toBe(NOW);
  });

  it("urgentRequests: returns urgent active", () => {
    const urgent = urgentRequests(REQUESTS);
    expect(urgent.every((r) => r.priority === "urgent" && isRequestActive(r))).toBe(true);
  });

  it("requestsForBooking: b1 has 2 requests", () => {
    expect(requestsForBooking(REQUESTS, "b1")).toHaveLength(2);
  });

  it("avgCompletionMinutes: r3 took 60 min", () => {
    expect(avgCompletionMinutes(REQUESTS)).toBe(60);
  });
});
