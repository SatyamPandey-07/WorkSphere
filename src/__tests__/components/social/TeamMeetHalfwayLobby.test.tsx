import React from "react";
import {
  render,
  screen,
  fireEvent,
  act,
  cleanup,
} from "@testing-library/react";
import TeamMeetHalfwayLobby from "@/components/social/TeamMeetHalfwayLobby";
import type { RankedVenueRecommendation } from "@/core/routing/MeetHalfwayOptimizer";

jest.mock("@/hooks/usePartySocketReconnect", () => ({
  __esModule: true,
  default: jest.fn(() => ({
    send: jest.fn(),
  })),
}));

function createDeferred<T = unknown>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface MockFetchCall {
  url: string;
  init?: RequestInit;
  signal?: AbortSignal;
  resolveFetch: (data?: unknown) => void;
  rejectFetch: (error: unknown) => void;
  resolveJson: (data: unknown) => void;
  rejectJson: (error: unknown) => void;
  fetchPromise: Promise<Response>;
  jsonPromise: Promise<unknown>;
}

describe("TeamMeetHalfwayLobby Concurrency & Race-Condition Control (#9300)", () => {
  let fetchCalls: MockFetchCall[] = [];
  const originalFetch = global.fetch;

  const initialCentroid = { latitude: 37.7749, longitude: -122.4194 };
  const initialRecommendations: RankedVenueRecommendation[] = [
    {
      venue: {
        id: "venue-1",
        name: "Initial Tech Hub Cowork",
        latitude: 37.775,
        longitude: -122.418,
        category: "coworking",
        address: "100 Market St",
        rating: 4.8,
        wifiSpeed: 200,
        wifiQuality: 95,
        hasOutlets: true,
        maxCapacity: 50,
        currentOccupancy: 20,
        availableSeatsCount: 30,
      },
      centroidDistanceMeters: 150,
      aggregateDurationMinutes: 35,
      averageDurationMinutes: 11.6,
      maxDurationMinutes: 15,
      fairnessScore: 92,
      compositeRankScore: 95,
      memberEstimates: [],
      availableCapacity: 30,
    },
  ];

  const newerCentroid = { latitude: 37.7899, longitude: -122.4011 };
  const newerRecommendations: RankedVenueRecommendation[] = [
    {
      venue: {
        id: "venue-2",
        name: "Newer Design Studio Lounge",
        latitude: 37.79,
        longitude: -122.4,
        category: "cafe",
        address: "500 Montgomery St",
        rating: 4.9,
        wifiSpeed: 300,
        wifiQuality: 98,
        hasOutlets: true,
        maxCapacity: 40,
        currentOccupancy: 10,
        availableSeatsCount: 30,
      },
      centroidDistanceMeters: 80,
      aggregateDurationMinutes: 28,
      averageDurationMinutes: 9.3,
      maxDurationMinutes: 12,
      fairnessScore: 96,
      compositeRankScore: 98,
      memberEstimates: [],
      availableCapacity: 30,
    },
  ];

  beforeEach(() => {
    fetchCalls = [];
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const fetchDef = createDeferred<Response>();
      const jsonDef = createDeferred<unknown>();

      const call: MockFetchCall = {
        url: String(input),
        init,
        signal: init?.signal as AbortSignal | undefined,
        resolveFetch: (data?: unknown) => {
          if (data !== undefined) {
            jsonDef.resolve(data);
            fetchDef.resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve(data),
            } as unknown as Response);
          } else {
            fetchDef.resolve({
              ok: true,
              status: 200,
              json: () => jsonDef.promise,
            } as unknown as Response);
          }
        },
        rejectFetch: (err: unknown) => {
          fetchDef.reject(err);
        },
        resolveJson: (data: unknown) => {
          jsonDef.resolve(data);
        },
        rejectJson: (err: unknown) => {
          jsonDef.reject(err);
        },
        fetchPromise: fetchDef.promise,
        jsonPromise: jsonDef.promise,
      };

      fetchCalls.push(call);
      return fetchDef.promise;
    });
  });

  afterEach(() => {
    cleanup();
    for (const call of fetchCalls) {
      call.resolveFetch({ success: false });
      call.resolveJson({ success: false });
    }
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("Test A — Latest response wins: resolves newer request first and ignores stale older response", async () => {
    render(<TeamMeetHalfwayLobby />);

    expect(fetchCalls).toHaveLength(1);
    const req1 = fetchCalls[0];

    // Trigger second request by changing category filter
    fireEvent.change(screen.getByDisplayValue("All Categories"), {
      target: { value: "cafe" },
    });

    expect(fetchCalls).toHaveLength(2);
    const req2 = fetchCalls[1];

    // Resolve newer request first
    await act(async () => {
      req2.resolveFetch({
        success: true,
        centroid: newerCentroid,
        recommendations: newerRecommendations,
      });
    });

    // Newer results are displayed
    expect(screen.getByText("Newer Design Studio Lounge")).toBeInTheDocument();
    expect(
      screen.getByText(/Midpoint Centroid: 37\.7899, -122\.4011/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Initial Tech Hub Cowork"),
    ).not.toBeInTheDocument();

    // Resolve older request afterward
    await act(async () => {
      req1.resolveFetch({
        success: true,
        centroid: initialCentroid,
        recommendations: initialRecommendations,
      });
    });

    // Verify older results do NOT replace the latest centroid or recommendations
    expect(screen.getByText("Newer Design Studio Lounge")).toBeInTheDocument();
    expect(
      screen.getByText(/Midpoint Centroid: 37\.7899, -122\.4011/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Initial Tech Hub Cowork"),
    ).not.toBeInTheDocument();
  });

  it("Test B — Stale request cannot clear loading", async () => {
    render(<TeamMeetHalfwayLobby />);

    expect(fetchCalls).toHaveLength(1);
    const req1 = fetchCalls[0];

    // Trigger second request
    fireEvent.change(screen.getByDisplayValue("All Categories"), {
      target: { value: "cafe" },
    });

    expect(fetchCalls).toHaveLength(2);
    const req2 = fetchCalls[1];

    // Resolve request 1 while request 2 is still pending
    await act(async () => {
      req1.resolveFetch({
        success: true,
        centroid: initialCentroid,
        recommendations: initialRecommendations,
      });
    });

    // Loading indicator must remain active
    expect(
      screen.getByText(
        "Calculating geometric median & evaluating travel matrices...",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /recalculate/i })).toBeDisabled();

    // Resolve request 2
    await act(async () => {
      req2.resolveFetch({
        success: true,
        centroid: newerCentroid,
        recommendations: newerRecommendations,
      });
    });

    // Loading should now be finished
    expect(
      screen.queryByText(
        "Calculating geometric median & evaluating travel matrices...",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /recalculate/i }),
    ).not.toBeDisabled();
    expect(screen.getByText("Newer Design Studio Lounge")).toBeInTheDocument();
  });

  it("Test C — Previous request is aborted when a new request starts", async () => {
    render(<TeamMeetHalfwayLobby />);

    expect(fetchCalls).toHaveLength(1);
    const req1 = fetchCalls[0];

    expect(req1.signal).toBeDefined();
    expect(req1.signal?.aborted).toBe(false);

    // Trigger second request
    fireEvent.change(screen.getByDisplayValue("All Categories"), {
      target: { value: "cafe" },
    });

    expect(fetchCalls).toHaveLength(2);
    const req2 = fetchCalls[1];

    // First request's signal is aborted
    expect(req1.signal?.aborted).toBe(true);

    // Second request has fresh non-aborted signal
    expect(req2.signal).toBeDefined();
    expect(req2.signal?.aborted).toBe(false);
    expect(req2.signal).not.toBe(req1.signal);
  });

  it("Test D — Stale JSON parsing cannot update state", async () => {
    render(<TeamMeetHalfwayLobby />);

    expect(fetchCalls).toHaveLength(1);
    const req1 = fetchCalls[0];

    // Resolve fetch for req1, but keep its json() promise pending
    await act(async () => {
      req1.resolveFetch();
    });

    // Trigger second request
    fireEvent.change(screen.getByDisplayValue("All Categories"), {
      target: { value: "cafe" },
    });

    expect(fetchCalls).toHaveLength(2);
    const req2 = fetchCalls[1];

    // Complete second request entirely
    await act(async () => {
      req2.resolveFetch({
        success: true,
        centroid: newerCentroid,
        recommendations: newerRecommendations,
      });
    });

    expect(screen.getByText("Newer Design Studio Lounge")).toBeInTheDocument();

    // Now resolve req1's json() promise
    await act(async () => {
      req1.resolveJson({
        success: true,
        centroid: initialCentroid,
        recommendations: initialRecommendations,
      });
    });

    // Older parsed data must not overwrite current results
    expect(screen.getByText("Newer Design Studio Lounge")).toBeInTheDocument();
    expect(
      screen.queryByText("Initial Tech Hub Cowork"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Midpoint Centroid: 37\.7899, -122\.4011/),
    ).toBeInTheDocument();
  });

  it("Test E — Unmount cleanup: aborts active request and prevents post-unmount state updates", async () => {
    const { unmount } = render(<TeamMeetHalfwayLobby />);

    expect(fetchCalls).toHaveLength(1);
    const req1 = fetchCalls[0];
    expect(req1.signal?.aborted).toBe(false);

    // Unmount while request is pending
    unmount();

    // Active request must be aborted
    expect(req1.signal?.aborted).toBe(true);

    // Resolving operation afterward must not cause unhandled rejection or errors
    await act(async () => {
      req1.resolveFetch({
        success: true,
        centroid: initialCentroid,
        recommendations: initialRecommendations,
      });
    });

    // Component is unmounted, verify no crash or unhandled error
    expect(
      screen.queryByText("Initial Tech Hub Cowork"),
    ).not.toBeInTheDocument();
  });

  it("Test F — Current request failure clears loading indicator", async () => {
    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    render(<TeamMeetHalfwayLobby />);

    expect(fetchCalls).toHaveLength(1);
    const req1 = fetchCalls[0];

    // Reject the current request with a network error
    await act(async () => {
      req1.rejectFetch(new Error("Network connection dropped"));
    });

    // Loading indicator must be cleared and not stuck
    expect(
      screen.queryByText(
        "Calculating geometric median & evaluating travel matrices...",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /recalculate/i }),
    ).not.toBeDisabled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to compute meet halfway:",
      expect.any(Error),
    );
  });

  it("Test G — Successful current request updates centroid, recommendations, and clears loading", async () => {
    render(<TeamMeetHalfwayLobby />);

    expect(fetchCalls).toHaveLength(1);
    const req1 = fetchCalls[0];

    await act(async () => {
      req1.resolveFetch({
        success: true,
        centroid: initialCentroid,
        recommendations: initialRecommendations,
      });
    });

    expect(screen.getByText("Initial Tech Hub Cowork")).toBeInTheDocument();
    expect(
      screen.getByText(/Midpoint Centroid: 37\.7749, -122\.4194/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Calculating geometric median & evaluating travel matrices...",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /recalculate/i }),
    ).not.toBeDisabled();
  });
});
