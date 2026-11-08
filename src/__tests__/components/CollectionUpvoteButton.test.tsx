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

  it("reflects aria-pressed attribute and clamps count to non-negative when un-upvoted from 0", () => {
    render(
      <CollectionUpvoteButton
        folderId="folder-empty"
        initialUpvotes={0}
        initialHasUpvoted={true}
      />,
    );

    const button = screen.getByRole("button", { name: /remove upvote/i });
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveAttribute("aria-label", "Remove upvote (0 upvotes)");

    fireEvent.click(button);

    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveAttribute("aria-label", "Upvote collection (0 upvotes)");
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("renders inline loading spinner and disables button during in-flight network request (#6049)", async () => {
    let resolveFetch: (val: any) => void;
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    (global.fetch as jest.Mock).mockReturnValueOnce(fetchPromise);

    render(
      <CollectionUpvoteButton
        folderId="folder-loading"
        initialUpvotes={3}
        initialHasUpvoted={false}
      />,
    );

    const button = screen.getByRole("button", { name: /upvote collection/i });
    expect(screen.queryByTestId("collection-upvote-spinner")).not.toBeInTheDocument();
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "false");

    fireEvent.click(button);

    // In-flight state: spinner rendered, button disabled, aria-busy true
    expect(screen.getByTestId("collection-upvote-spinner")).toBeInTheDocument();
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");

    // Click again while loading should be ignored (duplicate request guard)
    fireEvent.click(button);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Resolve network request
    resolveFetch!({
      ok: true,
      json: async () => ({ success: true, hasUpvoted: true, upvotes: 4 }),
    });

    await waitFor(() => {
      expect(screen.queryByTestId("collection-upvote-spinner")).not.toBeInTheDocument();
      expect(button).not.toBeDisabled();
      expect(button).toHaveAttribute("aria-busy", "false");
    });
  });
});

