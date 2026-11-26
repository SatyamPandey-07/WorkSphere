import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import CollectionsPage from "@/app/collections/page";

const mockToast = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
}));

jest.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

function makePublicCollection(id: string, name: string, upvotes: number) {
  return {
    id,
    name,
    description: `${name} description`,
    upvotes,
    hasUpvoted: false,
    owner: { id: "u1", firstName: "Alice", lastName: "L", imageUrl: null },
    _count: { venues: 2, members: 1 },
  };
}

describe("CollectionsPage public discovery pagination (#10262)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("loads paginated public collections, deduplicates overlapping IDs, preserves optimistic upvote, and recovers from load-more errors", async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockImplementation(async (input: string) => {
      if (input === "/api/folders") {
        return {
          ok: true,
          json: async () => ({ folders: [] }),
        };
      }

      if (input === "/api/collections/public?limit=20") {
        return {
          ok: true,
          json: async () => ({
            folders: [
              makePublicCollection("c1", "Quiet Cafes", 10),
              makePublicCollection("c2", "Coworking Hubs", 8),
            ],
            pagination: { hasMore: true, nextCursor: "cursor-page-2" },
          }),
        };
      }

      if (input === "/api/collections/public/upvote") {
        return {
          ok: true,
          json: async () => ({ success: true, hasUpvoted: true, upvotes: 11 }),
        };
      }

      if (
        input === "/api/collections/public?limit=20&cursor=cursor-page-2" &&
        fetchMock.mock.calls.filter(
          (call) =>
            call[0] === "/api/collections/public?limit=20&cursor=cursor-page-2",
        ).length === 1
      ) {
        return {
          ok: false,
          json: async () => ({ error: "Temporary upstream failure" }),
        };
      }

      if (input === "/api/collections/public?limit=20&cursor=cursor-page-2") {
        return {
          ok: true,
          json: async () => ({
            folders: [
              // Duplicate c2 plus new c3 to test deduplication
              makePublicCollection("c2", "Coworking Hubs", 8),
              makePublicCollection("c3", "Late Night Libraries", 4),
            ],
            pagination: { hasMore: false, nextCursor: null },
          }),
        };
      }

      return { ok: true, json: async () => ({}) };
    });

    render(<CollectionsPage />);

    const tabButton = screen.getByRole("button", { name: /discovery feed/i });
    fireEvent.click(tabButton);

    expect(await screen.findByText("Quiet Cafes")).toBeInTheDocument();
    expect(screen.getByText("Coworking Hubs")).toBeInTheDocument();

    // Upvote first-page item before loading second page
    const upvoteButton = screen.getByRole("button", { name: "10" });
    fireEvent.click(upvoteButton);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "11" })).toBeInTheDocument();
    });

    // Trigger page 2 fetch which fails on first attempt
    const loadMoreBtn = screen.getByRole("button", { name: /load more/i });
    fireEvent.click(loadMoreBtn);

    expect(
      await screen.findByText("Temporary upstream failure"),
    ).toBeInTheDocument();
    // Existing items stay rendered on pagination error
    expect(screen.getByText("Quiet Cafes")).toBeInTheDocument();
    expect(screen.getByText("Coworking Hubs")).toBeInTheDocument();

    // Retry loading page 2
    const retryBtn = screen.getByRole("button", { name: /retry/i });
    fireEvent.click(retryBtn);

    expect(await screen.findByText("Late Night Libraries")).toBeInTheDocument();
    // Overlapping c2 from page 2 must not be duplicated
    expect(screen.getAllByText("Coworking Hubs")).toHaveLength(1);
    // Upvote state on c1 must remain intact
    expect(screen.getByRole("button", { name: "11" })).toBeInTheDocument();
    // No more pages left -> Load More disappears
    expect(
      screen.queryByRole("button", { name: /load more/i }),
    ).not.toBeInTheDocument();
  });
});
