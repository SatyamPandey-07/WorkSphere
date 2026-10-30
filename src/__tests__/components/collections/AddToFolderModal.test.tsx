import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { AddToFolderModal, FolderItem } from "@/components/collections/AddToFolderModal";

describe("AddToFolderModal", () => {
  const mockVenue = {
    id: "venue-123",
    name: "Nomad Hub Downtown",
    city: "Tokyo",
  };

  const mockFolders: FolderItem[] = [
    { id: "f-1", name: "Favorites", color: "#3b82f6", accessRole: "OWNER" },
    { id: "f-2", name: "Collab Spaces", color: "#10b981", accessRole: "EDITOR" },
    { id: "f-3", name: "View Only Archive", color: "#6b7280", accessRole: "VIEWER" },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders loading spinner while fetching folders and renders only owner/editor folders", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ folders: mockFolders }),
    });

    render(<AddToFolderModal venue={mockVenue} onClose={jest.fn()} />);

    expect(screen.getByTestId("folder-loading-spinner")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByTestId("folder-loading-spinner")).not.toBeInTheDocument();
    });

    // Should display OWNER and EDITOR folders
    expect(screen.getByText("Favorites")).toBeInTheDocument();
    expect(screen.getByText("Collab Spaces")).toBeInTheDocument();
    // VIEWER should be filtered out
    expect(screen.queryByText("View Only Archive")).not.toBeInTheDocument();
  });

  it("uses initialFolders directly without calling /api/folders fetch", () => {
    render(
      <AddToFolderModal
        venue={mockVenue}
        onClose={jest.fn()}
        initialFolders={mockFolders}
      />
    );

    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.queryByTestId("folder-loading-spinner")).not.toBeInTheDocument();
    expect(screen.getByText("Favorites")).toBeInTheDocument();
    expect(screen.getByText("Collab Spaces")).toBeInTheDocument();
  });

  it("renders venue preview badge with name and city", () => {
    render(
      <AddToFolderModal
        venue={mockVenue}
        onClose={jest.fn()}
        initialFolders={mockFolders}
      />
    );

    const badge = screen.getByTestId("venue-preview-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Nomad Hub Downtown · Tokyo");
  });

  it("omits venue preview badge if venue name is absent", () => {
    render(
      <AddToFolderModal
        venue={{ id: "anon" }}
        onClose={jest.fn()}
        initialFolders={mockFolders}
      />
    );

    expect(screen.queryByTestId("venue-preview-badge")).not.toBeInTheDocument();
  });

  it("renders empty state when there are no eligible collections", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ folders: [] }),
    });

    render(<AddToFolderModal venue={mockVenue} onClose={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId("folder-empty-state")).toBeInTheDocument();
    });

    expect(screen.getByText(/You don't have any collections yet/i)).toBeInTheDocument();
    expect(screen.getByTestId("folder-create-link")).toHaveAttribute("href", "/collections");
  });

  it("handles successful add to folder flow, PartyKit notification, and callbacks", async () => {
    const handleClose = jest.fn();
    const handleSuccess = jest.fn();

    (global.fetch as jest.Mock)
      // POST to add venue
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      })
      // PartyKit broadcast
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

    render(
      <AddToFolderModal
        venue={mockVenue}
        onClose={handleClose}
        onSuccess={handleSuccess}
        initialFolders={mockFolders}
      />
    );

    const folderButton = screen.getByTestId("folder-item-f-1");
    await act(async () => {
      fireEvent.click(folderButton);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/folders/f-1/venues",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ venue: mockVenue }),
      })
    );

    await waitFor(() => {
      expect(handleSuccess).toHaveBeenCalledWith("f-1");
      expect(handleClose).toHaveBeenCalled();
    });
  });

  it("handles add to folder API failure gracefully with inline error banner", async () => {
    const handleError = jest.fn();

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: "Permission denied" }),
    });

    render(
      <AddToFolderModal
        venue={mockVenue}
        onClose={jest.fn()}
        onError={handleError}
        initialFolders={mockFolders}
      />
    );

    const folderButton = screen.getByTestId("folder-item-f-1");
    await act(async () => {
      fireEvent.click(folderButton);
    });

    await waitFor(() => {
      const banner = screen.getByTestId("folder-error-banner");
      expect(banner).toBeInTheDocument();
      expect(banner).toHaveTextContent(/Could not add venue to folder \(HTTP 403\)/i);
    });

    expect(handleError).toHaveBeenCalledWith("Could not add venue to folder (HTTP 403)");
  });

  it("handles initial folders fetch failure with error banner and retry button", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    render(<AddToFolderModal venue={mockVenue} onClose={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId("folder-error-banner")).toBeInTheDocument();
    });

    expect(screen.getByText(/Failed to load collections \(500\)/i)).toBeInTheDocument();

    // Mock retry response
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ folders: mockFolders }),
    });

    const retryBtn = screen.getByTestId("folder-error-retry-btn");
    await act(async () => {
      fireEvent.click(retryBtn);
    });

    await waitFor(() => {
      expect(screen.queryByTestId("folder-error-banner")).not.toBeInTheDocument();
      expect(screen.getByText("Favorites")).toBeInTheDocument();
    });
  });

  it("dismisses modal on close button click", () => {
    const handleClose = jest.fn();
    render(
      <AddToFolderModal
        venue={mockVenue}
        onClose={handleClose}
        initialFolders={mockFolders}
      />
    );

    fireEvent.click(screen.getByTestId("modal-close-button"));
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("dismisses modal on Escape key press", () => {
    const handleClose = jest.fn();
    render(
      <AddToFolderModal
        venue={mockVenue}
        onClose={handleClose}
        initialFolders={mockFolders}
      />
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("dismisses modal on backdrop click, but ignores clicks inside dialog container", () => {
    const handleClose = jest.fn();
    render(
      <AddToFolderModal
        venue={mockVenue}
        onClose={handleClose}
        initialFolders={mockFolders}
      />
    );

    const backdrop = screen.getByTestId("add-to-folder-modal");
    const container = screen.getByTestId("add-to-folder-container");

    // Click inside container
    fireEvent.click(container);
    expect(handleClose).not.toHaveBeenCalled();

    // Click backdrop overlay
    fireEvent.click(backdrop);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
