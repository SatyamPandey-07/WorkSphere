/**
 * Tests for workspace amenity request and vote management.
 */

type RequestStatus = "open" | "in_progress" | "completed" | "declined";

interface AmenityRequest {
  id: string;
  venueId: string;
  title: string;
  status: RequestStatus;
  votes: number;
  submittedBy: string;
  submittedAt: number;
}

function voteForRequest(
  requests: AmenityRequest[],
  id: string
): AmenityRequest[] {
  return requests.map((r) =>
    r.id === id ? { ...r, votes: r.votes + 1 } : r
  );
}

function topRequests(
  requests: AmenityRequest[],
  venueId: string,
  limit: number
): AmenityRequest[] {
  return requests
    .filter((r) => r.venueId === venueId && r.status === "open")
    .sort((a, b) => b.votes - a.votes)
    .slice(0, limit);
}

function updateStatus(
  requests: AmenityRequest[],
  id: string,
  status: RequestStatus
): AmenityRequest[] {
  return requests.map((r) => (r.id === id ? { ...r, status } : r));
}

function requestsByStatus(
  requests: AmenityRequest[],
  status: RequestStatus
): AmenityRequest[] {
  return requests.filter((r) => r.status === status);
}

const NOW = 1_700_000_000_000;
const REQUESTS: AmenityRequest[] = [
  { id: "r1", venueId: "v1", title: "Standing desks", status: "open",        votes: 15, submittedBy: "u1", submittedAt: NOW - 4000 },
  { id: "r2", venueId: "v1", title: "Coffee machine", status: "open",        votes: 22, submittedBy: "u2", submittedAt: NOW - 3000 },
  { id: "r3", venueId: "v1", title: "Faster WiFi",    status: "in_progress", votes: 30, submittedBy: "u3", submittedAt: NOW - 2000 },
  { id: "r4", venueId: "v2", title: "Lockers",        status: "open",        votes: 5,  submittedBy: "u4", submittedAt: NOW - 1000 },
];

describe("Workspace amenity requests", () => {
  it("voteForRequest: increments votes", () => {
    const updated = voteForRequest(REQUESTS, "r1");
    expect(updated.find((r) => r.id === "r1")!.votes).toBe(16);
  });

  it("voteForRequest is immutable", () => {
    voteForRequest(REQUESTS, "r1");
    expect(REQUESTS.find((r) => r.id === "r1")!.votes).toBe(15);
  });

  it("topRequests: v1 open sorted by votes", () => {
    const top = topRequests(REQUESTS, "v1", 2);
    expect(top[0].id).toBe("r2"); // 22 votes
    expect(top[1].id).toBe("r1"); // 15 votes
  });

  it("topRequests: excludes in_progress", () => {
    const top = topRequests(REQUESTS, "v1", 10);
    expect(top.every((r) => r.status === "open")).toBe(true);
  });

  it("updateStatus: marks in_progress", () => {
    const updated = updateStatus(REQUESTS, "r1", "in_progress");
    expect(updated.find((r) => r.id === "r1")!.status).toBe("in_progress");
  });

  it("requestsByStatus: 2 open in v1", () => {
    const open = requestsByStatus(REQUESTS, "open");
    const v1Open = open.filter((r) => r.venueId === "v1");
    expect(v1Open).toHaveLength(2);
  });

  it("requestsByStatus: 1 in_progress", () => {
    expect(requestsByStatus(REQUESTS, "in_progress")).toHaveLength(1);
  });
});
