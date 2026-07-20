import { renderHook, act, waitFor } from "@testing-library/react";
import { useSavedVenues } from "@/hooks/useSavedVenues";

const mockFavorites = [
  {
    id: "fav1",
    userId: "user1",
    venueId: "v1",
    notes: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    venue: {
      id: "v1",
      placeId: "p1",
      name: "Test Cafe",
      latitude: 0,
      longitude: 0,
      category: "cafe",
      address: "123 Main St",
      rating: 4.5,
      wifiQuality: 4,
      hasOutlets: true,
      noiseLevel: "quiet",
      imageUrl: null,
    },
    tags: [
      {
        id: "tag1",
        favoriteId: "fav1",
        name: "Quiet Spot",
        color: "#3b82f6",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ],
  },
];

function jsonHeaders() {
  return {
    get(name: string) {
      if (name.toLowerCase() === "content-type") return "application/json";
      return null;
    },
  };
}

function mockJsonResponse(body: unknown) {
  return {
    ok: true,
    type: "basic" as ResponseType,
    headers: jsonHeaders(),
    json: async () => body,
  };
}

function mockErrorResponse(status: number, body: unknown) {
  return {
    ok: false,
    type: "basic" as ResponseType,
    status,
    headers: jsonHeaders(),
    json: async () => body,
  };
}

function mockRedirectResponse() {
  return {
    ok: false,
    type: "opaqueredirect" as ResponseType,
    headers: jsonHeaders(),
    json: async () => ({}),
  };
}

beforeEach(() => {
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("useSavedVenues", () => {
  it("loads favorites on mount", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockJsonResponse({ favorites: mockFavorites }),
    );

    const { result } = renderHook(() => useSavedVenues());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.favorites).toHaveLength(1);
    expect(result.current.favorites[0].venue.name).toBe("Test Cafe");
    expect(result.current.allTags).toHaveLength(1);
    expect(result.current.allTags[0].name).toBe("Quiet Spot");
  });

  it("handles fetch errors", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockErrorResponse(500, { error: "Failed" }),
    );

    const { result } = renderHook(() => useSavedVenues());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeTruthy();
  });

  it("handles auth redirect gracefully", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockRedirectResponse(),
    );

    const { result } = renderHook(() => useSavedVenues());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch saved venues");
  });

  it("handles HTML response gracefully", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      type: "basic" as ResponseType,
      headers: {
        get(name: string) {
          if (name.toLowerCase() === "content-type") return "text/html";
          return null;
        },
      },
      json: async () => ({}),
    });

    const { result } = renderHook(() => useSavedVenues());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Unexpected response from server.");
  });

  it("updates notes optimistically", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockJsonResponse({ favorites: mockFavorites }))
      .mockResolvedValueOnce(
        mockJsonResponse({
          favorite: { ...mockFavorites[0], notes: "New note" },
        }),
      );

    const { result } = renderHook(() => useSavedVenues());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateNotes("fav1", "New note");
    });

    expect(result.current.favorites[0].notes).toBe("New note");
  });

  it("adds a tag optimistically", async () => {
    const newTag = {
      id: "tag2",
      favoriteId: "fav1",
      name: "Fast WiFi",
      color: "#22c55e",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockJsonResponse({ favorites: mockFavorites }))
      .mockResolvedValueOnce(mockJsonResponse({ tag: newTag }));

    const { result } = renderHook(() => useSavedVenues());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.addTag("fav1", "Fast WiFi", "#22c55e");
    });

    expect(result.current.favorites[0].tags).toHaveLength(2);
    expect(result.current.favorites[0].tags[1].name).toBe("Fast WiFi");
  });

  it("deletes a tag optimistically", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockJsonResponse({ favorites: mockFavorites }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true }));

    const { result } = renderHook(() => useSavedVenues());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.deleteTag("fav1", "tag1");
    });

    expect(result.current.favorites[0].tags).toHaveLength(0);
  });

  it("removes a favorite optimistically", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockJsonResponse({ favorites: mockFavorites }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true }));

    const { result } = renderHook(() => useSavedVenues());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.removeFavorite("v1");
    });

    expect(result.current.favorites).toHaveLength(0);
  });

  it("rolls back optimistic addTag on failure", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockJsonResponse({ favorites: mockFavorites }))
      .mockResolvedValueOnce(mockErrorResponse(409, { error: "Duplicate tag" }));

    const { result } = renderHook(() => useSavedVenues());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      try {
        await result.current.addTag("fav1", "Quiet Spot", "#3b82f6");
      } catch {
        // Expected
      }
    });

    expect(result.current.favorites[0].tags).toHaveLength(1);
  });

  it("rolls back optimistic deleteTag on failure", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockJsonResponse({ favorites: mockFavorites }))
      .mockResolvedValueOnce(mockErrorResponse(500, { error: "Failed" }));

    const { result } = renderHook(() => useSavedVenues());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      try {
        await result.current.deleteTag("fav1", "tag1");
      } catch {
        // Expected
      }
    });

    expect(result.current.favorites[0].tags).toHaveLength(1);
  });

  it("rolls back optimistic notes on failure", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockJsonResponse({ favorites: mockFavorites }))
      .mockResolvedValueOnce(mockErrorResponse(500, { error: "Failed" }));

    const { result } = renderHook(() => useSavedVenues());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      try {
        await result.current.updateNotes("fav1", "New note");
      } catch {
        // Expected
      }
    });

    expect(result.current.favorites[0].notes).toBeNull();
  });

  it("rolls back notes on redirect", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockJsonResponse({ favorites: mockFavorites }))
      .mockResolvedValueOnce(mockRedirectResponse());

    const { result } = renderHook(() => useSavedVenues());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      try {
        await result.current.updateNotes("fav1", "New note");
      } catch {
        // Expected
      }
    });

    expect(result.current.favorites[0].notes).toBeNull();
  });

  it("rolls back addTag on redirect", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockJsonResponse({ favorites: mockFavorites }))
      .mockResolvedValueOnce(mockRedirectResponse());

    const { result } = renderHook(() => useSavedVenues());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      try {
        await result.current.addTag("fav1", "New Tag", "#ef4444");
      } catch {
        // Expected
      }
    });

    expect(result.current.favorites[0].tags).toHaveLength(1);
  });
});
