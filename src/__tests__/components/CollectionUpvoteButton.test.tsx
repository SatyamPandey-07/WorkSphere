import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { CollectionUpvoteButton } from "@/components/collections/CollectionUpvoteButton";

const mockToast = jest.fn();
jest.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

describe("CollectionUpvoteButton optimistic update and error rollback (#3510)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockToast.mockClear();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("immediately increments counter optimistically on click", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, hasUpvoted: true, upvotes: 6 }),
    });

    render(
      <CollectionUpvoteButton
        folderId="folder-123"
        initialUpvotes={5}
        initialHasUpvoted={false}
      />,
    );

    const button = screen.getByRole("button", { name: /upvote collection/i });
    expect(screen.getByText("5")).toBeInTheDocument();

    fireEvent.click(button);

    // Counter increments immediately prior to network response completion
    expect(screen.getByText("6")).toBeInTheDocument();

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/collections/public/upvote",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ folderId: "folder-123" }),
        }),
      );
    });
  });

  it("smoothly rolls back counter and notifies user with error toast if API fails or network severed", async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(
      new Error("Network connection lost"),
    );

    render(
      <CollectionUpvoteButton
        folderId="folder-123"
        initialUpvotes={10}
        initialHasUpvoted={false}
      />,
    );

    const button = screen.getByRole("button", { name: /upvote collection/i });
    expect(screen.getByText("10")).toBeInTheDocument();

    fireEvent.click(button);

    // Optimistically goes to 11
    expect(screen.getByText("11")).toBeInTheDocument();

    // After failure, rolls back to original count of 10 and shows toast
    await waitFor(() => {
      expect(screen.getByText("10")).toBeInTheDocument();
      expect(mockToast).toHaveBeenCalledWith("Network connection lost", "error");
    });
  });
});
